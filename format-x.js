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

export function formatX({ status, thread, parents = [] }) {
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

  return {
    title: `@${author.screen_name} on X`,
    markdown: out.join("\n\n") + "\n",
    images,
  };
}
