const cacheName = "paastacode-offline-v1";
const offlineAssets = ["/offline.html", "/offline.css", "/fonts/Vazirmatn.woff2", "/brand.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(offlineAssets)));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("paastacode-offline-") && key !== cacheName).map(key => caches.delete(key)))));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  // Account data, source files, API calls and downloads must never enter an offline cache.
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
    return;
  }
  if (offlineAssets.includes(url.pathname) && !url.search) {
    event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname)));
  }
});
