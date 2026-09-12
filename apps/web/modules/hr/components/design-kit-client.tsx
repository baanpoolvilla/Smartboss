"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";

/*
 * ส่วนนี้แยกไฟล์จาก design-kit.tsx เพราะทุกคอมโพเนนต์ในนี้ผูก onClick ของ
 * ตัวเอง — Next.js บังคับให้ component ที่แนบ event handler ต้องอยู่ใน
 * client boundary (ไม่ใช่แค่ตอนถูกเรียกใช้) ส่วน PageHeader/PersonRow ใน
 * design-kit.tsx เป็นแค่ markup ล้วน อยู่เป็น server component ได้ ไม่ควร
 * ลากเข้ามาเป็น client ไปด้วยกันโดยไม่จำเป็น (จะเพิ่ม client JS เปล่าๆ)
 */

/**
 * ปุ่ม (?) เปิด popover อธิบายกฎยาวๆ — ที่ที่ควรย้ายย่อหน้าอธิบายยาว
 * ที่กระจายอยู่ทั่วทั้งโมดูลมาไว้ (สเปคข้อ 5.2)
 */
export function HelpPopover({
  children,
  label = "คำอธิบายเพิ่มเติม",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        className="flex h-5 w-5 items-center justify-center rounded-full text-(--ink-soft) transition-colors hover:bg-(--bg-soft) hover:text-(--ink)"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 w-72 rounded-(--radius) border border-(--line) bg-(--bg) p-3 text-xs leading-relaxed text-(--ink-soft) shadow-(--shadow-pop)"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export interface FilterChipOption {
  key: string;
  label: string;
  count?: number;
  /** สี CSS variable ตามธรรมเนียมเดียวกับ Pill/StatusBadge — ไม่ใช่ hex ตรงๆ */
  tone?: string;
}

/**
 * แถวชิปกรองที่กดติด/ปลดได้ — ตัวแทน checkbox เล็กๆ ในการ์ดสถิติที่ไม่มี
 * คำอธิบายว่ากดแล้วเกิดอะไร (สเปคข้อ 4.1)
 */
export function FilterChips({
  options,
  active,
  onToggle,
}: {
  options: FilterChipOption[];
  active: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group">
      {options.map((opt) => {
        const on = active.has(opt.key);
        const tone = opt.tone ?? "var(--tone-muted)";
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(opt.key)}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              borderColor: on ? tone : "var(--line)",
              backgroundColor: on
                ? `color-mix(in srgb, ${tone} 12%, transparent)`
                : "var(--bg)",
              color: on ? tone : "var(--ink-soft)",
            }}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className="tabular-nums opacity-80">{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface WizardStep {
  key: string;
  label: string;
  content: React.ReactNode;
}

/**
 * โครงวิซาร์ดทั่วไป — ไม่มี logic เฉพาะของ HR ผูกอยู่เลย
 * ผู้เรียกเป็นคนคุม currentIndex/เนื้อหาแต่ละขั้นเอง component นี้แค่วาด
 * แถบขั้นตอน + ปุ่มย้อนกลับ/ถัดไป
 */
export function StepWizard({
  steps,
  currentIndex,
  onBack,
  onNext,
  nextLabel = "ถัดไป",
  nextDisabled = false,
  backLabel = "ย้อนกลับ",
}: {
  steps: WizardStep[];
  currentIndex: number;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  backLabel?: string;
}) {
  const step = steps[currentIndex];
  if (!step) return null;

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap items-center gap-2 text-xs font-medium text-(--ink-soft)">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full tabular-nums"
              style={{
                backgroundColor:
                  i <= currentIndex ? "var(--tone-info)" : "var(--bg-soft)",
                color: i <= currentIndex ? "white" : "var(--ink-soft)",
              }}
            >
              {i + 1}
            </span>
            <span
              style={
                i === currentIndex
                  ? { color: "var(--ink)", fontWeight: 600 }
                  : undefined
              }
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span className="mx-1 text-(--line)" aria-hidden>
                ─
              </span>
            )}
          </li>
        ))}
      </ol>

      <div>{step.content}</div>

      <div className="flex items-center justify-between gap-2 border-t border-(--line) pt-3">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={!onBack || currentIndex === 0}
        >
          {backLabel}
        </Button>
        <Button type="button" onClick={onNext} disabled={nextDisabled || !onNext}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
