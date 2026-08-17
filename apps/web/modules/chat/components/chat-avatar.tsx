"use client";

import { User } from "lucide-react";
import { cn } from "@smartboss/ui/cn";
import { avatarColorFor } from "../lib/avatar-color";

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
