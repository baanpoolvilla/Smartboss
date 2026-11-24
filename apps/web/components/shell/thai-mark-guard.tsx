"use client";

import { useEffect } from "react";
import { tidyThaiMarks } from "@/modules/shared-text/tidy-thai";

/**
 * กันสระ/วรรณยุกต์ซ้อนผิดปกติ "ตั้งแต่ตอนพิมพ์" ทุกช่องพิมพ์ในแอป (ผู้ใช้ 24/11/2569 "มันก็ไม่ควรกดได้แต่แรก")
 * — กดไม้โทค้างได้ตัวเดียว · วรรณยุกต์ลอย ๆ (ไม่มีตัวอักษรนำหน้า) ไม่ขึ้น · ข้อความปกติไม่กระทบ
 *
 * ตัวเดียววางที่ Shell ฟัง event "input" ระดับ document (capture — ทำงานก่อน React อ่านค่า onChange จึงได้ค่าที่จัดแล้ว)
 *  - textarea / input ข้อความ: จัดทั้งช่อง คงตำแหน่งเคอร์เซอร์
 *  - ช่องเขียนแบบจัดรูปแบบ (contentEditable): จัดเฉพาะก้อนข้อความที่เคอร์เซอร์อยู่ แบบ midText (ไม่ตัดต้นก้อน)
 * ระหว่างผสมคำ (IME) ไม่แตะ · ชั้นสำรอง: ตัดอีกรอบตอนบันทึก + ตอนแสดง (tidyThaiMarks ที่จุดเหล่านั้น)
 */
const TEXT_INPUT_TYPES = new Set(["text", "search", ""]);

function fixField(el: HTMLTextAreaElement | HTMLInputElement) {
  const v = el.value;
  const t = tidyThaiMarks(v);
  if (t === v) return;
  const caret = el.selectionStart ?? v.length;
  const newCaret = tidyThaiMarks(v.slice(0, caret)).length;
  // ตั้งค่าผ่าน setter ดั้งเดิม — React เห็นค่าใหม่ใน onChange ของ event นี้เลย (value tracker ยังจำค่าเก่า)
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, t);
  try {
    el.setSelectionRange(newCaret, newCaret);
  } catch {
    /* บางชนิด input ตั้งเคอร์เซอร์ไม่ได้ */
  }
}

function fixEditable() {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  if (!sel || !node || node.nodeType !== Node.TEXT_NODE) return;
  const text = node as Text;
  const v = text.data;
  // ก้อนแรกของบรรทัด (ไม่มีข้อความก่อนหน้าในกล่องเดียวกัน) = ต้นข้อความจริง ตัดเครื่องหมายลอยได้
  const atLineStart = !text.previousSibling;
  const t = tidyThaiMarks(v, { midText: !atLineStart });
  if (t === v) return;
  const caret = sel.anchorOffset;
  const newCaret = tidyThaiMarks(v.slice(0, caret), { midText: !atLineStart }).length;
  text.data = t;
  const range = document.createRange();
  range.setStart(text, Math.min(newCaret, t.length));
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function ThaiMarkGuard() {
  useEffect(() => {
    const onInput = (e: Event) => {
      if ((e as InputEvent).isComposing) return;
      const el = e.target;
      if (el instanceof HTMLTextAreaElement) fixField(el);
      else if (el instanceof HTMLInputElement) {
        if (TEXT_INPUT_TYPES.has(el.type)) fixField(el);
      } else if (el instanceof HTMLElement && el.isContentEditable) fixEditable();
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, []);
  return null;
}
