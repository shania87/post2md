// Turns loadX() output into markdown plus the list of images worth attaching.

function utc(tweet) {
  const date = new Date(Number(tweet.created_timestamp) * 1000);
  if (!tweet.created_timestamp || Number.isNaN(date.getTime())) return String(tweet.created_at || "");
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function quoteLines(text) {
  return text.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
}

function count(n, word) {
  return `${(n ?? 0).toLocaleString("en-US")} ${word}`;
}

// Media lines for one tweet. Photos are pushed into `images` so the share step can attach them.
function mediaLines(tweet, images, checked) {
  const lines = [];
  const media = tweet.media || {};
  const all = Array.isArray(media.all) ? media.all
    : [media.photos, media.videos].filter(Array.isArray).flat();
  // API JSON is untrusted: skip entries that aren't usable rather than failing the whole export.
  for (const item of all) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "photo") {
      if (typeof item.url !== "string") continue;
      images.push({ url: item.url, checked, tweetId: tweet.id });
      lines.push(`[Image ${images.length}](${item.url})`);
    } else {
      const kind = item.type === "gif" ? "GIF" : "Video";
      lines.push(`[${kind}: ${item.thumbnail_url || "no thumbnail"}](${tweet.url})`);
    }
  }
  return lines;
}

function tweetBody(tweet, images, checked) {
  const parts = [tweet.text || ""];
  const media = mediaLines(tweet, images, checked);
  if (media.length) parts.push(media.join("  "));
  if (tweet.quote && typeof tweet.quote === "object") {
    const q = tweet.quote;
    const quoted = [`**Quoting @${q.author?.screen_name}:** ${q.text || ""}`];
    // Quoted images are listed but not attached by default: they're context, not the post.
    const qMedia = mediaLines(q, images, false);
    if (qMedia.length) quoted.push(qMedia.join("  "));
    quoted.push(q.url);
    parts.push(quoteLines(quoted.join("\n")));
  }
  if (tweet.community_note?.text) {
    parts.push(quoteLines(`**Community note:** ${tweet.community_note.text}`));
  }
  return parts.join("\n\n");
}

const MAX_REPLY_DEPTH = 4;

// Nests replies under whatever they reply to; anything whose parent isn't in the set is top level.
// Keeps the API's order (ranked by likes) at every level.
function replyTree(replies) {
  const ids = new Set(replies.map((r) => r.id));
  const children = new Map();
  const roots = [];
  for (const r of replies) {
    const parent = r.replying_to?.status;
    if (parent && ids.has(parent) && parent !== r.id) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(r);
    } else {
      roots.push(r);
    }
  }
  return { roots, children };
}

function replyBlock(reply, depth, children, seen) {
  if (seen.has(reply.id)) return [];
  seen.add(reply.id);
  // Replies start with the @handles they answer; the nesting already says that.
  const text = (reply.text || "").replace(/^(?:@\w+\s+)+/, "");
  const lines = [`**@${reply.author?.screen_name}** · ${count(reply.likes, "likes")}`, text];
  const media = mediaLines(reply, [], false).map((line) => line.replace(/^\[Image \d+\]/, "[image]"));
  if (media.length) lines.push(media.join("  "));
  const prefix = ">".repeat(Math.min(depth, MAX_REPLY_DEPTH));
  const block = [lines.join("\n").split("\n").map((line) => (line ? `${prefix} ${line}` : prefix)).join("\n")];
  for (const child of children.get(reply.id) || []) block.push(...replyBlock(child, depth + 1, children, seen));
  return block;
}

function repliesSection(replies, root) {
  if (replies === null) return ["## Replies", "_Replies couldn't be loaded._"];
  if (!replies.length) return [];
  const { roots, children } = replyTree(replies);
  const seen = new Set();
  const blocks = roots.flatMap((r) => replyBlock(r, 1, children, seen));
  // Replies caught in a reply cycle never hang off a root; show them at top level rather than drop them.
  for (const r of replies) if (!seen.has(r.id)) blocks.push(...replyBlock(r, 1, children, seen));
  const total = root.replies ? `; X shows ${count(root.replies, "replies")} in total` : "";
  return ["## Replies", `_Top ${replies.length} replies by likes${total}. Images in replies are linked, not attached._`, ...blocks];
}

export function formatX({ status, thread, parents = [], replies = [] }, { includeReplies = true } = {}) {
  const root = thread[0];
  const author = root.author || status.author || {};
  const images = [];
  const out = [];

  out.push(`# ${thread.length > 1 ? "Thread" : "Post"} by @${author.screen_name} (${author.name})`);
  out.push(`Source: ${status.url}  ·  ${utc(root)}  ·  ` +
    [count(root.likes, "likes"), count(root.reposts, "reposts"), count(root.replies, "replies")].join(", "));

  for (const p of parents) {
    const lines = [`**Replying to @${p.author?.screen_name}:** ${p.text || ""}`];
    // Parent images go in the same list as quoted ones: offered, not attached by default.
    const media = mediaLines(p, images, false);
    if (media.length) lines.push(media.join("  "));
    out.push(quoteLines(lines.join("\n")));
  }

  thread.forEach((tweet, i) => {
    if (thread.length > 1) out.push(`## ${i + 1}/${thread.length}`);
    out.push(tweetBody(tweet, images, true));
  });

  if (includeReplies) out.push(...repliesSection(replies, root));

  return {
    title: `@${author.screen_name} on X`,
    markdown: out.join("\n\n") + "\n",
    images,
  };
}
