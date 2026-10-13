// Turns whatever the share sheet or paste box hands us into { site, ... }.
// Adding a site means adding a matcher here plus an entry in sites.js.

// Anchored and applied per token, so long junk text stays linear (an unanchored scan was quadratic).
const URL_RE = /^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\/\S*$/i;
const TOKEN_SPLIT = /[\s<>"']+/;

const MATCHERS = [
  {
    site: "x",
    hosts: ["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com",
      "fxtwitter.com", "vxtwitter.com", "fixupx.com", "fixvx.com"],
    parse(url) {
      const m = url.pathname.match(/^\/(?:([^/]+)\/status(?:es)?|i\/web\/status)\/(\d+)(?=\/|$)/);
      if (!m) return null;
      const user = m[1] || "i";
      return { id: m[2], user, url: `https://x.com/${user}/status/${m[2]}` };
    },
  },
  {
    site: "reddit",
    hosts: ["reddit.com", "old.reddit.com", "new.reddit.com", "m.reddit.com", "np.reddit.com", "redd.it"],
    parse(url) {
      const origin = url.hostname === "redd.it" ? "https://redd.it" : "https://www.reddit.com";
      return { url: origin + url.pathname };
    },
  },
];

export function findUrls(...texts) {
  const found = [];
  for (const text of texts) {
    if (!text) continue;
    for (let token of String(text).split(TOKEN_SPLIT)) {
      const scheme = token.search(/https?:\/\//i);
      token = (scheme > 0 ? token.slice(scheme) : token).replace(/^[([{]+/, "").replace(/[)\]}.,;:!?]+$/, "");
      if (URL_RE.test(token)) found.push(/^https?:\/\//i.test(token) ? token : `https://${token}`);
    }
  }
  return found;
}

export function resolve(...texts) {
  for (const raw of findUrls(...texts)) {
    let url;
    try { url = new URL(raw); } catch { continue; }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const matcher of MATCHERS) {
      if (!matcher.hosts.includes(host)) continue;
      const parsed = matcher.parse(url);
      if (parsed) return { site: matcher.site, ...parsed };
    }
  }
  return null;
}
