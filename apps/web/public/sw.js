/* Service worker ของ SmartBoss — ตอนนี้ทำหน้าที่เดียว: รับ Web Push แล้วเด้งแจ้งเตือน
 * (payload มาจาก apps/web/lib/web-push.ts: { title, body, url, tag })
 * ไม่ cache หน้าเว็บ — ตั้งใจ ไม่อยากให้ผู้ใช้ติดเวอร์ชันเก่าหลัง deploy */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/* ตัวเลขบนไอคอนแอปตอนแอปปิด/พักอยู่ = จำนวนที่ยังไม่ได้ดูตอนหน้าเว็บรายงานครั้งล่าสุด (base)
 * + แจ้งเตือนที่เด้งเข้ามาหลังจากนั้น (extra) — ทุกแจ้งเตือนคือของใหม่ที่ยังไม่ได้ดูหนึ่งอย่าง
 * (ข้อความแชท, แท็ก, งาน, อนุมัติ ฯลฯ) จึงนับได้ครบทุกโมดูลโดยไม่ต้องถามเซิร์ฟเวอร์
 * เปิดแอปแล้วหน้าเว็บเขียนตัวเลขจริงทับและล้าง extra (lib/app-badge.ts ใช้ที่เก็บเดียวกัน)
 * เครื่องที่ไม่มี Badging API ข้าม (Android ขึ้นจุดเองจากแจ้งเตือนที่ค้างอยู่) */
const BADGE_CACHE = "sb-app-badge-v1";
async function bumpAppBadge() {
  if (!self.navigator || typeof self.navigator.setAppBadge !== "function") return;
  try {
    const cache = await caches.open(BADGE_CACHE);
    const read = async (key) => {
      const res = await cache.match("/__badge/" + key);
      return res ? Number(await res.text()) || 0 : 0;
    };
    const extra = (await read("extra")) + 1;
    await cache.put("/__badge/extra", new Response(String(extra)));
    await self.navigator.setAppBadge((await read("base")) + extra);
  } catch {
    // ที่เก็บใช้ไม่ได้ — อย่างน้อยให้มีจุดบนไอคอน
    await self.navigator.setAppBadge().catch(() => {});
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "SmartBoss", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "SmartBoss";
  event.waitUntil(bumpAppBadge());
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
  // หน้าต่างใหม่ที่เปิดจากแจ้งเตือน — ติดป้ายไว้ ให้หน้าเว็บรู้ว่าไม่ต้องขึ้นหน้าชวนติดตั้งแอปมาบัง
  // (Android: แจ้งเตือนของเบราว์เซอร์ เช่น Samsung Internet เปิดเป็นแท็บเบราว์เซอร์ ไม่ใช่ในแอป)
  const fresh = new URL(url);
  fresh.searchParams.set("sb_from", "push");
  const freshUrl = fresh.href;
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
            .then((handled) => (handled ? undefined : w.navigate(url).catch(() => self.clients.openWindow(freshUrl))));
        }
      }
      return self.clients.openWindow(freshUrl);
    })
  );
});
