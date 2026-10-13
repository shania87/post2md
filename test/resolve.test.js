import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "../resolve.js";

test("X app share link: tracking params dropped", () => {
  assert.deepEqual(resolve("https://x.com/andilosing/status/2109649336405458946?s=46&t=abcDEF"), {
    site: "x", id: "2109649336405458946", user: "andilosing",
    url: "https://x.com/andilosing/status/2109649336405458946",
  });
});

test("link inside shared text, with trailing punctuation", () => {
  const link = resolve("Check this out (https://twitter.com/IntCyberDigest/status/2109619013558976890).");
  assert.equal(link.site, "x");
  assert.equal(link.id, "2109619013558976890");
});

test("share target params: first one with a link wins", () => {
  const link = resolve(null, "", "Look at this https://x.com/stochasticmacaw/status/2108959650875843024");
  assert.equal(link.id, "2108959650875843024");
});

test("other X hosts and forms", () => {
  assert.equal(resolve("https://mobile.twitter.com/a/status/123").id, "123");
  assert.equal(resolve("https://fxtwitter.com/a/status/456/photo/1").id, "456");
  assert.equal(resolve("https://x.com/i/web/status/789").id, "789");
  assert.equal(resolve("x.com/a/status/321").id, "321");
});

test("Reddit links hand off, query stripped", () => {
  assert.deepEqual(resolve("https://www.reddit.com/r/SingaporeRaw/s/dUUw3lwgFS"), {
    site: "reddit", url: "https://www.reddit.com/r/SingaporeRaw/s/dUUw3lwgFS",
  });
  assert.equal(
    resolve("https://old.reddit.com/r/x/comments/1x0ksoi/what/?share_id=z&utm_source=a").url,
    "https://www.reddit.com/r/x/comments/1x0ksoi/what/",
  );
});

test("non-post links are rejected", () => {
  assert.equal(resolve("https://x.com/andilosing"), null);
  assert.equal(resolve("https://example.com/a/status/1"), null);
  assert.equal(resolve("no link here"), null);
});

test("status id must end at a path boundary", () => {
  assert.equal(resolve("https://x.com/u/status/123abc"), null);
  assert.equal(resolve("https://x.com/u/status/123abc https://x.com/v/status/456").id, "456");
});

test("long junk text stays fast", () => {
  for (const junk of ["a".repeat(100000), "a.".repeat(50000), "https://" + "a-".repeat(50000)]) {
    const start = performance.now();
    assert.equal(resolve(junk), null);
    assert.ok(performance.now() - start < 200, `took ${performance.now() - start}ms`);
  }
});
