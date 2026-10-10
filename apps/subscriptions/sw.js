// Offline support: app shell is precached and served cache-first, then refreshed
// in the background (stale-while-revalidate) so updates land on the next launch.
const CACHE = "subs-v2";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "schedule.js",
  "ics.js",
  "store.js",
  "app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // Navigations (incl. ?add / ?view=… shortcuts) share the cached shell.
      const key = request.mode === "navigate" ? "./" : request;
      const cached = await cache.match(key, { ignoreSearch: request.mode === "navigate" });
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            cache.put(key, res.clone());
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => (list[0] ? list[0].focus() : self.clients.openWindow("./"))),
  );
});
