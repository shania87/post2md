// Turns whatever the share sheet or paste box hands us into { site, ... }.
// Adding a site means adding a matcher here plus an entry in sites.js.

const URL_RE = /(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}\/[^\s<>"']*/gi;

const MATCHERS = [
  {
    site: "x",
    hosts: ["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com",
      "fxtwitter.com", "vxtwitter.com", "fixupx.com", "fixvx.com"],
    parse(url) {
      const m = url.pathname.match(/^\/(?:([^/]+)\/status(?:es)?|i\/web\/status)\/(\d+)/);
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
    for (const match of String(text).matchAll(URL_RE)) {
      const raw = match[0].replace(/[).,;!?]+$/, "");
      found.push(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
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
