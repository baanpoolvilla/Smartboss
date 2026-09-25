import type { MetadataRoute } from "next";

/**
 * ทำให้ SmartBoss "เพิ่มลงหน้าจอหลัก" ได้เป็นเว็บแอป (PWA) — เปิดจากไอคอนแล้วเต็มจอ
 * ไม่มีแถบเบราว์เซอร์ เหมือนแอปทั่วไป และเป็นเงื่อนไขที่ iPhone ต้องมีก่อนถึงจะรับ
 * แจ้งเตือนเด้ง (Web Push) ได้ — ไม่ได้ทำแอปมือถือแยก ใช้เว็บตัวเดียวทุกเครื่อง
 */
// ⚠ เปลี่ยนรูปไอคอนเมื่อไหร่ ให้เปลี่ยนชื่อไฟล์ด้วย (-v2 → -v3) — แอปที่ติดตั้งไว้แล้ว (Chrome/Android)
// จำไอคอนตามชื่อไฟล์ ถ้าชื่อเดิม จะไม่รู้ว่ารูปเปลี่ยนและค้างไอคอนเก่าไปเรื่อย ๆ
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SmartBoss",
    short_name: "SmartBoss",
    description: "ระบบบริหารจัดการภายในองค์กร — งาน รายงาน แชท และบุคคล",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "th",
    icons: [
      { src: "/icon-v2.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512-v2.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-touch-icon-v2.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
