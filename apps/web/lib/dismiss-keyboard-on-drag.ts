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

export function useDismissKeyboardOnDrag() {
  const startY = useRef<number | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
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
