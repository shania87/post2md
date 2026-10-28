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

// Transient activation: start clipboard copy first, but share before it settles.
test("files: share is called while the clipboard write is still pending", async () => {
  const images = [image()], calls = [];
  let resolveClipboard;
  const clipboard = new Promise((resolve) => { resolveClipboard = resolve; });
  stubNavigator({
    canShare: () => true,
    clipboard: { writeText: (text) => { calls.push(["copy", text]); return clipboard; } },
    share: async (payload) => { calls.push(["share", payload]); },
  });
  const sharing = shareOut({ title, markdown, images });
  try {
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls, [
      ["copy", markdown],
      ["share", { title, text: markdown, files: [images[0].file] }],
    ], "share must already be called while the clipboard write is pending");
    resolveClipboard();
    assert.equal(await sharing, "Shared 1 image. Markdown copied too, paste it in if it's missing.");
  } finally {
    resolveClipboard();
    await sharing;
  }
});

test("files: clipboard rejecting after share still reports no copy", async () => {
  const images = [image()], calls = [];
  let rejectClipboard;
  const clipboard = new Promise((resolve, reject) => { rejectClipboard = reject; });
  stubNavigator({
    canShare: () => true,
    clipboard: { writeText: (text) => { calls.push(["copy", text]); return clipboard; } },
    share: async (payload) => { calls.push(["share", payload]); },
  });
  const sharing = shareOut({ title, markdown, images });
  try {
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls, [
      ["copy", markdown],
      ["share", { title, text: markdown, files: [images[0].file] }],
    ], "share must already be called before the pending clipboard write rejects");
    rejectClipboard(new Error("Permission denied"));
    assert.equal(await sharing, "Shared 1 image.");
  } finally {
    rejectClipboard(new Error("Permission denied"));
    await sharing;
  }
});

test("files: share rejecting while the clipboard is pending propagates the share error and leaves no unhandled rejection", async () => {
  const images = [image()], unhandled = [];
  const error = new DOMException("Share cancelled", "AbortError");
  let rejectClipboard, timer;
  const clipboard = new Promise((resolve, reject) => { rejectClipboard = reject; });
  const onUnhandled = (reason) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  stubNavigator({
    canShare: () => true,
    clipboard: { writeText: () => clipboard },
    share: async () => { throw error; },
  });
  const sharing = shareOut({ title, markdown, images });
  try {
    await Promise.race([
      assert.rejects(sharing, (err) => err === error && err.name === "AbortError"),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("shareOut did not propagate AbortError while the clipboard write was pending within 2000 ms")), 2000);
      }),
    ]);
    rejectClipboard(new Error("Permission denied"));
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    assert.deepEqual(unhandled, [], "late clipboard rejection must be handled after share rejects");
  } finally {
    clearTimeout(timer);
    rejectClipboard(new Error("Permission denied"));
    await sharing.catch(() => {});
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    process.removeListener("unhandledRejection", onUnhandled);
  }
});
