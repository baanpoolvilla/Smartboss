"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@smartboss/ui/cn";

/**
 * กล่องเลื่อนของรายการห้อง + ปุ่ม "NEW MENTIONS" แบบ Discord — ห้องที่มีคนแท็กเรา (แถวที่ติด
 * `data-mention-row`) แต่เลื่อนหลุดจอไปแล้ว ขึ้นป้ายแดงที่ขอบบน/ล่าง กดแล้วเลื่อนไปห้องนั้นพร้อมกะพริบ
 * ใช้ทั้งรายการห้องแชท (modules/chat) และรายการห้องรายงาน (topic-sidebar)
 */
export const NewMentionsScroll = forwardRef<HTMLDivElement, { className?: string; children: React.ReactNode }>(function NewMentionsScroll(
  { className, children },
  ref
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => scrollRef.current!, []);
  const [hidden, setHidden] = useState<{ above: boolean; below: boolean }>({ above: false, below: false });

  const measure = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    const c = box.getBoundingClientRect();
    let above = false;
    let below = false;
    for (const el of box.querySelectorAll<HTMLElement>("[data-mention-row]")) {
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      if (r.bottom <= c.top + 4) above = true;
      else if (r.top >= c.bottom - 4) below = true;
    }
    setHidden((prev) => (prev.above === above && prev.below === below ? prev : { above, below }));
  }, []);

  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    box.addEventListener("scroll", schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(box);
    // ห้องใหม่ถูกแท็ก / อ่านแล้ว / รายการเรียงใหม่ → วัดใหม่
    const mutation = new MutationObserver(schedule);
    mutation.observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-mention-row"] });
    return () => {
      cancelAnimationFrame(frame);
      box.removeEventListener("scroll", schedule);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [measure]);

  const jump = (dir: "above" | "below") => {
    const box = scrollRef.current;
    if (!box) return;
    const c = box.getBoundingClientRect();
    const rows = [...box.querySelectorAll<HTMLElement>("[data-mention-row]")].filter((el) => el.getBoundingClientRect().height > 0);
    // ห้องที่ใกล้ที่สุดในทิศนั้น
    const target =
      dir === "above"
        ? rows.filter((el) => el.getBoundingClientRect().bottom <= c.top + 4).pop()
        : rows.find((el) => el.getBoundingClientRect().top >= c.bottom - 4);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.animate?.([{ backgroundColor: "rgba(220, 38, 38, 0.16)" }, { backgroundColor: "transparent" }], { duration: 1400, easing: "ease-out" });
  };

  const pill =
    "absolute inset-x-3 z-20 flex h-7 items-center justify-center gap-1.5 rounded-full bg-[#dc2626] text-[11px] font-bold uppercase tracking-wider text-white shadow-md transition-transform hover:bg-[#b91c1c] active:scale-[0.98]";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {hidden.above && (
        <button type="button" onClick={() => jump("above")} className={cn(pill, "top-1.5")} aria-label="มีห้องที่แท็กคุณอยู่ด้านบน">
          <ArrowUp className="h-3.5 w-3.5" /> New mentions
        </button>
      )}
      <div ref={scrollRef} className={className}>
        {children}
      </div>
      {hidden.below && (
        <button type="button" onClick={() => jump("below")} className={cn(pill, "bottom-1.5")} aria-label="มีห้องที่แท็กคุณอยู่ด้านล่าง">
          <ArrowDown className="h-3.5 w-3.5" /> New mentions
        </button>
      )}
    </div>
  );
});
