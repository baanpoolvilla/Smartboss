"use client";

/**
 * ตัวเลขบนไอคอนแอป (หน้าจอโฮม iPhone / แถบงาน Windows / Dock Mac) = ผลรวมของทุกแหล่งที่ "ยังไม่ได้ดู"
 * แต่ละแหล่งรายงานตัวเลขของตัวเอง (กระดิ่ง = แจ้งเตือนทุกโมดูล, แชท) แล้วที่นี่รวมให้
 * ตอนแอปปิดอยู่ service worker บวกแจ้งเตือนที่เด้งเข้ามาเพิ่มต่อจากตัวเลขนี้ (public/sw.js)
 *
 * เดิมกระดิ่งเป็นคนตั้งตัวเลขนี้คนเดียว และแชทไม่ลงกระดิ่ง ⇒ มีแชทค้างอ่านกี่ข้อความไอคอนก็ไม่ขึ้นเลข
 * ซ้ำร้ายพอเปิดแอป กระดิ่ง (0 รายการ) ก็ล้างจุดที่แจ้งเตือนเด้งเพิ่งตั้งไว้ทิ้งไปด้วย
 *
 * Badging API ใช้ได้กับแอปที่ติดตั้งบน Chrome/Edge (คอม) และ iPhone/iPad 16.4+ ที่อนุญาตแจ้งเตือนแล้ว
 * เครื่องที่ไม่รองรับข้ามเงียบ ๆ (Android ขึ้นจุดเองจากแจ้งเตือนที่ค้างอยู่)
 */
const parts = new Map<string, number>();

/** ที่เก็บเดียวกับ public/sw.js (bumpAppBadge) — base = ตัวเลขจริงล่าสุด, extra = แจ้งเตือนที่เด้งหลังจากนั้น */
const BADGE_CACHE = "sb-app-badge-v1";

function rememberForServiceWorker(total: number): void {
  if (typeof caches === "undefined") return;
  void caches
    .open(BADGE_CACHE)
    .then((cache) =>
      Promise.all([
        cache.put("/__badge/base", new Response(String(total))),
        cache.put("/__badge/extra", new Response("0")),
      ])
    )
    .catch(() => undefined);
}

export function setAppBadgePart(source: "bell" | "chat", count: number): void {
  parts.set(source, Math.max(0, Math.floor(count) || 0));
  if (typeof navigator === "undefined") return;
  let total = 0;
  for (const n of parts.values()) total += n;
  rememberForServiceWorker(total);
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (!nav.setAppBadge) return;
  void (total > 0 ? nav.setAppBadge(total) : nav.clearAppBadge?.())?.catch(() => undefined);
}
