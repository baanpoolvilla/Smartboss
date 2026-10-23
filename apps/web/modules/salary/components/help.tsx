"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { CircleHelp, Info, X } from "lucide-react";

/*
 * ระบบสอนในโมดูลเงินเดือน (ผู้ใช้ขอ 23/10/2569: "อันไหนที่คนส่วนใหญ่ไม่รู้ ให้มีรายละเอียด แบบสอน")
 *   InfoTip  — ปุ่ม ⓘ ข้างคำยาก กดแล้วขึ้นคำอธิบายสั้น + ตัวเลขจริงของรอบ/คนนั้น (กด ไม่ใช่ชี้ — มือถือชี้ไม่ได้)
 *   Explain  — ลิงก์ "คิดยังไง?" ใต้บรรทัด กดแล้วกางคำอธิบายในที่ (สลิป / drawer)
 *   PageTour — พาชี้ทีละขั้นครั้งแรกที่เปิดหน้า · ข้ามได้ · ดูซ้ำจากปุ่ม "วิธีใช้หน้านี้"
 */

/**
 * ปุ่ม ⓘ + กล่องคำอธิบาย · ปิดด้วยคลิกข้างนอก / Esc
 * วางแบบ fixed ตามตำแหน่งปุ่ม (ไม่โดนตัดในตารางที่เลื่อนข้างได้) · มือถือขึ้นเป็นแผ่นด้านล่างจอ
 */
export function InfoTip({ label, title, children, align = "left" }: { label: string; title?: string; children: React.ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r || window.innerWidth < 640) return setAt(null);
      const w = 352;
      const left = Math.min(Math.max(12, align === "right" ? r.right - w : r.left), window.innerWidth - w - 12);
      setAt({ top: Math.min(r.bottom + 6, window.innerHeight - 120), left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={box} className="relative inline-flex align-middle">
      <button
        ref={btn}
        type="button"
        aria-label={`อธิบาย: ${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-(--brand-navy,#1b2537) hover:bg-(--bg-soft) ${open ? "bg-(--bg-soft)" : ""}`}
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="dialog"
          aria-label={title ?? label}
          style={at ? { top: at.top, left: at.left, width: 352 } : undefined}
          className={`fixed z-[60] block overflow-y-auto rounded-(--radius-lg) border-2 border-(--brand-navy,#1b2537) bg-(--bg) p-4 text-left text-sm font-normal leading-relaxed whitespace-normal text-(--ink) shadow-xl ${at ? "max-h-[min(28rem,calc(100vh-8rem))]" : "inset-x-3 bottom-[84px] max-h-[60vh]"}`}
        >
          <span className="mb-1.5 flex items-start justify-between gap-3">
            <span className="block font-bold">{title ?? label}</span>
            <button type="button" aria-label="ปิด" onClick={() => setOpen(false)} className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-(--bg-soft)">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
          <span className="flex flex-col gap-2">{children}</span>
        </span>
      )}
    </span>
  );
}

/** กล่องตัวเลขตัวอย่างในคำอธิบาย */
export function Example({ children }: { children: React.ReactNode }) {
  return <span className="block rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-[13px] tabular-nums">{children}</span>;
}

/** ลิงก์ "คิดยังไง?" ใต้บรรทัด — กดแล้วกางคำอธิบายในที่ */
export function Explain({ q, children, defaultOpen = false }: { q: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="print:hidden">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="mt-1 min-h-7 text-xs font-semibold text-(--brand-navy,#1b2537) underline">
        {open ? "ซ่อน" : q}
      </button>
      {open && (
        <div id={id} className="mt-1.5 flex flex-col gap-1.5 rounded-(--radius) bg-(--bg-soft) px-3 py-2.5 text-[13px] leading-relaxed text-(--ink)">
          {children}
        </div>
      )}
    </div>
  );
}

export interface TourStep {
  /** ค่า data-tour ของจุดที่ชี้ — ไม่มีบนหน้า = ข้ามขั้นนั้น */
  target: string;
  title: string;
  body: string;
}

const seenKey = (id: string) => `salary-tour-seen:${id}`;

/**
 * พาชี้ทีละขั้น: ขึ้นเองครั้งแรก (จำในเครื่อง) · ปุ่ม "วิธีใช้หน้านี้" เปิดซ้ำได้
 * ไฮไลต์ด้วยเงาทึบรอบจุดที่ชี้ ไม่ต้องย้าย DOM · การ์ดวางใต้/เหนือจุด และไม่ล้นจอ
 */
export function PageTour({ id, steps, auto = true }: { id: string; steps: TourStep[]; auto?: boolean }) {
  const [active, setActive] = useState<TourStep[] | null>(null);
  const [i, setI] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const lit = useRef<HTMLElement | null>(null);

  const start = useCallback(() => {
    const present = steps.filter((s) => document.querySelector(`[data-tour="${s.target}"]`));
    if (present.length === 0) return;
    setI(0);
    setActive(present);
  }, [steps]);

  const finish = useCallback(() => {
    setActive(null);
    try {
      localStorage.setItem(seenKey(id), "1");
    } catch {
      /* โหมดส่วนตัว — ขึ้นอีกครั้งก็ไม่เป็นไร */
    }
  }, [id]);

  useEffect(() => {
    if (!auto) return;
    let seen = false;
    try {
      seen = localStorage.getItem(seenKey(id)) === "1";
    } catch {
      seen = true;
    }
    if (!seen) {
      const t = window.setTimeout(start, 600);
      return () => window.clearTimeout(t);
    }
  }, [auto, id, start]);

  useLayoutEffect(() => {
    lit.current?.classList.remove("salary-tour-lit");
    lit.current = null;
    if (!active) return;
    const step = active[i];
    const el = step ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    if (!el) return;
    el.classList.add("salary-tour-lit");
    lit.current = el;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const place = () => {
      const r = el.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 24);
      const below = r.bottom + 12 + 220 < window.innerHeight;
      const top = below ? r.bottom + 12 : Math.max(12, r.top - 12 - 220);
      const left = Math.min(Math.max(12, r.left), window.innerWidth - width - 12);
      setPos({ top, left, width });
    };
    place();
    const t = window.setTimeout(place, 400);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [active, i]);

  useEffect(() => () => lit.current?.classList.remove("salary-tour-lit"), []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, finish]);

  const step = active?.[i];
  return (
    <>
      {/* ฉากมืดเต็มจอแยกเป็นชั้นของตัวเอง (เงา 9999px บนตัวที่ชี้ถูกตัดในตารางที่เลื่อนข้างได้) · จุดที่ชี้ลอยขึ้นเหนือฉาก */}
      <style>{`.salary-tour-lit{position:relative;z-index:45;border-radius:10px;box-shadow:0 0 0 4px #f59e0b!important;background:var(--bg)}`}</style>
      {active && step && <div aria-hidden="true" data-tour-backdrop className="fixed inset-0 z-[44]" style={{ background: "rgba(15,23,42,.55)" }} onClick={finish} />}
      <button type="button" onClick={start} className="inline-flex h-11 items-center gap-2 rounded-(--radius) border border-(--line) bg-(--bg) px-4 text-sm font-medium text-(--ink) hover:bg-(--bg-soft)">
        <CircleHelp className="h-4 w-4" aria-hidden="true" /> วิธีใช้หน้านี้
      </button>
      {active && step && pos && (
        <div role="dialog" aria-modal="false" aria-label={`วิธีใช้ ขั้นที่ ${i + 1}`} className="fixed z-[60] rounded-(--radius-lg) bg-(--bg) p-4 shadow-2xl" style={{ top: pos.top, left: pos.left, width: pos.width }}>
          <div className="text-xs font-semibold text-amber-800">วิธีใช้ · ขั้นที่ {i + 1} จาก {active.length}</div>
          <div className="mt-1 text-base font-bold text-(--ink)">{step.title}</div>
          <p className="mt-1 text-sm leading-relaxed text-(--ink)">{step.body}</p>
          <div className="mt-3 flex items-center justify-between">
            <button type="button" onClick={finish} className="h-10 px-1 text-sm font-medium text-(--ink-soft) hover:text-(--ink)">ข้าม</button>
            <div className="flex gap-2">
              {i > 0 && <button type="button" onClick={() => setI(i - 1)} className="h-10 rounded-(--radius) border border-(--line) px-4 text-sm font-semibold">ย้อน</button>}
              <button type="button" onClick={() => (i + 1 < active.length ? setI(i + 1) : finish())} className="h-10 rounded-(--radius) bg-(--brand-navy,#1b2537) px-4 text-sm font-semibold text-white">
                {i + 1 < active.length ? "ถัดไป" : "เข้าใจแล้ว"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
