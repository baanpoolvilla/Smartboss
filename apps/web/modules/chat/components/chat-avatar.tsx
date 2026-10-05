"use client";

import { User } from "lucide-react";
import { cn } from "@smartboss/ui/cn";
import { avatarColorFor } from "../lib/avatar-color";
import { useChatStore } from "../store/chat-store";

/**
 * Avatar เฉพาะของโมดูลแชท — ต่างจาก Avatar กลาง (@smartboss/ui) ตรงที่ไม่มีรูป
 * แล้วโชว์ไอคอนคนกลาง ๆ แทนตัวอักษรย่อชื่อ (ยังไม่มีที่ไหนในระบบให้อัปโหลดรูป
 * โปรไฟล์เลย ตัวอักษรย่อของทุกคนเลยไม่มีความหมายอะไรเป็นพิเศษ) สีพื้นหลังยังคง
 * ต่างกันตามคน (ดู avatarColorFor) เพื่อแยก avatar คนละคนออกจากกันได้เหมือนเดิม
 */
export function ChatAvatar({
  name,
  src,
  colorKey,
  color,
  className,
}: {
  name: string;
  src?: string | null;
  /** ใช้คำนวณสีพื้นหลัง — ปกติคือ userId เจ้าของ avatar (ไม่ใช่ name เพราะชื่อซ้ำกันได้) */
  colorKey: string;
  /** ข้ามการคำนวณสีจาก colorKey — ใช้กับห้องรวมทั้งบริษัทที่อยากได้สีแบรนด์คงที่
   * แทนสีสุ่มตามคน เพราะห้องนั้นเป็น "ทุกคน" ไม่ใช่ของใครคนเดียว */
  color?: { bg: string; text: string };
  className?: string;
}) {
  const resolved = color ?? avatarColorFor(colorKey);
  return (
    <div
      className={cn("relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full", className)}
      style={{ backgroundColor: resolved.bg, color: resolved.text }}
      title={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <User className="h-[55%] w-[55%]" strokeWidth={2} />
      )}
    </div>
  );
}

/**
 * ป้ายวันหยุดเกาะมุมขวาล่างของรูปโปรไฟล์ — คนนี้หยุดวันนี้ (ใบลา/วันหยุดที่อนุมัติแล้ว, ดู data/off-today.ts)
 * เป็นรูปปฏิทินตั้งโต๊ะเล็ก ๆ ("มีสัญลักษณ์นี้ติดไว้ ก็ดีนะ รู้เลยวันนี้วันหยุด") หยุดเหมือนกันแต่คนละแบบ
 * จึงต่างกันที่สีหัวปฏิทินกับคำ: วันหยุดประจำ (Day-Off) = แดง "OFF" · วันลา (ป่วย/กิจ/พักร้อน/ไม่รับค่าจ้าง) = ส้ม "ลา"
 * · Holiday (วันหยุดของเดือนที่ HR ตั้งในปฏิทินวันหยุด) = น้ำเงิน "HOL"
 * วางในกรอบ `relative` เดียวกับรูปโปรไฟล์ อ่านค่าจาก store เอง ที่เรียกใช้ส่งแค่ userId
 */
const OFF_STYLE = {
  off: { color: "#ef4444", text: "OFF", size: 7.2, hint: "Day-Off" },
  holiday: { color: "#2563eb", text: "HOL", size: 7.2, hint: "Holiday" },
  leave: { color: "#f59e0b", text: "ลา", size: 8.5, hint: "ลา" },
} as const;

export function OffBadge({ userId }: { userId: string | undefined }) {
  const own = useChatStore((s) => (userId ? s.offIds[userId] : undefined));
  const holiday = useChatStore((s) => s.holidayToday);
  // ใบหยุด/ลาของตัวเองมาก่อน · ไม่มี แต่วันนี้เป็นวันหยุดของบริษัท = Holiday
  const off = own ?? (userId && holiday ? ({ kind: "holiday", name: holiday } as const) : undefined);
  if (!off) return null;
  const style = OFF_STYLE[off.kind] ?? OFF_STYLE.off;
  const label = `หยุดวันนี้ · ${off.name || style.hint}`;
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      className="pointer-events-none absolute -bottom-1.5 -right-2 h-[22px] w-[22px] drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.3)]"
    >
      <title>{label}</title>
      {/* ตัวปฏิทิน (ขาว) + หัวสีตามชนิด + ห่วงสองอัน */}
      <rect x="1.5" y="3.5" width="21" height="19" rx="3.5" fill="#ffffff" stroke="#e5e7eb" strokeWidth="1" />
      <path d="M1.5 7a3.5 3.5 0 0 1 3.5-3.5h14A3.5 3.5 0 0 1 22.5 7v3.5h-21z" fill={style.color} />
      <rect x="6.5" y="1" width="2.2" height="6" rx="1.1" fill="#374151" />
      <rect x="15.3" y="1" width="2.2" height="6" rx="1.1" fill="#374151" />
      <text x="12" y="19.4" textAnchor="middle" fontSize={style.size} fontWeight="800" fill="#1f2937" style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "0.2px" }}>
        {style.text}
      </text>
    </svg>
  );
}
