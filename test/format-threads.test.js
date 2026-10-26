import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadThreads } from "../threads.js";
import { formatThreads } from "../format-threads.js";
import { SITES } from "../sites.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/threads-${name}.json`, import.meta.url), "utf8"));
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function fakeFetch(routes) {
  return async (url) => {
    const body = routes[new URL(url).searchParams.get("url")];
    if (!body) throw new TypeError("Unexpected fixture route");
    return { ok: !body.error, status: body.error ? 502 : 200, json: async () => body };
  };
}

// Expected values come directly from fixture JSON, independently of parsePage.
function media(body) {
  const posts = [];
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (value.__bbox?.result?.data?.media) posts.push(value.__bbox.result.data.media);
    for (const child of Object.values(value)) walk(child);
  }
  for (const match of body.html.matchAll(/<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) walk(JSON.parse(match[1]));
  return posts;
}

async function load(body, routes = {}) {
  return loadThreads({ site: "threads", url: body.url }, fakeFetch({ [body.url]: body, ...routes }));
}

test("thread heading, shared source, root counts and UTC time", async () => {
  const root = fixture("thread-root"), part = fixture("thread-part2");
  const post = media(root).find((p) => p.code);
  const { title, markdown } = formatThreads(await load(part, { [root.url]: root }));
  assert.equal(title, "@zuck on Threads");
  assert.equal(markdown.split("\n")[0], `# Thread by @zuck (${post.user.full_name})`);
  const time = new Date(post.taken_at * 1000).toISOString().slice(0, 16).replace("T", " ");
  // Same layout as the X output: heading, blank line, Source.
  assert.equal(markdown.split("\n")[1], "");
  assert.match(markdown.split("\n")[2], new RegExp(`^Source: ${escape(part.url)}  ·  ${time} UTC  ·  2,754 likes, 173 reposts, 2,666 replies$`));
  assert.deepEqual(markdown.match(/^## \d\/5$/gm), ["## 1/5", "## 2/5", "## 3/5", "## 4/5", "## 5/5"]);
});

test("single image: caption, inline image and attachment", async () => {
  const body = fixture("image"), post = media(body).find((p) => p.code);
  const { title, markdown, images } = formatThreads(await load(body));
  const url = post.image_versions2.candidates[0].url;
  assert.equal(title, "@kongbebee on Threads");
  assert.equal(markdown.split("\n")[0], `# Post by @kongbebee (${post.user.full_name})`);
  assert.match(markdown, /外面正下着雨/);
  assert.doesNotMatch(markdown, /^## \d+\/\d+/m);
  assert.deepEqual(images, [{ url, checked: true, tweetId: "Def4IviGeUo" }]);
  assert.equal(markdown.includes(`![Image 1](${url})`), true);
  assert.match(markdown.trimEnd().split("\n").at(-1), /Threads.*expire/i);
});

test("carousel: seven images in order and two video links", async () => {
  const body = fixture("carousel"), post = media(body).find((p) => p.code);
  const { markdown, images } = formatThreads(await load(body));
  const urls = post.carousel_media.filter((p) => p.media_type === 1).map((p) => p.image_versions2.candidates[0].url);
  assert.equal(images.length, 7);
  assert.deepEqual(images, urls.map((url) => ({ url, checked: true, tweetId: "Ddt7cL5EfUG" })));
  for (const [i, url] of urls.entries()) assert.equal(markdown.includes(`![Image ${i + 1}](${url})`), true);
  assert.equal(markdown.split(`[Video](${body.url})`).length - 1, 2);
  assert.match(markdown, /Agrippa said it's time to get back to work 😎/);
  assert.match(markdown.trimEnd().split("\n").at(-1), /Threads.*expire/i);
});

test("video: no poster attachment or empty replies section", async () => {
  const body = fixture("video");
  const { markdown, images } = formatThreads(await load(body));
  assert.deepEqual(images, []);
  assert.equal(markdown.includes(`[Video](${body.url})`), true);
  assert.doesNotMatch(markdown, /## Replies|expire/i);
});

test("quote: caption, source and unchecked image", async () => {
  const body = fixture("quote"), post = media(body).find((p) => p.code);
  const quote = post.text_post_app_info.share_info.quoted_post;
  const { markdown, images } = formatThreads(await load(body));
  assert.match(markdown, /^> \*\*Quoting @cnn:\*\* Instagram expanded its feature that lets/m);
  assert.equal(markdown.includes("https://www.threads.com/@cnn/post/DeyxYi-lJTj"), true);
  const url = quote.image_versions2.candidates[0].url;
  assert.deepEqual(images, [{ url, checked: false, tweetId: "DeyxYi-lJTj" }]);
  assert.equal(markdown.includes(`![Image 1](${url})`), true);
});

test("caption links survive", async () => {
  const { markdown } = formatThreads(await load(fixture("link")));
  assert.equal(markdown.includes("https://www.chinapress.com.my/?p=5167817"), true);
  assert.match(markdown, /出门记得戴口罩/);
});

test("parents and nested replies preserve order", async () => {
  const { markdown } = formatThreads(await load(fixture("reply-chain")));
  assert.match(markdown, /^> \*\*Replying to @zuck:\*\* /m);
  assert.match(markdown, /^> \*\*Replying to @cristi\.baluta:\*\* /m);
  assert.equal(markdown.indexOf("Replying to @zuck") < markdown.indexOf("Replying to @cristi.baluta"), true);
  assert.match(markdown, /^> \*\*@cristi\.baluta\*\*/m);
  assert.match(markdown, /^>> \*\*@aniketpsig\*\*/m);
});

test("reply count, likes and page order", async () => {
  const { markdown } = formatThreads(await load(fixture("thread-root")));
  assert.match(markdown, /## Replies\n+_First 2 of 2,666 replies, in the order Threads loads them\. Images in replies are linked, not attached\._/);
  assert.match(markdown, /^> \*\*@ncmedic201\*\* · 63 likes/m);
  assert.match(markdown, /^> \*\*@nldoty\*\* · 3,286 likes/m);
  assert.equal(markdown.indexOf("**@ncmedic201**") < markdown.indexOf("**@nldoty**"), true);
});

test("hiding replies keeps every author continuation", async () => {
  const body = fixture("thread-root"), parts = media(body);
  const { markdown } = formatThreads(await load(body), { includeReplies: false });
  assert.doesNotMatch(markdown, /## Replies|@ncmedic201|@nldoty/);
  assert.deepEqual(markdown.match(/^## \d\/5$/gm), ["## 1/5", "## 2/5", "## 3/5", "## 4/5", "## 5/5"]);
  const posts = [parts.find((p) => p.code), ...parts.find((p) => p.text_post_app_info.self_thread).text_post_app_info.self_thread.posts.edges.map((e) => e.node)];
  for (const post of posts) assert.equal(markdown.includes(post.caption.text), true);
});

test("unavailable replies have an explicit notice", async () => {
  const data = await load(fixture("thread-root"));
  const { markdown } = formatThreads({ ...data, replies: null });
  assert.match(markdown, /## Replies\n+_Replies couldn't be loaded\._/);
});

test("partial thread notice follows Source", async () => {
  const part = fixture("thread-part2"), root = fixture("thread-root");
  const data = await load(part, { [root.url]: { error: "Threads returned HTTP 500." } });
  assert.match(data.notice, /couldn't load the full thread/i);
  const { markdown } = formatThreads(data);
  assert.match(markdown, new RegExp(`^Source: [^\n]+\n+_${escape(data.notice)}_`, "m"));
});

test("parent images are unchecked and reply images are linked only", async () => {
  const body = fixture("image"), source = media(body).find((p) => p.code);
  const data = await load(fixture("video"));
  const { markdown, images } = formatThreads({ ...data, parents: [source], replies: [[source]] });
  const url = source.image_versions2.candidates[0].url;
  assert.deepEqual(images, [{ url, checked: false, tweetId: "Def4IviGeUo" }]);
  assert.match(markdown, /^> \*\*Replying to @kongbebee:\*\* /m);
  assert.equal(markdown.slice(markdown.indexOf("## Replies")).includes(url), true);
});

test("reply depth is capped at four", async () => {
  const data = await load(fixture("reply-chain"));
  const [first, second] = data.replies[0];
  const { markdown } = formatThreads({ ...data, replies: [[first, second, first, second, first]] });
  assert.match(markdown, /^>>> \*\*@cristi\.baluta\*\*/m);
  assert.match(markdown, /^>>>> \*\*@aniketpsig\*\*/m);
  assert.match(markdown, /^>>>> \*\*@cristi\.baluta\*\*/m);
  assert.doesNotMatch(markdown, /^>>>>>/m);
});

test("Threads site registration", () => {
  assert.equal(SITES.threads.label, "Threads");
  assert.equal(typeof SITES.threads.load, "function");
  assert.equal(SITES.threads.format, formatThreads);
});

test("empty replies report the nonzero Threads count only", async () => {
  const data = await load(fixture("thread-root"));
  const { markdown } = formatThreads({ ...data, replies: [] });
  const video = await load(fixture("video"));
  assert.equal(video.post.text_post_app_info.direct_reply_count, 0);
  assert.deepEqual(video.replies, []);
  assert.equal(formatThreads(video).markdown.includes("## Replies"), false);
  assert.match(markdown, /^## Replies\n{2,}_No replies came back, though Threads reports 2,666\._$/m);
});

test("reply carriage returns stay inside the blockquote", async () => {
  const data = await load(fixture("reply-chain"));
  const clone = structuredClone(data.replies[0][0]);
  clone.caption.text = "first line\rsecond line\r\nthird line";
  const { markdown } = formatThreads({ ...data, replies: [[clone]] });
  assert.equal(markdown.includes("\r"), false);
  assert.match(markdown, /^> first line$/m);
  assert.match(markdown, /^> second line$/m);
  assert.match(markdown, /^> third line$/m);
});

test("javascript image URLs are omitted", async () => {
  const data = await load(fixture("image"));
  const clone = structuredClone(data.post);
  clone.image_versions2.candidates[0].url = "javascript:alert(1)";
  const { markdown, images } = formatThreads({ ...data, post: clone, thread: [clone] });
  assert.deepEqual(images, []);
  assert.equal(markdown.includes("javascript:"), false);
});

test("HTTP image URLs are omitted", async () => {
  const data = await load(fixture("image"));
  const clone = structuredClone(data.post);
  clone.image_versions2.candidates[0].url = "http://scontent.cdninstagram.com/a.jpg";
  const { markdown, images } = formatThreads({ ...data, post: clone, thread: [clone] });
  assert.deepEqual(images, []);
  assert.equal(markdown.includes("http://scontent"), false);
});

test("HTTPS image markdown encodes spaces and parentheses but attachments keep the URL", async () => {
  const data = await load(fixture("image"));
  const clone = structuredClone(data.post);
  clone.image_versions2.candidates[0].url = "https://scontent.cdninstagram.com/a (1).jpg";
  const { markdown, images } = formatThreads({ ...data, post: clone, thread: [clone] });
  assert.deepEqual(images, [{
    url: "https://scontent.cdninstagram.com/a (1).jpg", checked: true, tweetId: "Def4IviGeUo",
  }]);
  assert.equal(markdown.split("\n").includes("![Image 1](https://scontent.cdninstagram.com/a%20%281%29.jpg)"), true);
});

test("unusable usernames use short links for video and Source", async () => {
  const data = await load(fixture("video"));
  const clone = structuredClone(data.post);
  clone.user.username = "bad name)";
  const { markdown } = formatThreads({ ...data, post: clone, thread: [clone] });
  assert.equal(markdown.includes("[Video](https://www.threads.com/t/DeahyySDDa7)"), true);
  assert.match(markdown, /^Source: https:\/\/www\.threads\.com\/t\/DeahyySDDa7  ·  /m);
  assert.equal(markdown.includes("/@bad name)"), false);
});
