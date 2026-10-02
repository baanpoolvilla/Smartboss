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
      icon: "/icon-v4.png",
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
          // บอกหน้าที่เปิดอยู่ให้เปิด URL เอง (components/shell/system-notify.tsx — เปลี่ยนหน้าในแอป ไม่โหลดใหม่)
          // เดิมสั่ง w.navigate() อย่างเดียว ถ้าสั่งไม่ได้ (หน้าต่างที่ service worker ยังไม่ได้คุม)
          // จะแค่ดึงหน้าต่างขึ้นมาเฉย ๆ ไม่ไปหน้าที่แจ้งเตือนชี้ — "กดแล้วไม่มาที่หน้านี้"
          // หน้านั้นไม่ตอบรับ (หน้าที่ไม่มีตัวรับ เช่น หน้า login / โค้ดรุ่นเก่า) → สั่ง navigate แบบเดิม
          // สั่งไม่ได้อีก → เปิดหน้าต่างใหม่ ยังไงก็ต้องไปถึงหน้าที่แจ้งเตือนชี้
          const path = url.slice(self.location.origin.length) || "/";
          const askPage = () =>
            new Promise((resolve) => {
              const ch = new MessageChannel();
              const timer = setTimeout(() => resolve(false), 800);
              ch.port1.onmessage = () => {
                clearTimeout(timer);
                resolve(true);
              };
              w.postMessage({ type: "sb-open", url: path }, [ch.port2]);
            });
          return w
            .focus()
            .catch(() => w)
            .then(askPage)
            .then((handled) => (handled ? undefined : w.navigate(url).catch(() => self.clients.openWindow(url))));
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
