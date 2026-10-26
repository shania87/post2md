import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { shareOut } from "../share.js";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const title = "A shared post";
const markdown = "# A shared post\n\n**Exact markdown** — 圖片\n";

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete globalThis.navigator;
});

function stubNavigator(stub) {
  Object.defineProperty(globalThis, "navigator", { value: stub, configurable: true, writable: true });
}

function image(i = 1) {
  return {
    url: "https://scontent.cdninstagram.com/x.jpg",
    checked: true,
    tweetId: "DQabc",
    file: new File(["x"], `post2md-DQabc-${i}.jpg`, { type: "image/jpeg" }),
  };
}

test("files: copies exact markdown before sharing", async () => {
  const images = [image()], calls = [];
  stubNavigator({
    canShare: () => true,
    clipboard: { writeText: async (text) => { calls.push(["copy", text]); } },
    share: async (payload) => { calls.push(["share", payload]); },
  });
  await shareOut({ title, markdown, images });
  assert.deepEqual(calls, [
    ["copy", markdown],
    ["share", { title, text: markdown, files: [images[0].file] }],
  ], "exact markdown must be copied before files are shared");
});

for (const count of [1, 2]) {
  test(`files: ${count} image(s) reports successful markdown copy`, async () => {
    const images = Array.from({ length: count }, (_, i) => image(i + 1));
    stubNavigator({
      canShare: () => true,
      clipboard: { writeText: async () => {} },
      share: async () => {},
    });
    const result = await shareOut({ title, markdown, images });
    assert.equal(result, `Shared ${count} image${count > 1 ? "s" : ""}. Markdown copied too, paste it in if it's missing.`);
  });

  test(`files: ${count} image(s) still shares after clipboard rejection without claiming a copy`, async () => {
    const images = Array.from({ length: count }, (_, i) => image(i + 1)), calls = [];
    stubNavigator({
      canShare: () => true,
      clipboard: { writeText: async (text) => {
        calls.push(["copy", text]);
        throw new Error("Permission denied");
      } },
      share: async (payload) => { calls.push(["share", payload]); },
    });
    const result = await shareOut({ title, markdown, images });
    assert.equal(result, `Shared ${count} image${count > 1 ? "s" : ""}.`);
    assert.deepEqual(calls, [
      ["copy", markdown],
      ["share", { title, text: markdown, files: images.map((img) => img.file) }],
    ]);
  });
}

// Drift guards: existing payload, selection, fallback, and cancellation behavior.
test("drift guard: files retain title and text and select only checked downloaded files capped at four", async () => {
  const selected = Array.from({ length: 5 }, (_, i) => image(i + 1));
  const images = [
    { ...image(6), checked: false },
    { url: "https://scontent.cdninstagram.com/x.jpg", checked: true, tweetId: "DQabc", error: "Download failed" },
    ...selected,
  ];
  const calls = [], files = selected.slice(0, 4).map((img) => img.file);
  stubNavigator({
    canShare: (payload) => { calls.push(["canShare", payload]); return true; },
    clipboard: { writeText: async () => {} },
    share: async (payload) => { calls.push(["share", payload]); },
  });
  await shareOut({ title, markdown, images });
  assert.deepEqual(calls, [
    ["canShare", { text: markdown, files }],
    ["share", { title, text: markdown, files }],
  ]);
  files.forEach((file, i) => assert.equal(calls[1][1].files[i], file));
});

test("drift guard: text-only sharing does not touch the clipboard", async () => {
  const calls = [];
  stubNavigator({
    clipboard: { writeText: async (text) => { calls.push(["copy", text]); } },
    share: async (payload) => { calls.push(["share", payload]); },
  });
  assert.equal(await shareOut({ title, markdown, images: [] }), "Shared text.");
  assert.deepEqual(calls, [["share", { title, text: markdown }]]);
});

test("drift guard: no-share fallback copies markdown", async () => {
  const calls = [];
  stubNavigator({ clipboard: { writeText: async (text) => { calls.push(text); } } });
  assert.equal(await shareOut({ title, markdown, images: [] }), "Sharing isn't available here. Markdown copied instead.");
  assert.deepEqual(calls, [markdown]);
});

test("drift guard: AbortError from file sharing propagates", async () => {
  const images = [image()], calls = [];
  const error = new DOMException("Share cancelled", "AbortError");
  stubNavigator({
    canShare: () => true,
    clipboard: { writeText: async () => {} },
    share: async (payload) => { calls.push(payload); throw error; },
  });
  await assert.rejects(shareOut({ title, markdown, images }), (err) => err.name === "AbortError");
  assert.deepEqual(calls, [{ title, text: markdown, files: [images[0].file] }]);
});
