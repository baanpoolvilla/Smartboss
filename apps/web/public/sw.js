/* Service worker ของ SmartBoss — ตอนนี้ทำหน้าที่เดียว: รับ Web Push แล้วเด้งแจ้งเตือน
 * (payload มาจาก apps/web/lib/web-push.ts: { title, body, url, tag })
 * ไม่ cache หน้าเว็บ — ตั้งใจ ไม่อยากให้ผู้ใช้ติดเวอร์ชันเก่าหลัง deploy */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "SmartBoss", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "SmartBoss";
  // จุดบนไอคอนแอปตอนปิดแอปอยู่ (ไม่รู้ตัวเลขที่นี่) — เปิดแอปแล้วหน้าเว็บตั้งเป็นตัวเลขจริงแทน
  // (notification-bell-popover.tsx) เครื่องที่ไม่มี Badging API ข้าม
  if (self.navigator && typeof self.navigator.setAppBadge === "function") {
    self.navigator.setAppBadge().catch(() => {});
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "/icon-v3.png",
      // Android: ไอคอนเล็กบนแถบสถานะต้องเป็นรูปขาวบนพื้นใส (ใช้รูปสีจะเห็นเป็นก้อนขาว)
      badge: "/badge-v2.png",
      // Android: สั่นสองจังหวะสั้น (iPhone/คอมไม่สนค่านี้)
      vibrate: [180, 80, 180],
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // มีแท็บ SmartBoss เปิดอยู่แล้ว → ใช้แท็บนั้น ไม่เปิดแท็บใหม่ซ้อน
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
