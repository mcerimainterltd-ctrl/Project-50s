const CACHE_NAME = "xamepage-v2.1-PROD";

const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "script.js",
  "manifest.json",

  "xamepage_icon.png",
  "xamepage_splash.png",

  "xamepage_call.mp3",
  "xamepage_outgoing.mp3",
  "xamepage_message.mp3"
];

/* Install: cache everything */
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

/* Activate: delete old cache */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Fetch: network first for socket, cache first for UI */
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  /* Always use network for socket.io */
  if (url.pathname.includes("/socket.io")) {
    event.respondWith(fetch(event.request));
    return;
  }

  /* Navigation (app start) */
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("index.html"))
    );
    return;
  }

  /* Static files */
  event.respondWith(
    caches.match(event.request).then(res => {
      return res || fetch(event.request).then(networkRes => {
        if (networkRes.ok) {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return networkRes;
      });
    })
  );
});
