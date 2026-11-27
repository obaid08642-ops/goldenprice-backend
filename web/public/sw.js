// Minimal service worker: makes the site installable and keeps the app shell available offline. Prices are never cached here (they always come from the network).
const V = "pr-v1", SHELL = ["/favicon.svg", "/logo.svg", "/manifest.webmanifest"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.startsWith("/_astro/") || /\.(png|svg|ico|woff2?)$/.test(u.pathname)) { e.respondWith(caches.match(r).then((m) => m || fetch(r).then((x) => { const c = x.clone(); caches.open(V).then((ch) => ch.put(r, c)); return x; }))); return; }
  if (r.mode === "navigate") e.respondWith(fetch(r).then((x) => { const c = x.clone(); caches.open(V).then((ch) => ch.put(r, c)); return x; }).catch(() => caches.match(r).then((m) => m || caches.match("/en/us/"))));
});
