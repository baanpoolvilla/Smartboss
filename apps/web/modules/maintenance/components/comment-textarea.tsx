"use client";

import { useRef, useState, type KeyboardEvent } from "react";

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
 *
 * `mentionPeople` (ไม่บังคับ): พิมพ์ @ แล้วเลือกคนได้ — ใส่ "@ชื่อ" ลงข้อความ เซิร์ฟเวอร์อ่านชื่อนี้แล้วแจ้งคนนั้น
 * (ใบงานซ่อม: คนในใบงาน + CEO — data/wo-mentions.ts)
 */
export function CommentTextarea({
  name = "content",
  defaultValue = "",
  placeholder,
  autoFocus = false,
  ariaLabel,
  mentionPeople,
}: {
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
  mentionPeople?: { id: string; name: string }[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const matches =
    mention && mentionPeople
      ? mentionPeople.filter((p) => p.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 8)
      : [];

  /** สูงตามจำนวนบรรทัดจริง แต่ไม่เกิน max-h (CSS) แล้วค่อยเลื่อนเอา */
  function autoGrow(el: HTMLTextAreaElement) {
    // คืนตำแหน่งเลื่อนเดิมหลังวัดความสูง — ไม่งั้นข้อความยาวเกินช่องจะเด้งกลับบนสุดทุกตัวอักษรที่พิมพ์
    const top = el.scrollTop;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.scrollTop = top;
  }

  function detectMention(el: HTMLTextAreaElement) {
    if (!mentionPeople?.length) return;
    const caret = el.selectionStart ?? el.value.length;
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(el.value.slice(0, caret));
    setMention(m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null);
    setActive(0);
  }

  function pick(p: { name: string }) {
    const el = ref.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? el.value.length;
    const insert = `@${p.name} `;
    el.value = el.value.slice(0, mention.start) + insert + el.value.slice(caret);
    const pos = mention.start + insert.length;
    el.setSelectionRange(pos, pos);
    el.focus();
    autoGrow(el);
    setMention(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[active] ?? matches[0]!);
        return;
      }
      if (e.key === "Escape") {
        setMention(null);
        return;
      }
    }
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
    <div className="relative">
      {matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="แท็กคน"
          className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-64 overflow-y-auto rounded-(--radius) border border-(--line) bg-(--bg) py-1 shadow-lg"
        >
          {matches.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                className={`block w-full truncate px-3 py-1.5 text-left text-sm ${i === active ? "bg-(--bg-soft) font-medium" : ""}`}
              >
                @{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
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
        onInput={(e) => {
          autoGrow(e.currentTarget);
          detectMention(e.currentTarget);
        }}
        onBlur={() => setMention(null)}
        className="max-h-40 min-h-10 w-full flex-1 resize-none overflow-y-auto rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30"
      />
    </div>
  );
}
