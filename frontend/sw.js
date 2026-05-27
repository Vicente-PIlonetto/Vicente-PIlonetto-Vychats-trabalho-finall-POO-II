const CACHE_NAME = "vychat-static-v5";
const STATIC_ASSETS = [
  "/",
  "/login",
  "/servers",
  "/chat",
  "/dms",
  "/dm-users",
  "/settings",
  "/friends",
  "/static/app.css",
  "/static/app.js",
  "/static/script.js",
  "/static/chat.js",
  "/static/dm.js",
  "/static/servers.js",
  "/static/login.js",
  "/static/settings.js",
  "/static/friends.js",
  "/static/manifest.json",
  "/static/icon.svg",
  "/static/icon-180.png",
  "/static/Vy_icon_blue_transparent.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
