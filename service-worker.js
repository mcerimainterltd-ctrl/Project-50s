CACHE_NAME = "xamepage-v2.1-PROD";

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

// ===== PUSH NOTIFICATION HANDLER =====
self.addEventListener('push', (e) => {
    if (!e.data) return;

    const data = e.data.json();

    if (data.type === 'incoming-call') {
        e.waitUntil(
            self.registration.showNotification(`Incoming ${data.callType} call`, {
                body: `${data.callerName || data.callerId} is calling you`,
                icon: '/media/icons/icon-192.png',
                badge: '/media/icons/icon-96.png',
                tag: 'incoming-call',
                renotify: true,
                requireInteraction: true,
                vibrate: [500, 200, 500],
                data: {
                    callerId: data.callerId,
                    callId: data.callId,
                    callType: data.callType,
                    url: '/'
                },
                actions: [
                    { action: 'accept', title: '✅ Accept' },
                    { action: 'decline', title: '❌ Decline' }
                ]
            })
        );
    }
});

// ===== NOTIFICATION CLICK HANDLER =====
self.addEventListener('notificationclick', (e) => {
    e.notification.close();

    if (e.action === 'decline') {
        fetch('/api/decline-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId: e.notification.data.callId })
        }).catch(console.error);
        return;
    }

    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            if (clientList.length > 0) {
                return clientList[0].focus();
            }
            return clients.openWindow(e.notification.data.url || '/');
        })
    );
});