/*
 * Ambika Groups CRM service worker (spec §3 Mobile: installable PWA that keeps working on slow networks).
 * Pages: network first, falling back to the cached copy when offline. Static assets (/_next/static,
 * icons, fonts): cache first, since their file names change with every build.
 * Data never goes through this cache: Firestore's own offline persistence handles it (spec §3.1 rule 11).
 */
const VERSION = "ag-crm-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isStatic = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.hostname === "fonts.gstatic.com";
  if (url.origin !== self.location.origin && url.hostname !== "fonts.gstatic.com" && url.hostname !== "fonts.googleapis.com") return;
  if (url.pathname.startsWith("/__/")) return; // Firebase auth proxy (D-35): never cached

  if (isStatic) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }
  if (req.mode === "navigate" || url.hostname === "fonts.googleapis.com") {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
    );
  }
});

/*
 * Push notifications (Firebase Cloud Messaging, Setup & integrations). FCM delivers a standard Web Push message; this
 * shows it without loading the Firebase code into the worker, and opens the CRM when it is pressed.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const n = data.notification || data.data || {};
  const link = (data.fcmOptions && data.fcmOptions.link) || n.link || "/";
  event.waitUntil(self.registration.showNotification(n.title || "Ambika CRM", { body: n.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { link } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ("focus" in w) { w.navigate(link).catch(() => undefined); return w.focus(); } }
      return self.clients.openWindow(link);
    }),
  );
});
