"use client";

import { useRef } from "react";

/**
 * เลื่อนรายการข้อความด้วยนิ้ว → คีย์บอร์ดหุบลง (แบบ Discord/LINE) ได้พื้นที่อ่านเต็มจอ จะพิมพ์ค่อยแตะช่องพิมพ์
 * ("แป้นไม่ต้องตามไปได้ไหม ถ้าจะพิมพ์ให้จิ้มที่ใส่ข้อความ")
 *
 * นับเฉพาะการลากเกิน DRAG_PX — แตะเฉย ๆ (กดรูป/ลิงก์/ปุ่มในข้อความ) ไม่ปิดคีย์บอร์ด
 * ปิดเฉพาะตอนที่ช่องพิมพ์ (input/textarea/contenteditable) ถูกโฟกัสอยู่ ไม่ไปยุ่งอย่างอื่น
 */
const DRAG_PX = 12;

function editableFocused(): HTMLElement | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return null;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "checkbox")) return el;
  return null;
}

/**
 * ลากที่เริ่มในกล่องที่ติด `data-keep-keyboard` (รายชื่อ @แท็กคน ฯลฯ) ไม่ปิดคีย์บอร์ด — event นิ้วของ React
 * ไหลขึ้นตามต้นไม้คอมโพเนนต์ เลื่อนรายชื่อ @ ที่อยู่ในฟีด = ฟีด "ถูกลาก" ⇒ ช่องพิมพ์หลุดโฟกัส รายชื่อปิดหายกลางทาง
 * (20/10/2569 "เวลา@แล้วจะเลื่อนเลือกชื่อ ... กดเลื่อนหาไม่ครบแล้วหายไปเลย")
 */
export const KEEP_KEYBOARD_ATTR = "data-keep-keyboard";

export function useDismissKeyboardOnDrag() {
  const startY = useRef<number | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.(`[${KEEP_KEYBOARD_ATTR}]`)) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0]?.clientY ?? null;
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (startY.current === null) return;
      const y = e.touches[0]?.clientY;
      if (y === undefined || Math.abs(y - startY.current) < DRAG_PX) return;
      startY.current = null;
      editableFocused()?.blur();
    },
    onTouchEnd: () => {
      startY.current = null;
    },
  };
}
