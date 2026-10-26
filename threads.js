// All Threads access lives here. threads.com can't be read cross-origin, so pages come through
// our Cloudflare relay (worker/threads-relay.js) as { url, html }; the parsing happens here so a
// change on Meta's side is a Pages fix, not a relay redeploy.

export const RELAY = "https://post2md-threads.llmdragons.workers.dev/";
const TIMEOUT_MS = 20000;

export class FetchError extends Error {}

const SCRIPT_RE = /<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
const isPost = (value) => value !== null && typeof value === "object" && typeof value.code === "string";
const nodes = (connection) => (Array.isArray(connection?.posts?.edges) ? connection.posts.edges : [])
  .map((edge) => edge?.node).filter(isPost);

// Every `media` object under a GraphQL result, skipping relatedPosts (unrelated posts).
function mediaObjects(html) {
  const found = [];
  const walk = (value, key) => {
    if (!value || typeof value !== "object" || key === "relatedPosts") return;
    if (key === "media" && value.text_post_app_info && typeof value.id === "string") found.push(value);
    for (const [k, child] of Object.entries(value)) walk(child, k);
  };
  for (const [, json] of html.matchAll(SCRIPT_RE)) {
    if (!json.includes("text_post_app_info")) continue;
    try { walk(JSON.parse(json)); } catch { /* not JSON we understand; skip it */ }
  }
  return found;
}

// A post arrives split across several blocks that share its media id: the post itself (with
// `code`), one holding containing_thread, one holding self_thread and direct_replies.
export function parsePage(html, code) {
  const media = mediaObjects(String(html));
  const post = media.find((m) => m.code === code);
  if (!post) throw new FetchError("Couldn't find the post in the Threads page. It may be private or deleted.");
  const info = {};
  for (const m of media) if (m.id === post.id) Object.assign(info, m.text_post_app_info);
  const replies = info.direct_replies;
  return {
    post,
    ancestors: nodes(info.containing_thread),
    continuation: nodes(info.self_thread),
    replyChains: Array.isArray(replies?.edges)
      ? replies.edges.map((edge) => nodes(edge?.node)).filter((chain) => chain.length)
      : null,
  };
}

const postUrl = (post) => `https://www.threads.com/@${post.user?.username}/post/${post.code}`;

async function fetchPage(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${RELAY}?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new FetchError("Couldn't reach the Threads relay. Some networks block workers.dev; try mobile data.");
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new FetchError(typeof body?.error === "string" ? body.error : `The Threads relay returned HTTP ${res.status}.`);
  const code = typeof body?.url === "string" && body.url.match(/\/post\/([\w-]+)/)?.[1];
  if (!code || typeof body.html !== "string") throw new FetchError("The Threads relay sent back something unexpected.");
  return parsePage(body.html, code);
}

// Returns { post, thread, parents, replies, notice }:
// post    - the post that was shared
// thread  - the author's own chain containing it, oldest first
// parents - posts above the chain that it replies to, oldest first
// replies - reply chains under the thread's first post (null if they couldn't be loaded)
// notice  - set when only part of the thread could be loaded
export async function loadThreads(link, fetchImpl = fetch) {
  const page = await fetchPage(link.url, fetchImpl);
  const { post, ancestors } = page;
  let thread = [post, ...page.continuation];
  let parents = ancestors;
  let chains = page.replyChains;
  let notice = null;

  // Same-author posts directly above may be earlier parts of a self-thread, or the author
  // answering in their own comments. Only the root's self_thread can tell the two apart.
  let run = ancestors.length;
  while (run > 0 && ancestors[run - 1].user?.pk === post.user?.pk) run--;
  if (run < ancestors.length) {
    try {
      const root = await fetchPage(postUrl(ancestors[run]), fetchImpl);
      if (root.continuation.some((p) => p.code === post.code)) {
        thread = [root.post, ...root.continuation];
        parents = ancestors.slice(0, run);
        chains = root.replyChains;
      }
    } catch {
      notice = "Couldn't load the full thread; showing the shared post.";
    }
  }

  const shown = new Set([...thread, ...parents].map((p) => p.code));
  const replies = chains?.map((chain) => chain.filter((p) => !shown.has(p.code))).filter((chain) => chain.length) ?? null;
  return { post, thread, parents, replies, notice };
}
