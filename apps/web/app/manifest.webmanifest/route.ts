import type { MetadataRoute } from "next";

/**
 * ทำให้ SmartBoss "เพิ่มลงหน้าจอหลัก" ได้เป็นเว็บแอป (PWA) — เปิดจากไอคอนแล้วเต็มจอ
 * ไม่มีแถบเบราว์เซอร์ เหมือนแอปทั่วไป และเป็นเงื่อนไขที่ iPhone ต้องมีก่อนถึงจะรับ
 * แจ้งเตือนเด้ง (Web Push) ได้ — ไม่ได้ทำแอปมือถือแยก ใช้เว็บตัวเดียวทุกเครื่อง
 *
 * เป็น route (ไม่ใช่ app/manifest.ts) เพราะต้องดูว่าเครื่องที่ขอเป็นคอมหรือมือถือ:
 *   คอม (Windows/Mac/Linux) — ส่งเฉพาะไอคอนมุมมน (PNG มุมโปร่งใส) · ถ้ามีไอคอน "maskable" ให้เลือก
 *     Chrome บน Windows หยิบตัวนั้น (สี่เหลี่ยมเต็มกรอบที่ทำไว้ให้มือถือตัดมุมเอง) ไปทำไอคอน Taskbar
 *     ได้ไอคอนเหลี่ยม ("ในแอป pc เป็นเหลี่ยม แต่ในเว็บมน" · "เอาให้มนเต็มขนาด")
 *   มือถือ — ส่งครบ: Android ใช้ maskable (พื้นเขียวเต็มกรอบ ตัดเป็นวงกลม/มุมมนเอง ไม่มีขอบขาว)
 */
// ⚠ เปลี่ยนรูปไอคอนเมื่อไหร่ ให้เปลี่ยนชื่อไฟล์ด้วย (-v6 → -v7) — แอปที่ติดตั้งไว้แล้ว (Chrome/Android)
// จำไอคอนตามชื่อไฟล์ ถ้าชื่อเดิม จะไม่รู้ว่ารูปเปลี่ยนและค้างไอคอนเก่าไปเรื่อย ๆ
export const dynamic = "force-dynamic";

const BASE: Omit<MetadataRoute.Manifest, "icons"> = {
  name: "SmartBoss",
  short_name: "SmartBoss",
  description: "ระบบบริหารจัดการภายในองค์กร — งาน รายงาน แชท และบุคคล",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  lang: "th",
};

// สี่เหลี่ยมมุมมนพื้นเขียว (มุมโปร่งใส) — คอม/แท็บ/Taskbar แสดงตามรูปนี้
const ROUNDED: MetadataRoute.Manifest["icons"] = [
  { src: "/icon-v6.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icon-512-v6.png", sizes: "512x512", type: "image/png", purpose: "any" },
];
// มือถือเท่านั้น — พื้นเขียวเต็มกรอบ (ไม่มีมุมโปร่งใส) เครื่องตัดมุมเอง
const PHONE_ONLY: MetadataRoute.Manifest["icons"] = [
  { src: "/icon-512-maskable-v6.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  { src: "/apple-touch-icon-v6.png", sizes: "180x180", type: "image/png" },
];

/** มือถือ/แท็บเล็ต — Android, iPhone/iPad (iPadOS ใหม่บอกตัวเป็น Mac แต่มีจอสัมผัส ซึ่ง UA ไม่บอก จึงนับเป็นคอม — iPad ใช้ apple-touch-icon จาก <head> อยู่แล้ว) */
function isMobile(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export function GET(req: Request) {
  const mobile = isMobile(req.headers.get("user-agent") ?? "");
  const manifest: MetadataRoute.Manifest = { ...BASE, icons: mobile ? [...ROUNDED!, ...PHONE_ONLY!] : ROUNDED };
  return Response.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      // คนละเนื้อหาตามเครื่อง — cache กลางทางต้องแยกตาม UA
      Vary: "User-Agent",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
