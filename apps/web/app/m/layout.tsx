import type { Metadata, Viewport } from "next";

/**
 * โครงหน้าจอของ Mini App — ตั้งใจให้ "ไม่มีอะไรเลย"
 *
 * ต่างจาก `(shell)/layout.tsx` ที่ครอบด้วย rail + sidebar ของเว็บผู้บริหาร:
 * ที่นี่พนักงานทุกคนมีสิทธิ์เท่ากันหมด (`*.self`) จึงเห็นหน้าจอชุดเดียวกัน
 * ⇒ ไม่ต้องมีระบบเมนู/สิทธิ์ฝั่งนี้เลย ให้ Rich Menu ของ LINE ทำหน้าที่ nav แทน
 * (เหตุผลเต็มอยู่ใน docs/line-mini-app-checkin-spec.md ข้อ 0.7)
 *
 * LINE MINI App บังคับขนาดจอเป็น `Full` และซ่อนแถบด้านบนของ LINE ไม่ได้
 * ⇒ เผื่อที่ด้านบนไว้เสมอ อย่าวางอะไรสำคัญชิดขอบบน
 */

export const metadata: Metadata = {
  title: "SmartBoss",
  description: "ลงเวลา ขอลา และดูเรื่องของตัวเอง",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // กันจอเด้งซูมตอนโฟกัสช่องกรอกบน iOS ซึ่งทำให้ปุ่มลงเวลาหลุดออกนอกจอ
  maximumScale: 1,
  themeColor: "#ffffff",
};

export default function MiniAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-(--bg) text-(--ink)">
      {children}
    </div>
  );
}
