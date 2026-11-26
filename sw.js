/* 식단·운동 기록 — service worker. Keeps the app working offline.
   When you change any file, bump VERSION so phones fetch the new files. Records are not here: they live in IndexedDB. */
const VERSION = "v4";
const CACHE = "diet-log-" + VERSION;
const SHELL = [
  "./", "./index.html", "./app.css", "./app.js", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png",
  "./barlow-condensed-600.woff2", "./barlow-condensed-700.woff2",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("diet-log-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; /* e.g. the Anthropic API: never cached */
  const path = url.pathname;
  if (req.mode === "navigate" && (path.endsWith("/") || path.endsWith("/index.html"))) {
    event.respondWith(caches.match("./index.html").then(hit => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
