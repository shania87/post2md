// All Reddit access lives here. Reddit blocks anonymous reads from other sites and from cloud
// servers, so posts come from the Arctic Shift archive (CORS-open, no key). Share links
// (/r/<sub>/s/<code>) are turned into a post ID by our relay (worker/threads-relay.js).

import { RELAY } from "./threads.js";

export const API = "https://arctic-shift.photon-reddit.com/api";
export const MAX_COMMENTS = 100;
const TIMEOUT_MS = 20000;

export class FetchError extends Error {}

const isObject = (value) => value !== null && typeof value === "object";
const isPost = (value) => isObject(value) && typeof value.id === "string";

async function getJson(url, fetchImpl, unreachable) {
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new FetchError(unreachable);
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new FetchError(typeof body?.error === "string" ? body.error : `${unreachable} (HTTP ${res.status})`);
  return body;
}

async function shareTarget(link, fetchImpl) {
  const body = await getJson(`${RELAY}?url=${encodeURIComponent(link.url)}`, fetchImpl,
    "Couldn't resolve the Reddit share link. Some networks block workers.dev; try mobile data.");
  const id = typeof body?.url === "string" ? body.url.match(/\/comments\/(\w+)/)?.[1] : undefined;
  if (!id) throw new FetchError("The relay sent back something unexpected for that share link.");
  return id.toLowerCase();
}

async function loadPost(id, fetchImpl) {
  const body = await getJson(`${API}/posts/ids?ids=${id}`, fetchImpl, "Couldn't reach the Arctic Shift archive.");
  const post = Array.isArray(body?.data) ? body.data.find(isPost) : undefined;
  if (!post) {
    throw new FetchError("This post isn't in the Arctic Shift archive. Very new posts can take up to a day to appear.");
  }
  return post;
}

// Keeps comments ("t1") and drops "more" stubs: expanding them is out of scope.
function commentTree(listing) {
  if (!Array.isArray(listing)) return [];
  return listing.filter((item) => item?.kind === "t1" && isPost(item.data)).map(({ data }) => ({
    ...data,
    replies: commentTree(data.replies?.data?.children),
  }));
}

// Comments are optional: a failure here leaves the post itself intact.
async function loadComments(id, fetchImpl) {
  try {
    const body = await getJson(`${API}/comments/tree?link_id=${id}&limit=${MAX_COMMENTS}`, fetchImpl, "Comments failed.");
    return Array.isArray(body?.data) ? commentTree(body.data) : null;
  } catch {
    return null;
  }
}

// Returns { post, comments }:
// post     - the archived post (Reddit's own JSON shape)
// comments - comment tree, each with `replies` (null if they couldn't be loaded)
export async function loadReddit(link, fetchImpl = fetch) {
  const id = link.id ?? await shareTarget(link, fetchImpl);
  const [post, comments] = await Promise.all([loadPost(id, fetchImpl), loadComments(id, fetchImpl)]);
  return { post, comments };
}
