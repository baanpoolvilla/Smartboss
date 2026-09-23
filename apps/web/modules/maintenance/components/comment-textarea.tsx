"use client";

import { useRef, type KeyboardEvent } from "react";

/**
 * ช่องพิมพ์คอมเมนต์ — Enter = ส่ง, Shift+Enter = ขึ้นบรรทัดใหม่
 *
 * ของเดิมเป็น <input> บรรทัดเดียว ⇒ ขึ้นบรรทัดใหม่ไม่ได้เลย คนเลยต้องส่งทีละ
 * ประโยคหรือปล่อยให้ข้อความยาวเป็นพรืด (ตัวหน้าจอแสดงผลรองรับ \n อยู่แล้ว —
 * whitespace-pre-wrap)
 *
 * ⚠ บนมือถือ Enter = ขึ้นบรรทัดใหม่เสมอ ไม่ส่ง — คีย์บอร์ดจอสัมผัสมีปุ่ม
 * Enter แต่ไม่มี Shift ให้กดค้างสะดวก ๆ ถ้าให้ Enter ส่ง คนพิมพ์บนมือถือจะ
 * ขึ้นบรรทัดใหม่ไม่ได้อีกเลย (กลับไปเป็นปัญหาเดิม) ⇒ ใช้ปุ่มส่งข้าง ๆ แทน
 */
export function CommentTextarea({
  name = "content",
  defaultValue = "",
  placeholder,
  autoFocus = false,
  ariaLabel,
}: {
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  /** สูงตามจำนวนบรรทัดจริง แต่ไม่เกิน max-h (CSS) แล้วค่อยเลื่อนเอา */
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    // IME (ภาษาไทย/ญี่ปุ่น) กำลังเลือกคำอยู่ — Enter ตอนนั้นคือ "ยืนยันคำ"
    // ไม่ใช่ "ส่ง" ถ้าดักส่งตรงนี้ข้อความจะถูกส่งกลางคันตอนเลือกคำ
    if (e.nativeEvent.isComposing) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches
    ) {
      return;
    }
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }

  return (
    <textarea
      ref={ref}
      name={name}
      rows={1}
      defaultValue={defaultValue}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      maxLength={1000}
      onKeyDown={onKeyDown}
      onInput={(e) => autoGrow(e.currentTarget)}
      className="max-h-40 min-h-10 w-full flex-1 resize-none overflow-y-auto rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30"
    />
  );
}
