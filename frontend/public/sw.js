const STATIC_CACHE = "touchspace-static-v1";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/pwa/icon-192.svg",
  "/pwa/icon-512.svg",
  "/pwa/badge.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/login"))),
    );
    return;
  }

  if (["style", "script", "image", "font"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }

        return fetch(request).then((response) => {
          const responseClone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, responseClone));
          return response;
        });
      }),
    );
  }
});

self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};

  event.waitUntil(
    self.registration.showNotification(payload.title || "TouchSpace", {
      body: payload.body || "Новое событие в TouchSpace",
      icon: payload.icon || "/pwa/icon-192.svg",
      badge: payload.badge || "/pwa/badge.svg",
      tag: payload?.data?.tag || "touchspace-notification",
      data: payload.data || { url: "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        const clientUrl = new URL(client.url);
        const absoluteTarget = new URL(targetUrl, self.location.origin);

        if (clientUrl.origin === absoluteTarget.origin) {
          client.focus();
          if ("navigate" in client) {
            return client.navigate(absoluteTarget.href);
          }
          return client;
        }
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});
