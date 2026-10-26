import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { threadsUrl, relay } from "../worker/threads-relay.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/threads-${name}.json`, import.meta.url), "utf8"));
const requestUrl = (url) => "https://post2md-threads.llmdragons.workers.dev/?url=" + encodeURIComponent(url);

test("Threads URL validation drops tracking", () => {
  const { url } = fixture("image");
  assert.equal(threadsUrl(url + "?xmt=1#top").href, url);
  assert.equal(threadsUrl("https://example.com/x"), null);
});

for (const [name, options, url, status, error] of [
  ["POST", { method: "POST" }, "https://www.threads.com/@kongbebee/post/Def4IviGeUo", 405, "GET only."],
  ["foreign origin", { headers: { Origin: "https://evil.example" } }, "https://www.threads.com/@kongbebee/post/Def4IviGeUo", 403, "Origin not allowed."],
  ["foreign URL", {}, "https://example.com/x", 400, "Not a Threads post link."],
]) {
  test(`relay rejects ${name}`, async () => {
    const calls = [];
    const fetch = async (...args) => { calls.push(args); return new Response("unexpected"); };
    const response = await relay(new Request(requestUrl(url), options), fetch);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error });
    assert.equal(calls.length, 0);
  });
}

for (const origin of ["https://shania87.github.io", null]) {
  test(`relay success: origin ${origin}`, async () => {
    const body = fixture("image"), calls = [];
    const fetch = async (url, options) => { calls.push({ url: String(url), options }); return new Response(body.html, { status: 200 }); };
    const response = await relay(new Request(requestUrl(body.url), { headers: origin ? { Origin: origin } : {} }), fetch);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.deepEqual(await response.json(), body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, body.url);
    assert.equal(calls[0].options.redirect, "manual");
    assert.match(new Headers(calls[0].options.headers).get("User-Agent"), /Chrome/);
  });
}

test("share redirect resolves to the canonical post", async () => {
  const body = fixture("image"), calls = [];
  const share = "https://www.threads.com/share/BCOB18Y933/";
  const fetch = async (url) => {
    calls.push(String(url));
    return String(url) === share
      ? new Response(null, { status: 302, headers: { Location: "/@kongbebee/post/Def4IviGeUo?xmt=1" } })
      : new Response(body.html, { status: 200 });
  };
  const response = await relay(new Request(requestUrl(share)), fetch);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), body);
  assert.deepEqual(calls, [share, body.url]);
});

test("foreign redirect is rejected without fetching it", async () => {
  const body = fixture("image"), calls = [];
  const fetch = async (url) => { calls.push(String(url)); return new Response(null, { status: 302, headers: { Location: "https://evil.example/x" } }); };
  const response = await relay(new Request(requestUrl(body.url)), fetch);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Threads redirected somewhere unexpected." });
  assert.deepEqual(calls, [body.url]);
});

test("four same-host redirects exhaust the budget", async () => {
  const body = fixture("image"), calls = [];
  const fetch = async (url) => { calls.push(String(url)); return new Response(null, { status: 302, headers: { Location: body.url } }); };
  const response = await relay(new Request(requestUrl(body.url)), fetch);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /too many redirects/i);
  assert.deepEqual(calls, [body.url, body.url, body.url, body.url]);
});

test("upstream 404 is a relay error", async () => {
  const fetch = async () => new Response("not found", { status: 404 });
  const response = await relay(new Request(requestUrl(fixture("image").url)), fetch);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /404/);
});
