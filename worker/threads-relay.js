// Cloudflare Worker: fetches a public Threads post page for post2md.
// threads.com sends no CORS header, so the page can't read it directly. This relay only fetches
// Threads post and share links and hands back the HTML; all parsing happens in the page
// (threads.js), so a change on Meta's side is a Pages fix, not a redeploy.
// It also resolves Reddit share links (/r/<sub>/s/<code>), which a page can't follow itself.

const HOSTS = new Set(["threads.com", "www.threads.com", "threads.net", "www.threads.net"]);
const PATH = /^\/(?:@[\w.]+\/post\/[\w-]+|t\/[\w-]+|share\/[\w-]+)\/?$/;
const REDDIT_HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "m.reddit.com"]);
const REDDIT_SHARE = /^\/r\/\w+\/s\/\w+\/?$/;
const REDDIT_POST = /^\/r\/\w+\/comments\/\w+(?:\/|$)/;
const ALLOWED_ORIGINS = new Set(["https://shania87.github.io", "http://localhost:8000", "http://127.0.0.1:8000"]);
const MAX_HOPS = 3;

// Without browser-like headers Threads returns an empty app shell instead of the post.
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Site": "none",
};

const allowed = (url, hosts, path) => url.protocol === "https:" && hosts.has(url.hostname) && path.test(url.pathname);
const isRedirect = (res) => res.status >= 300 && res.status < 400;

export function threadsUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!allowed(url, HOSTS, PATH)) return null;
  return new URL(url.origin + url.pathname);
}

function redditUrl(raw, path, base) {
  let url;
  try { url = new URL(raw, base); } catch { return null; }
  if (!allowed(url, REDDIT_HOSTS, path)) return null;
  return new URL("https://www.reddit.com" + url.pathname);
}

export const redditShareUrl = (raw) => redditUrl(raw, REDDIT_SHARE);

function reply(status, body, origin) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Vary": "Origin" };
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

// Reddit blocks post pages from Cloudflare, but its share links still redirect (a full browser
// user-agent is needed). Only the post URL comes back; the page reads the post from Arctic Shift.
async function resolveRedditShare(url, origin, fetchImpl) {
  const res = await fetchImpl(url, { headers: { "User-Agent": BROWSER_HEADERS["User-Agent"] }, redirect: "manual" });
  const location = isRedirect(res) ? res.headers.get("Location") : null;
  const post = location && redditUrl(location, REDDIT_POST, url);
  if (!post) return reply(502, { error: `Reddit didn't resolve that share link (HTTP ${res.status}).` }, origin);
  return reply(200, { url: post.href }, origin);
}

export async function relay(request, fetchImpl = fetch) {
  const origin = request.headers.get("Origin") || "";
  if (request.method !== "GET") return reply(405, { error: "GET only." }, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply(403, { error: "Origin not allowed." }, origin);

  const target = new URL(request.url).searchParams.get("url") || "";
  const share = redditShareUrl(target);
  if (share) return resolveRedditShare(share, origin, fetchImpl);

  const url = threadsUrl(target);
  if (!url) return reply(400, { error: "Not a Threads post link." }, origin);
  return fetchThreads(url, origin, fetchImpl);
}

async function fetchThreads(url, origin, fetchImpl) {
  // Share links answer with a redirect to the post; follow it by hand so every hop stays on Threads.
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const res = await fetchImpl(url, { headers: BROWSER_HEADERS, redirect: "manual" });
    if (isRedirect(res)) {
      const next = threadsUrl(new URL(res.headers.get("Location") || "", url).href);
      if (!next) return reply(502, { error: "Threads redirected somewhere unexpected." }, origin);
      url = next;
      continue;
    }
    if (!res.ok) return reply(502, { error: `Threads returned HTTP ${res.status}.` }, origin);
    return reply(200, { url: url.href, html: await res.text() }, origin);
  }
  return reply(502, { error: "Too many redirects." }, origin);
}

export default { fetch: (request) => relay(request) };
