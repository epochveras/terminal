self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let data = { title: "Epochveras", body: "Alarm tetiklendi", url: "/" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title || "Epochveras", {
    body: data.body || "Alarm tetiklendi",
    icon: "/icon-5122.png",
    badge: "/icon-5122.png",
    tag: data.tag || "alarm",
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 300],
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if (w.url.startsWith(self.location.origin)) { await w.focus(); return w.navigate ? w.navigate(target) : null; } }
    return self.clients.openWindow(target);
  })());
});
