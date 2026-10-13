// All fxtwitter access lives here, so a dead or changed API is a one-file fix.

const API = "https://api.fxtwitter.com/2";
const MAX_PARENTS = 5;

export class FetchError extends Error {}

const isTweet = (value) => value !== null && typeof value === "object" && typeof value.id === "string";

async function getJson(path, fetchImpl) {
  const res = await fetchImpl(API + path);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (body?.code === 404 || res.status === 404) {
    throw new FetchError("Tweet not found. It may be deleted, protected or age-restricted.");
  }
  if (!res.ok || body?.code !== 200 || !isTweet(body.status)) {
    throw new FetchError(body?.message || `fxtwitter returned HTTP ${res.status}.`);
  }
  return body;
}

// Other people's replies: one page from /conversation, ranked by likes. Its cursor
// pagination returned 404 when tested (2026-10-13), so only the first page is used.
// Replies are optional: a failure here leaves the post itself intact.
async function loadReplies(id, fetchImpl) {
  try {
    const body = await getJson(`/conversation/${id}`, fetchImpl);
    return Array.isArray(body.replies) ? body.replies.filter(isTweet) : [];
  } catch {
    return null;
  }
}

// Returns { status, thread, parents, replies }:
// status  - the tweet that was shared
// thread  - the author's own chain containing it, oldest first
// parents - tweets above the chain that it replies to, oldest first
// replies - other replies in the conversation (null if they couldn't be loaded)
export async function loadX(id, fetchImpl = fetch) {
  const repliesPromise = loadReplies(id, fetchImpl);
  const body = await getJson(`/thread/${id}`, fetchImpl);
  // Trust thread order, not replying_to: trailing self-tweets can have a null reply field.
  const chain = Array.isArray(body.thread) ? body.thread.filter(isTweet) : [];
  const thread = chain.length ? chain : [body.status];

  const parents = [];
  let reply = thread[0].replying_to;
  while (reply?.status && parents.length < MAX_PARENTS) {
    const parent = await getJson(`/status/${reply.status}`, fetchImpl).catch(() => null);
    if (!parent) break;
    parents.unshift(parent.status);
    reply = parent.status.replying_to;
  }
  const shown = new Set([...thread, ...parents].map((t) => t.id));
  const replies = (await repliesPromise)?.filter((r) => !shown.has(r.id)) ?? null;
  return { status: body.status, thread, parents, replies };
}
