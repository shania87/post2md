import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "../resolve.js";
import { API, FetchError, loadReddit } from "../reddit.js";
import { formatReddit } from "../format-reddit.js";
import { relay, redditShareUrl } from "../worker/threads-relay.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/reddit-${name}.json`, import.meta.url), "utf8"));
const post = (name) => fixture(name).data[0];
const RELAY_URL = "https://post2md-threads.llmdragons.workers.dev/";
const SHARE = "https://www.reddit.com/r/SingaporeRaw/s/dUUw3lwgFS";

// Routes are keyed by path + query below the API root, or by the relay's ?url= value.
function fakeFetch(routes, calls = []) {
  return async (url) => {
    calls.push(url);
    const key = url.startsWith(API) ? url.slice(API.length) : new URL(url).searchParams.get("url");
    const route = routes[key];
    if (route === undefined) throw new TypeError(`Unexpected route ${url}`);
    const status = route?.status ?? 200;
    return { ok: status < 400, status, json: async () => route?.body ?? route };
  };
}

const routesFor = (id, postName, commentsName) => ({
  [`/posts/ids?ids=${id}`]: fixture(postName),
  [`/comments/tree?link_id=${id}&limit=100`]: commentsName ? fixture(commentsName) : { status: 500, body: {} },
});

async function format(id, postName, commentsName, options) {
  const data = await loadReddit({ site: "reddit", id }, fakeFetch(routesFor(id, postName, commentsName)));
  return formatReddit(data, options);
}

test("resolve: post links in every host and form become one canonical id", () => {
  const expected = { site: "reddit", id: "1x0ksoi", url: "https://www.reddit.com/comments/1x0ksoi/" };
  for (const link of [
    "https://www.reddit.com/r/SingaporeRaw/comments/1x0ksoi/what_is_happening/?share_id=z&utm_source=a",
    "https://old.reddit.com/r/SingaporeRaw/comments/1x0ksoi/",
    "https://m.reddit.com/r/SingaporeRaw/comments/1x0ksoi/what_is_happening/peleyn7/",
    "https://reddit.com/comments/1x0ksoi",
    "https://www.reddit.com/gallery/1X0KSOI",
    "https://www.reddit.com/user/someone/comments/1x0ksoi/title/",
    "https://redd.it/1x0ksoi",
  ]) assert.deepEqual(resolve(link), expected, link);
});

test("resolve: share links are kept for the relay, other pages rejected", () => {
  assert.deepEqual(resolve(`${SHARE}?utm_source=share`), { site: "reddit", url: SHARE });
  assert.equal(resolve("https://www.reddit.com/r/SingaporeRaw/"), null);
  assert.equal(resolve("https://www.reddit.com/r/x/comments/"), null);
});

test("image post: header, body, attached image and nested comments by score", async () => {
  const p = post("image");
  const { title, markdown, images } = await format("1x0ksoi", "image", "image-comments");
  assert.equal(title, "r/SingaporeRaw on Reddit");
  assert.match(markdown, /^# what is happening\n\nSource: https:\/\/www\.reddit\.com\/r\/SingaporeRaw\/comments\/1x0ksoi\/what_is_happening\/  ·  r\/SingaporeRaw  ·  u\/Patient_Wrap_1138  ·  \d{4}-\d\d-\d\d \d\d:\d\d UTC  ·  28 points, 31 comments/);
  assert.ok(markdown.includes(p.selftext.trim()));
  assert.deepEqual(images, [{ url: p.url, checked: true, tweetId: "1x0ksoi" }]);
  assert.ok(markdown.includes(`![Image 1](${p.url})`));
  // Top level is highest score first; replies sit one level deeper under their parent.
  const tops = [...markdown.matchAll(/^> \*\*u\/[^*]+\*\* · (-?\d+) points?$/gm)].map((m) => Number(m[1]));
  assert.ok(tops.length > 5);
  assert.deepEqual(tops, [...tops].sort((a, b) => b - a));
  assert.match(markdown, /^>> \*\*u\/\S+\*\* · \d+ points$/m);
  // The archive can hold more comments than the post's stored count; then no "of N" is claimed.
  assert.match(markdown, /_33 comments from the archive, highest score first/);
  assert.match(markdown, /^> \*\*u\/aeth3rz\*\* · 1 point$/m);
  assert.match(markdown, /_From the Arctic Shift archive of Reddit/);
});

test("video post links the post and nests three levels", async () => {
  const { markdown, images } = await format("1y2jvon", "video", "video-comments");
  assert.deepEqual(images, []);
  assert.ok(markdown.includes("[Video](https://www.reddit.com/r/singapore/comments/1y2jvon/"));
  assert.match(markdown, /^>>> \*\*u\/RedditLIONS\*\* · 7 points\n>>> Time to build a second Jewel/m);
  assert.ok(!markdown.includes("![gif]("));
  assert.ok(markdown.includes("[GIF](https://media.giphy.com/media/KzeZ3OXHoSDVZH9cmy/giphy.gif)"));
});

test("gallery: every item attached in gallery order", async () => {
  const p = post("gallery");
  const { markdown, images } = await format("1y39kxx", "gallery", null);
  const order = p.gallery_data.items.map((item) => p.media_metadata[item.media_id].s.u);
  assert.deepEqual(images.map((img) => img.url), order);
  assert.ok(markdown.includes(`![Image 1](${order[0]})  ![Image 2](${order[1]})`));
  assert.match(markdown, /## Comments\n\n_Comments couldn't be loaded._/);
});

test("crosspost uses the original's media and says where it came from", async () => {
  const { markdown, images } = await format("1y35rjx", "crosspost", null);
  assert.ok(markdown.includes("_Crossposted from r/u_chubbybronco by u/chubbybronco: " +
    "https://www.reddit.com/user/chubbybronco/comments/1y35nys/the_wife_wolf_a_crumpled_paper_towel_in_my_weed/_"));
  assert.ok(markdown.includes('**Original title:** "The Wife Wolf". A crumpled paper towel in my weed bag.'));
  assert.equal(images.length, 1);
  assert.equal(images[0].url, "https://i.redd.it/2tc7bnpnl93i1.jpeg");
  const sameTitle = structuredClone(post("crosspost"));
  sameTitle.title = sameTitle.crosspost_parent_list[0].title;
  assert.ok(!formatReddit({ post: sameTitle, comments: [] }).markdown.includes("Original title:"));
});

test("comment embedded media tokens resolve via giphy, media_metadata, or comment permalink fallback", () => {
  const base = { id: "abc", subreddit: "t", author: "a", title: "T", is_self: true,
    permalink: "/r/t/comments/abc/t/" };
  const comments = [
    { id: "c1", author: "u1", score: 2, replies: [],
      body: "Look ![img](empl|123) and ![gif](custom|456)",
      media_metadata: { "empl|123": { status: "valid", e: "Image", s: { u: "https://preview.redd.it/a.png?width=100&amp;s=1" } } } },
  ];
  const { markdown } = formatReddit({ post: base, comments });
  assert.ok(markdown.includes("[image](https://preview.redd.it/a.png?width=100&s=1)"));
  assert.ok(markdown.includes("[GIF](https://www.reddit.com/r/t/comments/abc/t/c1/)"));
});

test("external link post shows the link, not an image", async () => {
  const { markdown, images } = await format("1y391ot", "youtube", null, { includeReplies: false });
  assert.deepEqual(images, []);
  assert.ok(markdown.includes("Link: https://youtu.be/Dk6nEkTtuL8"));
  assert.ok(!markdown.includes("## Comments"));
});

test("more stubs are dropped, deep replies keep a capped prefix", async () => {
  const listing = fixture("more-comments").data;
  const countT1 = (items) => items.filter((i) => i.kind === "t1")
    .reduce((n, i) => n + 1 + countT1(i.data.replies?.data?.children ?? []), 0);
  const { markdown } = await format("1xwgrmo", "image", "more-comments");
  const blocks = markdown.match(/^>+ \*\*u\/[^*]+\*\* · -?\d+ points?$/gm);
  assert.equal(blocks.length, countT1(listing));
  assert.ok(listing.some((i) => i.kind === "more") || JSON.stringify(listing).includes('"kind":"more"'));
  assert.ok(!markdown.includes(">>>>> "));
});

test("untrusted fields: escapes, removed text, missing pieces", () => {
  const base = { id: "abc", subreddit: "t", author: "a", title: "A &amp; B", is_self: true, num_comments: 2,
    selftext: "[removed]", permalink: "javascript:alert(1)" };
  const comments = [{ id: "c1", author: "[deleted]", body: "x &lt;3\r\ny", score: "bad", replies: [] }];
  const { markdown } = formatReddit({ post: base, comments });
  assert.match(markdown, /^# A & B$/m);
  assert.match(markdown, /Source: https:\/\/www\.reddit\.com\/comments\/abc\//);
  assert.match(markdown, /^_\[removed\]_$/m);
  assert.match(markdown, /^> x <3\n> y$/m);
  assert.match(markdown, /^> \*\*u\/\[deleted\]\*\* · 0 points$/m);
  const http = formatReddit({ post: { ...base, is_self: false, url: "http://i.redd.it/a.jpg" }, comments: [] });
  assert.deepEqual(http.images, []);
  assert.match(http.markdown, /No comments came back from the archive, though Reddit reports 2/);
});

test("missing post explains the archive lag", async () => {
  const fetch = fakeFetch({ "/posts/ids?ids=zzz": { data: [] }, "/comments/tree?link_id=zzz&limit=100": { data: [] } });
  await assert.rejects(loadReddit({ site: "reddit", id: "zzz" }, fetch), (err) => err instanceof FetchError && /up to a day/.test(err.message));
});

test("share link goes through the relay, then the archive", async () => {
  const calls = [];
  const routes = { ...routesFor("1x0ksoi", "image", "image-comments"),
    [SHARE]: { url: "https://www.reddit.com/r/SingaporeRaw/comments/1x0ksoi/what_is_happening/" } };
  const data = await loadReddit({ site: "reddit", url: SHARE }, fakeFetch(routes, calls));
  assert.equal(data.post.id, "1x0ksoi");
  assert.equal(calls[0], `${RELAY_URL}?url=${encodeURIComponent(SHARE)}`);
});

test("relay error message reaches the user", async () => {
  const fetch = fakeFetch({ [SHARE]: { status: 502, body: { error: "Reddit didn't resolve that share link (HTTP 403)." } } });
  await assert.rejects(loadReddit({ site: "reddit", url: SHARE }, fetch), /HTTP 403/);
});

test("worker: share link resolves to the post URL without fetching the post", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(null, { status: 301, headers: { Location: "/r/SingaporeRaw/comments/1x0ksoi/what_is_happening/?share_id=x" } });
  };
  const request = new Request(`${RELAY_URL}?url=${encodeURIComponent(SHARE)}`, { headers: { Origin: "https://shania87.github.io" } });
  const response = await relay(request, fetch);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://shania87.github.io");
  assert.deepEqual(await response.json(), { url: "https://www.reddit.com/r/SingaporeRaw/comments/1x0ksoi/what_is_happening/" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, "manual");
  assert.match(calls[0].options.headers["User-Agent"], /Chrome\//);
});

test("worker: share redirects off Reddit or blocked are errors", async () => {
  for (const response of [
    new Response(null, { status: 301, headers: { Location: "https://evil.example/r/x/comments/1/" } }),
    new Response("blocked", { status: 403 }),
  ]) {
    const result = await relay(new Request(`${RELAY_URL}?url=${encodeURIComponent(SHARE)}`), async () => response);
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /didn't resolve/);
  }
  assert.equal(redditShareUrl("http://www.reddit.com/r/x/s/abc"), null);
  assert.equal(redditShareUrl("https://www.reddit.com/r/x/comments/abc"), null);
});
