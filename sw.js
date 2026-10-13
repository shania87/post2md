// Exists so Chrome treats the page as installable (and so it can be a share target).
// Network first; the cached shell only covers opening the app with no connection.

const CACHE = "post2md-v2";
const SHELL = ["./", "index.html", "app.js", "resolve.js", "sites.js", "x.js", "format-x.js", "share.js",
  "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    // Cache storage is shared by every project on <user>.github.io, so only touch our own.
    Promise.all(keys.filter((key) => key.startsWith("post2md-") && key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
