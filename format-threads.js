// Turns loadThreads() output into markdown plus the list of images worth attaching.

const IMAGE = 1;
const VIDEO = 2;
const MAX_REPLY_DEPTH = 4;

// Page JSON is untrusted: a handle that isn't a real one would break the link, so use the short form.
const postUrl = (post) => (/^[\w.]+$/.test(post.user?.username ?? "")
  ? `https://www.threads.com/@${post.user.username}/post/${post.code}`
  : `https://www.threads.com/t/${post.code}`);

function utc(post) {
  const date = new Date(Number(post.taken_at) * 1000);
  if (!post.taken_at || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function quoteLines(text, prefix = ">") {
  return text.split("\n").map((line) => (line ? `${prefix} ${line}` : prefix)).join("\n");
}

function count(n, word) {
  return `${(n ?? 0).toLocaleString("en-US")} ${word}`;
}

// The caption already holds full URLs; fragments are the fallback when it's missing.
// Line breaks are normalised so a stray \r can't step outside a blockquote.
function text(post) {
  const fragments = post.text_post_app_info?.text_fragments?.fragments;
  const raw = typeof post.caption?.text === "string" ? post.caption.text
    : Array.isArray(fragments) ? fragments.map((f) => f?.plaintext || "").join("") : "";
  return raw.replace(/\r\n?|[\u2028\u2029]/g, "\n");
}

// Only https image URLs are used. The original URL is kept for downloading; the markdown copy
// escapes the characters that would end or break a link.
function largest(item) {
  const url = item?.image_versions2?.candidates?.[0]?.url;
  if (typeof url !== "string") return null;
  try { return new URL(url).protocol === "https:" ? url : null; } catch { return null; }
}
const ESCAPES = { " ": "%20", "(": "%28", ")": "%29", "<": "%3C", ">": "%3E" };
const mdUrl = (url) => url.replace(/[ ()<>]/g, (c) => ESCAPES[c]);

// Media lines for one post. Images go into `images` (attachable) unless `images` is null,
// in which case they're only linked. Videos are linked to the post: they can't be attached.
const nonEmpty = (list) => Array.isArray(list) && list.length > 0;
const isVideo = (item) => item.media_type === VIDEO || nonEmpty(item.video_versions);
const isPost = (value) => value !== null && typeof value === "object" && typeof value.code === "string";
const mediaItems = (post) => (nonEmpty(post.carousel_media) ? post.carousel_media : [post]);

function imageLine(url, post, images, checked) {
  if (!images) return `[image](${mdUrl(url)})`;
  images.push({ url, checked, tweetId: post.code });
  return `![Image ${images.length}](${mdUrl(url)})`;
}

function mediaLine(item, post, images, checked) {
  if (!item || typeof item !== "object") return null;
  if (isVideo(item)) return `[Video](${postUrl(post)})`;
  const url = item.media_type === IMAGE ? largest(item) : null;
  return url ? imageLine(url, post, images, checked) : null;
}

function mediaLines(post, images, checked) {
  return mediaItems(post).map((item) => mediaLine(item, post, images, checked)).filter(Boolean);
}

// Appends the post's media, all on one line, to `lines` when it has any.
function pushMedia(lines, post, images, checked) {
  const media = mediaLines(post, images, checked);
  if (media.length) lines.push(media.join("  "));
}

function postBody(post, images, checked) {
  const parts = [text(post)];
  pushMedia(parts, post, images, checked);
  const q = post.text_post_app_info?.share_info?.quoted_post;
  if (isPost(q)) {
    const quoted = [`**Quoting @${q.user?.username}:** ${text(q)}`];
    // Quoted images are offered but not attached by default: they're context, not the post.
    pushMedia(quoted, q, images, false);
    quoted.push(postUrl(q));
    parts.push(quoteLines(quoted.join("\n")));
  }
  return parts.join("\n\n");
}

// Each chain is a direct reply followed by the back-and-forth under it, one level deeper each.
function chainBlock(chain) {
  return chain.map((reply, i) => {
    const lines = [`**@${reply.user?.username}** · ${count(reply.like_count, "likes")}`, text(reply)];
    pushMedia(lines, reply, null, false);
    return quoteLines(lines.join("\n"), ">".repeat(Math.min(i + 1, MAX_REPLY_DEPTH)));
  });
}

function repliesSection(replies, root) {
  if (replies === null) return ["## Replies", "_Replies couldn't be loaded._"];
  const total = root.text_post_app_info?.direct_reply_count;
  if (!replies.length) {
    // Threads sometimes withholds replies from logged-out pages; say so rather than go quiet.
    return typeof total === "number" && total > 0
      ? ["## Replies", `_No replies came back, though Threads reports ${total.toLocaleString("en-US")}._`]
      : [];
  }
  const of = typeof total === "number" ? ` of ${count(total, "replies")}` : " replies";
  return ["## Replies",
    `_First ${replies.length}${of}, in the order Threads loads them. Images in replies are linked, not attached._`,
    ...replies.flatMap(chainBlock)];
}

function header(post, root, author, isThread) {
  const info = root.text_post_app_info || {};
  const stats = [count(root.like_count, "likes"), count(info.repost_count, "reposts"), count(info.direct_reply_count, "replies")];
  return [
    `# ${isThread ? "Thread" : "Post"} by @${author.username} (${author.full_name})`,
    `Source: ${postUrl(post)}  ·  ${utc(root)}  ·  ${stats.join(", ")}`,
  ];
}

function parentBlock(parent, images) {
  const lines = [`**Replying to @${parent.user?.username}:** ${text(parent)}`];
  // Parent images go in the same list as quoted ones: offered, not attached by default.
  pushMedia(lines, parent, images, false);
  return quoteLines(lines.join("\n"));
}

export function formatThreads({ post, thread, parents = [], replies = [], notice = null }, { includeReplies = true } = {}) {
  const root = thread[0];
  const author = root.user || post.user || {};
  const images = [];
  const out = header(post, root, author, thread.length > 1);

  if (notice) out.push(`_${notice}_`);
  for (const p of parents) out.push(parentBlock(p, images));

  thread.forEach((part, i) => {
    if (thread.length > 1) out.push(`## ${i + 1}/${thread.length}`);
    out.push(postBody(part, images, true));
  });

  if (includeReplies) out.push(...repliesSection(replies, root));
  if (images.length) out.push("_Image links are signed by Threads and expire after a few days._");

  return {
    title: `@${author.username} on Threads`,
    markdown: out.join("\n\n") + "\n",
    images,
  };
}
