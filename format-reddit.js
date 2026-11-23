// Turns loadReddit() output into markdown plus the list of images worth attaching.

const MAX_REPLY_DEPTH = 4;
const REMOVED = new Set(["[removed]", "[deleted]"]);
const COMMENT_MEDIA_RE = /!\[(gif|img)\]\(([^)\s]+)\)/gi;

const isPost = (value) => value !== null && typeof value === "object" && typeof value.id === "string";

function utc(post) {
  const date = new Date(Number(post.created_utc) * 1000);
  if (!post.created_utc || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function quoteLines(text, prefix = ">") {
  return text.split("\n").map((line) => (line ? `${prefix} ${line}` : prefix)).join("\n");
}

// `word` is the singular; Reddit's own UI says "1 point".
function count(n, word) {
  const value = Number(n) || 0;
  return `${value.toLocaleString("en-US")} ${word}${value === 1 ? "" : "s"}`;
}

// Reddit's JSON HTML-escapes &, < and > inside markdown. Line breaks are normalised so a
// stray \r can't step outside a blockquote.
function text(value) {
  if (typeof value !== "string") return "";
  const raw = value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return raw.replace(/\r\n?|[\u2028\u2029]/g, "\n").trim();
}

function bodyText(value) {
  const body = text(value);
  return REMOVED.has(body) ? `_${body}_` : body;
}

// Only https URLs are used. The markdown copy escapes the characters that would end or break a link.
function httpsUrl(value) {
  if (typeof value !== "string") return null;
  const url = text(value);
  try { return new URL(url).protocol === "https:" ? url : null; } catch { return null; }
}
const ESCAPES = { " ": "%20", "(": "%28", ")": "%29", "<": "%3C", ">": "%3E" };
const mdUrl = (url) => url.replace(/[ ()<>]/g, (c) => ESCAPES[c]);

const postUrl = (post) => (/^\/(?:r|user)\/[\w-]+\/comments\/\w+\//.test(post.permalink ?? "")
  ? `https://www.reddit.com${post.permalink}`
  : `https://www.reddit.com/comments/${post.id}/`);

function imageLine(url, post, images, caption) {
  images.push({ url, checked: true, tweetId: post.id });
  const line = `![Image ${images.length}](${mdUrl(url)})`;
  return caption ? `${line} ${caption}` : line;
}

// One gallery item. Animated items can't be attached, so they're linked to the post.
const galleryMeta = (item, post) => {
  const meta = post.media_metadata?.[item?.media_id];
  return meta?.status === "failed" ? null : meta;
};

function galleryLine(item, post, images) {
  const meta = galleryMeta(item, post);
  if (meta?.e === "AnimatedImage") return `[GIF](${postUrl(post)})`;
  const url = meta?.e === "Image" ? httpsUrl(meta.s?.u) : null;
  return url ? imageLine(url, post, images, text(item.caption)) : null;
}

function galleryLines(post, images) {
  const items = post.gallery_data?.items;
  return Array.isArray(items) ? items.map((item) => galleryLine(item, post, images)).filter(Boolean) : [];
}

const isImage = (post, url) => post.post_hint === "image" || new URL(url).hostname === "i.redd.it";
const isOwnPage = (url) => /^https:\/\/(?:www\.)?reddit\.com\/(?:r\/\w+\/comments|gallery)\//.test(url);

// Media lines for one post. Images go into `images`; videos and other links are linked.
function mediaLines(post, images) {
  if (post.is_gallery || post.gallery_data) return galleryLines(post, images);
  if (post.is_video) return [`[Video](${postUrl(post)})`];
  const url = post.is_self ? null : httpsUrl(post.url);
  if (!url || isOwnPage(url)) return [];
  return [isImage(post, url) ? imageLine(url, post, images, "") : `Link: ${mdUrl(url)}`];
}

// A crosspost carries no content of its own: the original's text and media stand in for it.
function crosspostNotice(post, original) {
  const from = `Crossposted from r/${original.subreddit} by u/${original.author}: ${postUrl(original)}`;
  const title = text(original.title);
  return title && title !== text(post.title) ? `_${from}_\n\n**Original title:** ${title}` : `_${from}_`;
}

function postBody(post, images) {
  const original = post.crosspost_parent_list?.find(isPost);
  const source = original || post;
  const parts = [];
  if (original) parts.push(crosspostNotice(post, original));
  const body = bodyText(source.selftext);
  if (body) parts.push(body);
  const media = mediaLines(source, images);
  if (media.length) parts.push(media.join("  "));
  return parts;
}

function tags(post) {
  const flair = text(post.link_flair_text);
  return [post.over_18 && "NSFW", post.spoiler && "Spoiler", flair && `Flair: ${flair}`].filter(Boolean);
}

function header(post) {
  const stats = `${count(post.score, "point")}, ${count(post.num_comments, "comment")}`;
  const meta = [`r/${post.subreddit}`, `u/${post.author}`, utc(post), stats].filter(Boolean);
  const lines = [`# ${text(post.title) || "Reddit post"}`, `Source: ${postUrl(post)}  ·  ${meta.join("  ·  ")}`];
  const flags = tags(post);
  if (flags.length) lines.push(`_${flags.join(" · ")}_`);
  return lines;
}

const byScore = (a, b) => (Number(b.score) || 0) - (Number(a.score) || 0);

const commentUrl = (comment, post) => (/^\w+$/.test(comment.id ?? "") ? `${postUrl(post)}${comment.id}/` : postUrl(post));

function commentMediaUrl(token, comment) {
  const meta = comment.media_metadata?.[token];
  if (meta && meta.status !== "failed") {
    const url = httpsUrl(meta.s?.gif || meta.s?.u);
    if (url) return url;
  }
  const giphy = token.match(/^giphy\|([\w-]+)(?:\||$)/i)?.[1];
  return giphy ? `https://media.giphy.com/media/${giphy}/giphy.gif` : null;
}

function commentBody(comment, post) {
  const body = bodyText(comment.body);
  return body.replace(COMMENT_MEDIA_RE, (_, kind, token) => {
    const label = kind.toLowerCase() === "gif" ? "GIF" : "image";
    const url = commentMediaUrl(token, comment) || commentUrl(comment, post);
    return `[${label}](${mdUrl(url)})`;
  });
}

function commentBlocks(comment, depth, post) {
  const lines = [`**u/${comment.author}** · ${count(comment.score, "point")}`, commentBody(comment, post)];
  const block = quoteLines(lines.join("\n"), ">".repeat(Math.min(depth, MAX_REPLY_DEPTH)));
  const replies = [...comment.replies].sort(byScore).flatMap((reply) => commentBlocks(reply, depth + 1, post));
  return [block, ...replies];
}

const total = (comments) => comments.reduce((n, c) => n + 1 + total(c.replies), 0);

function commentsSection(comments, post) {
  if (comments === null) return ["## Comments", "_Comments couldn't be loaded._"];
  const reported = Number(post.num_comments) || 0;
  if (!comments.length) {
    return reported > 0 ? ["## Comments", `_No comments came back from the archive, though Reddit reports ${reported.toLocaleString("en-US")}._`] : [];
  }
  const shown = total(comments);
  const of = reported > shown ? ` of ${reported.toLocaleString("en-US")}` : "";
  return ["## Comments",
    `_${count(shown, "comment")}${of} from the archive, highest score first at each level. Images in comments are linked, not attached._`,
    ...[...comments].sort(byScore).flatMap((c) => commentBlocks(c, 1, post))];
}

export function formatReddit({ post, comments = [] }, { includeReplies = true } = {}) {
  const images = [];
  const out = [...header(post), ...postBody(post, images)];
  if (includeReplies) out.push(...commentsSection(comments, post));
  out.push("_From the Arctic Shift archive of Reddit: scores are as archived, and very recent comments may be missing._");
  return {
    title: `r/${post.subreddit} on Reddit`,
    markdown: out.join("\n\n") + "\n",
    images,
  };
}
