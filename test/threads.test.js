import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RELAY, FetchError, parsePage, loadThreads } from "../threads.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/threads-${name}.json`, import.meta.url), "utf8"));
const codes = (posts) => posts.map((p) => p.code);
const threadCodes = ["Dd1MqfcG0aH", "Dd1Mqfum3QF", "Dd1MqeVG3vT", "Dd1MriSm3-u", "Dd1MqeyG15H"];
const link = (body) => ({ site: "threads", url: body.url });

function fakeFetch(routes, calls) {
  return async (url) => {
    calls.push(url);
    const body = routes[new URL(url).searchParams.get("url")];
    if (!body) throw new TypeError("Unexpected fixture route");
    return { ok: !body.error, status: body.error ? 502 : 200, json: async () => body };
  };
}

// Rewrite only parsed JSON blocks in a fresh fixture copy.
function editPage(body, edit) {
  function walk(value) {
    if (!value || typeof value !== "object") return;
    edit(value);
    for (const child of Object.values(value)) walk(child);
  }
  return { ...body, html: body.html.replace(/(<script\b[^>]*type="application\/json"[^>]*>)([\s\S]*?)(<\/script>)/g,
    (_, start, json, end) => { const value = JSON.parse(json); walk(value); return start + JSON.stringify(value) + end; }) };
}

test("relay endpoint", () => {
  assert.equal(RELAY, "https://post2md-threads.llmdragons.workers.dev/");
});

test("root: merged post, continuation and page-order replies", () => {
  const data = parsePage(fixture("thread-root").html, "Dd1MqfcG0aH");
  assert.equal(data.post.code, "Dd1MqfcG0aH");
  assert.equal(data.post.user.username, "zuck");
  assert.equal(String(data.post.user.pk), "63055343223");
  assert.equal(data.post.like_count, 2754);
  assert.equal(data.post.taken_at, 1790598932);
  assert.equal(data.post.media_type, 19);
  assert.equal(data.post.text_post_app_info.direct_reply_count, 2666);
  assert.equal(data.post.text_post_app_info.repost_count, 173);
  assert.match(data.post.caption.text, /^We believe superintelligence will create significant new opportunities/);
  assert.deepEqual(codes(data.ancestors), []);
  assert.deepEqual(codes(data.continuation), threadCodes.slice(1));
  assert.deepEqual(data.replyChains.map(codes), [["Dd1NOfhEVgZ"], ["Dd1NdPZlbK8"]]);
});

test("root shared: one relay request", async () => {
  const body = fixture("thread-root"), calls = [];
  const data = await loadThreads(link(body), fakeFetch({ [body.url]: body }, calls));
  assert.equal(data.post.code, "Dd1MqfcG0aH");
  assert.deepEqual(codes(data.thread), threadCodes);
  assert.deepEqual(codes(data.parents), []);
  assert.deepEqual(data.replies.map(codes), [["Dd1NOfhEVgZ"], ["Dd1NdPZlbK8"]]);
  assert.deepEqual(calls, [RELAY + "?url=" + encodeURIComponent(body.url)]);
  assert.equal(data.notice, null);
});

test("part 2: root supplies thread and replies", async () => {
  const part = fixture("thread-part2"), root = fixture("thread-root"), calls = [];
  const data = await loadThreads(link(part), fakeFetch({ [part.url]: part, [root.url]: root }, calls));
  assert.equal(data.post.code, "Dd1Mqfum3QF");
  assert.deepEqual(codes(data.thread), threadCodes);
  assert.deepEqual(codes(data.parents), []);
  assert.deepEqual(data.replies.map(codes), [["Dd1NOfhEVgZ"], ["Dd1NdPZlbK8"]]);
  assert.deepEqual(calls, [part.url, root.url].map((url) => RELAY + "?url=" + encodeURIComponent(url)));
  assert.equal(data.notice, null);
});

test("root failure keeps the shared part", async () => {
  const part = fixture("thread-part2"), root = fixture("thread-root"), calls = [];
  const data = await loadThreads(link(part), fakeFetch({ [part.url]: part, [root.url]: { error: "Threads returned HTTP 500." } }, calls));
  assert.equal(data.post.code, "Dd1Mqfum3QF");
  assert.deepEqual(codes(data.thread), threadCodes.slice(1));
  assert.deepEqual(codes(data.parents), ["Dd1MqfcG0aH"]);
  assert.deepEqual(data.replies.map(codes), [["Dd1NdDaglpx"], ["Dd1Pz8sGtFM"], ["Dd1Qi5uG1op"]]);
  assert.equal(calls.length, 2);
  assert.match(data.notice, /couldn't load the full thread/i);
});

test("same author without self-thread membership is an ordinary reply", async () => {
  const part = fixture("thread-part2"), calls = [];
  const root = editPage(fixture("thread-root"), (value) => {
    if (value.self_thread?.posts?.edges) value.self_thread.posts.edges = value.self_thread.posts.edges.filter((e) => e.node.code !== "Dd1Mqfum3QF");
  });
  const data = await loadThreads(link(part), fakeFetch({ [part.url]: part, [root.url]: root }, calls));
  assert.deepEqual(codes(data.thread), threadCodes.slice(1));
  assert.deepEqual(codes(data.parents), ["Dd1MqfcG0aH"]);
  assert.deepEqual(data.replies.map(codes), [["Dd1NdDaglpx"], ["Dd1Pz8sGtFM"], ["Dd1Qi5uG1op"]]);
  assert.equal(calls.length, 2);
  assert.equal(data.notice, null);
});

test("reply to a reply: all ancestors and the back-and-forth", async () => {
  const body = fixture("reply-chain"), calls = [];
  const data = await loadThreads(link(body), fakeFetch({ [body.url]: body }, calls));
  assert.equal(data.post.caption.text, "Why so bro?");
  assert.deepEqual(codes(data.thread), ["Dea1YLQCCro"]);
  assert.deepEqual(codes(data.parents), ["DeZtp-TkQHh", "DeZuIIaCGyE"]);
  assert.deepEqual(data.replies.map(codes), [["Debggi5CHcs", "Deb0YfIDCwl"]]);
  assert.equal(calls.length, 1);
  assert.equal(data.notice, null);
});

test("author answering a commenter is not a self-thread", async () => {
  const body = fixture("author-reply"), calls = [];
  const data = await loadThreads(link(body), fakeFetch({ [body.url]: body }, calls));
  assert.deepEqual(codes(data.thread), ["DeT7lLfEyyg"]);
  assert.deepEqual(codes(data.parents), ["DeTjrfWGqHA", "DeTxryPkXiD"]);
  assert.deepEqual(data.replies.map(codes), [["DeUNyZ2j6lK"]]);
  assert.equal(calls.length, 1);
  assert.equal(data.notice, null);
});

test("share link uses the relay's resolved code", async () => {
  const url = "https://www.threads.com/share/BCOB18Y933/", calls = [];
  const data = await loadThreads({ site: "threads", url }, fakeFetch({ [url]: fixture("image") }, calls));
  assert.equal(data.post.code, "Def4IviGeUo");
  assert.deepEqual(calls, [RELAY + "?url=" + encodeURIComponent(url)]);
});

test("relay error keeps the exact message", async () => {
  const fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: "Not a Threads post link." }) });
  await assert.rejects(loadThreads(link(fixture("image")), fetch), (err) => err instanceof FetchError && /^Not a Threads post link\.$/.test(err.message));
});

test("network failure names the relay", async () => {
  const fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(loadThreads(link(fixture("image")), fetch), (err) => err instanceof FetchError && /relay/i.test(err.message));
});

test("missing code is a readable parse error", () => {
  assert.throws(() => parsePage(fixture("image").html, "Dd1MqfcG0aH"), (err) => err instanceof FetchError && /couldn't find the post/i.test(err.message));
});

test("OK relay with missing post is a FetchError", async () => {
  const body = { ...fixture("image"), url: fixture("thread-root").url }, calls = [];
  await assert.rejects(loadThreads(link(body), fakeFetch({ [body.url]: body }, calls)), (err) => err instanceof FetchError && /couldn't find the post/i.test(err.message));
});

test("relatedPosts cannot shadow the real post", () => {
  const extra = { require: [{ relatedPosts: { threads: [{ thread_items: [{ post: { code: "Def4IviGeUo", caption: { text: "WRONG" }, user: { username: "x", pk: "1" }, text_post_app_info: {} } }] }] } }] };
  const html = `<script type="application/json">${JSON.stringify(extra)}</script>` + fixture("image").html;
  assert.match(parsePage(html, "Def4IviGeUo").post.caption.text, /^外面正下着雨/);
});

test("absent direct replies differ from empty replies", () => {
  const body = editPage(fixture("video"), (value) => { delete value.direct_replies; });
  assert.equal(parsePage(body.html, "DeahyySDDa7").replyChains, null);
  assert.deepEqual(parsePage(fixture("video").html, "DeahyySDDa7").replyChains, []);
});

test("thread and parent posts cannot repeat in replies", async () => {
  const body = editPage(fixture("thread-root"), (value) => {
    if (value.direct_replies?.edges && value.self_thread?.posts?.edges) {
      value.direct_replies.edges[0].node.posts.edges.unshift(value.self_thread.posts.edges[0]);
    }
  }), calls = [];
  const data = await loadThreads(link(body), fakeFetch({ [body.url]: body }, calls));
  assert.deepEqual(data.replies.map(codes), [["Dd1NOfhEVgZ"], ["Dd1NdPZlbK8"]]);
});

test("parent posts cannot repeat in replies", async () => {
  const original = fixture("reply-chain");
  let parent;
  editPage(original, (value) => {
    if (value.containing_thread?.posts?.edges) parent = value.containing_thread.posts.edges[0];
  });
  const body = editPage(original, (value) => {
    if (value.direct_replies?.edges) value.direct_replies.edges[0].node.posts.edges.unshift(parent);
  }), calls = [];
  const data = await loadThreads(link(body), fakeFetch({ [body.url]: body }, calls));
  assert.deepEqual(codes(data.parents), ["DeZtp-TkQHh", "DeZuIIaCGyE"]);
  assert.deepEqual(data.replies.map(codes), [["Debggi5CHcs", "Deb0YfIDCwl"]]);
});
