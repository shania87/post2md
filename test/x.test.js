import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadX, FetchError } from "../x.js";
import { formatX } from "../format-x.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

// Serves fixtures by fxtwitter path; anything else is a 404.
function fakeFetch(routes) {
  return async (url) => {
    const path = url.replace("https://api.fxtwitter.com/2", "");
    const body = routes[path] ?? { code: 404, status: null, thread: null };
    return { ok: body.code === 200, status: body.code, json: async () => body };
  };
}

test("self-thread: both parts, quote inlined in part 2", async () => {
  const data = await loadX("2109649336405458946", fakeFetch({ "/thread/2109649336405458946": fixture("thread-andilosing") }));
  assert.equal(data.thread.length, 2);
  assert.equal(data.parents.length, 0);
  const { markdown, images } = formatX(data);
  assert.match(markdown, /^# Thread by @andilosing/);
  assert.match(markdown, /## 1\/2/);
  assert.match(markdown, /## 2\/2/);
  assert.match(markdown, /> \*\*Quoting @andilosing:\*\* always set up automatic database backups/);
  assert.equal(images.filter((i) => i.checked).length, 1);
});

test("multi-image post: two attachable photos at full size", async () => {
  const data = await loadX("2109619013558976890", fakeFetch({ "/thread/2109619013558976890": fixture("thread-intcyberdigest") }));
  const { markdown, images } = formatX(data);
  // The trailing Telegram self-tweet has a null replying_to but is in thread, so it's kept.
  assert.equal(data.thread.length, 2);
  assert.deepEqual(images.map((i) => i.url), [
    "https://pbs.twimg.com/media/HUbfGZCXEAAiqyL.jpg?name=orig",
    "https://pbs.twimg.com/media/HUbfHTJWQAEeitM.jpg?name=orig",
  ]);
  assert.ok(images.every((i) => i.checked));
  assert.match(markdown, /\[Image 1\]\(https:\/\/pbs\.twimg\.com\/media\/HUbfGZCXEAAiqyL\.jpg\?name=orig\)/);
});

test("single post: no part headers", async () => {
  const data = await loadX("2108959650875843024", fakeFetch({ "/thread/2108959650875843024": fixture("thread-stochasticmacaw") }));
  const { markdown, images } = formatX(data);
  assert.match(markdown, /^# Post by @stochasticmacaw/);
  assert.doesNotMatch(markdown, /## 1\//);
  assert.equal(images.length, 1);
  assert.match(markdown, /Source: https:\/\/x\.com\/stochasticmacaw\/status\/2108959650875843024/);
});

test("reply to someone else: parent chain fetched and shown first", async () => {
  const child = structuredClone(fixture("thread-stochasticmacaw"));
  child.status.replying_to = { screen_name: "parentuser", status: "111" };
  child.thread = [child.status];
  const parent = { code: 200, thread: [], status: {
    id: "111", text: "the parent tweet", url: "https://x.com/parentuser/status/111",
    author: { screen_name: "parentuser" }, replying_to: null,
    media: { all: [{ type: "photo", url: "https://pbs.twimg.com/media/P.jpg?name=orig" }] },
  } };
  const data = await loadX("2108959650875843024", fakeFetch({ "/thread/2108959650875843024": child, "/status/111": parent }));
  assert.equal(data.parents.length, 1);
  const { markdown, images } = formatX(data);
  assert.ok(markdown.indexOf("Replying to @parentuser") < markdown.indexOf("80+ new Singapore"));
  assert.equal(images.find((i) => i.url.includes("P.jpg")).checked, false);
});

test("missing tweet gives a readable error", async () => {
  await assert.rejects(loadX("1", fakeFetch({})), (err) => err instanceof FetchError && /not found/.test(err.message));
});

test("malformed thread entries fall back to the status tweet", async () => {
  const status = { id: "1", text: "hi", url: "https://x.com/u/status/1", author: { screen_name: "u", name: "U" } };
  for (const thread of [[null], "oops", [null, 5, "x"]]) {
    const data = await loadX("1", fakeFetch({ "/thread/1": { code: 200, status, thread } }));
    assert.deepEqual(data.thread, [status]);
    assert.match(formatX(data).markdown, /^# Post by @u/);
  }
});

test("non-tweet status is a readable error, not a crash", async () => {
  await assert.rejects(loadX("1", fakeFetch({ "/thread/1": { code: 200, status: "nope", thread: [] } })), FetchError);
});

test("bad media entries and timestamps don't abort formatting", () => {
  const tweet = {
    id: "1", text: "still here", url: "https://x.com/u/status/1", author: { screen_name: "u", name: "U" },
    created_timestamp: "invalid", created_at: "Mon Oct 12 2026",
    media: { all: [null, 7, { type: "photo" }, { type: "photo", url: "https://pbs.twimg.com/media/A.jpg" }] },
    quote: "not an object",
  };
  const { markdown, images } = formatX({ status: tweet, thread: [tweet] });
  assert.match(markdown, /still here/);
  assert.match(markdown, /Mon Oct 12 2026/);
  assert.deepEqual(images.map((i) => i.url), ["https://pbs.twimg.com/media/A.jpg"]);
  assert.match(markdown, /\[Image 1\]\(https:\/\/pbs\.twimg\.com\/media\/A\.jpg\)/);
});

test("replies: nested under what they answer, chain tweets excluded, @prefix stripped", async () => {
  const data = await loadX("2109649336405458946", fakeFetch({
    "/thread/2109649336405458946": fixture("thread-andilosing"),
    "/conversation/2109649336405458946": fixture("conversation-andilosing"),
  }));
  // The author's 2/2 self-reply is in the thread, so it must not repeat as a reply.
  assert.ok(!data.replies.some((r) => r.id === "2109720698553860606"));
  const { markdown, images } = formatX(data);
  assert.match(markdown, /## Replies/);
  assert.match(markdown, /^> \*\*@noahnomads\*\* · \d+ likes\n> how could you forget/m);
  assert.match(markdown, /^>> \*\*@andilosing\*\* · \d+ likes\n>> i did :\(/m);
  assert.equal(images.length, 1, "reply images are never attached");
  assert.doesNotMatch(formatX(data, { includeReplies: false }).markdown, /## Replies/);
});

test("replies failing to load leaves the post intact", async () => {
  const data = await loadX("2108959650875843024", fakeFetch({ "/thread/2108959650875843024": fixture("thread-stochasticmacaw") }));
  assert.equal(data.replies, null);
  const { markdown } = formatX(data);
  assert.match(markdown, /80\+ new Singapore/);
  assert.match(markdown, /_Replies couldn't be loaded\._/);
});

test("reply cycles and deep nesting don't loop or vanish", () => {
  const t = (id, parent, text) => ({ id, text, author: { screen_name: id }, likes: 0, replying_to: parent ? { status: parent } : null });
  const root = { id: "0", text: "post", url: "https://x.com/u/status/0", author: { screen_name: "u", name: "U" } };
  const replies = [t("a", "b", "cyc-a"), t("b", "a", "cyc-b"), t("1", "0", "d1"), t("2", "1", "d2"), t("3", "2", "d3"),
    t("4", "3", "d4"), t("5", "4", "d5")];
  const { markdown } = formatX({ status: root, thread: [root], replies });
  for (const text of ["cyc-a", "cyc-b", "d5"]) assert.match(markdown, new RegExp(text));
  assert.match(markdown, /^>>>> d5$/m, "depth is capped at 4");
});
