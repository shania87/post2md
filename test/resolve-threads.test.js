import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "../resolve.js";

for (const [name, input, url] of [
  ["net host and tracking", "https://www.threads.net/@zuck/post/Dd1MqfcG0aH?xmt=AQF0&slof=1#top", "https://www.threads.com/@zuck/post/Dd1MqfcG0aH"],
  ["hyphen in code", "https://threads.com/@zuck/post/DeZtp-TkQHh", "https://www.threads.com/@zuck/post/DeZtp-TkQHh"],
  ["dot in handle", "https://www.threads.com/@cristi.baluta/post/DeZuIIaCGyE", "https://www.threads.com/@cristi.baluta/post/DeZuIIaCGyE"],
  ["underscore in handle", "https://www.threads.com/@arieschan_wealthguru/post/DeT7lLfEyyg", "https://www.threads.com/@arieschan_wealthguru/post/DeT7lLfEyyg"],
  ["share link", "https://www.threads.com/share/BCOB18Y933/?xmt=abc", "https://www.threads.com/share/BCOB18Y933/"],
  ["short link", "https://www.threads.com/t/Dd1MqfcG0aH", "https://www.threads.com/t/Dd1MqfcG0aH"],
  ["shared text", "Look at this https://www.threads.com/@kongbebee/post/Def4IviGeUo?xmt=x 🙏", "https://www.threads.com/@kongbebee/post/Def4IviGeUo"],
]) {
  test(`Threads: ${name}`, () => {
    assert.deepEqual(resolve(input), { site: "threads", url });
  });
}

for (const url of [
  "https://www.threads.com/@zuck", "https://www.threads.com/@zuck/post/",
  "https://www.threads.com/search?q=x", "https://evilthreads.com/@a/post/B",
  "https://threads.com.evil.io/@a/post/B",
]) {
  test(`not a Threads post: ${url}`, () => assert.equal(resolve(url), null));
}

test("Threads matcher leaves X and Reddit alone", () => {
  assert.deepEqual(resolve("https://x.com/andilosing/status/2109649336405458946?s=46"), {
    site: "x", id: "2109649336405458946", user: "andilosing",
    url: "https://x.com/andilosing/status/2109649336405458946",
  });
  assert.deepEqual(resolve("https://www.reddit.com/r/SingaporeRaw/s/dUUw3lwgFS?share_id=x"), {
    site: "reddit", url: "https://www.reddit.com/r/SingaporeRaw/s/dUUw3lwgFS",
  });
});

test("Threads: post link keeps its trailing slash", () => {
  assert.deepEqual(resolve("https://www.threads.com/@zuck/post/Dd1MqfcG0aH/"), {
    site: "threads", url: "https://www.threads.com/@zuck/post/Dd1MqfcG0aH/",
  });
});

test("Threads: short link keeps its trailing slash", () => {
  assert.deepEqual(resolve("https://www.threads.com/t/Dd1MqfcG0aH/"), {
    site: "threads", url: "https://www.threads.com/t/Dd1MqfcG0aH/",
  });
});
