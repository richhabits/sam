// SAM service worker — push notifications + installable offline shell.
const CACHE = "sam-shell-v1";

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });

// 🔔 Push — SAM sent something (brief, reminder, task result) while the app was closed.
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "SAM", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(d.title || "SAM", {
    body: d.body || "",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: "sam",
    renotify: true,
    data: { url: d.url || "/" },
  }));
});

// Tap the notification → focus SAM if open, else open it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) { c.navigate && c.navigate(url); return c.focus(); } }
      return self.clients.openWindow(url);
    })
  );
});

// Network-first for the app shell (so updates land), cache as offline fallback.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).pathname.startsWith("/api/")) return;   // never cache the API
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok && req.url.startsWith(self.location.origin)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((m) => m || caches.match("/")))
  );
});
