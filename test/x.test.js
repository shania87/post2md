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
