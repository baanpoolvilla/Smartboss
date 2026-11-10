"use client";

import { useRef, useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * ปุ่ม (i) → ป๊อปอัปสั้น ๆ อธิบาย ครบทุกคน / คนใดคนหนึ่ง / ข้อช่วยกันทำ
 * ผู้ใช้ 10/11/2569: "กด i แล้วเป็น pop up" แล้วตามมาว่า "เยอะเกิน สรุปให้เข้าใจง่าย ๆ" — แบบละ 2 บรรทัด
 * ข้อความตรงกับกติกาจริง: task-completion.ts (ปิดงาน) · task-penalty-sweep.ts (หักคะแนน)
 */
type Rule = "all" | "any";

const RULES: { v: Rule; name: string; tagline: string; lines: string[] }[] = [
  { v: "all", name: "ครบทุกคน", tagline: "แบ่งงานกันทำ", lines: ["ทุกคนทำส่วนของตัวเองครบ งานถึงปิด", "ใครช้า คนนั้นโดนหัก"] },
  { v: "any", name: "คนใดคนหนึ่ง", tagline: "ใครทำก็ได้", lines: ["คนเดียวทำครบ งานปิดเลย", "ไม่มีใครทำทันกำหนด โดนหักทุกคน"] },
];

/** ปุ่มวงกลม (i) — เป้ากดพอดีนิ้ว (36px) แต่ไอคอนเล็ก ไม่เกะกะ */
function InfoTrigger({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="-m-2 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:text-[var(--brand-navy,#1b2537)] focus-visible:outline-2 focus-visible:outline-[var(--brand-navy,#1b2537)]"
    >
      <Info className="size-4" aria-hidden />
    </button>
  );
}

/** (i) ข้าง "ปิดงานเมื่อ" */
export function CompletionRuleInfo({ selected }: { selected: Rule }) {
  const [open, setOpen] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <InfoTrigger label="ครบทุกคน กับ คนใดคนหนึ่ง ต่างกันยังไง" onClick={() => setOpen(true)} testId="completion-rule-info" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 sm:max-w-lg" data-testid="completion-rule-guide" initialFocus={topRef}>
          <DialogHeader ref={topRef} tabIndex={-1} className="outline-none">
            <DialogTitle>ปิดงานเมื่อ — ต่างกันยังไง</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {RULES.map((r) => (
              <section
                key={r.v}
                className={cn(
                  "rounded-lg p-3",
                  selected === r.v ? "border-2 border-[var(--brand-navy,#1b2537)]" : "border border-[var(--line)]",
                )}
              >
                <h3 className="text-sm font-semibold">
                  {r.name} <span className="font-normal text-[var(--ink-soft)]">· {r.tagline}</span>
                </h3>
                {selected === r.v && <p className="text-[11px] text-[var(--ink-soft)]">เลือกอยู่</p>}
                <ul className="mt-1.5 space-y-1 text-sm">
                  {r.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-sm">
            <b>ช่วยกันทำ</b> (ตั้งที่เช็คลิสต์แต่ละข้อ) — ใครติ๊กก็ได้ ต้องเสร็จก่อน ทุกคนถึงจะครบ
          </p>
          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)} className="w-full sm:w-auto">
              เข้าใจแล้ว
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** (i) ข้างข้อ/ป้าย "ช่วยกันทำ" */
export function SharedItemInfo() {
  const [open, setOpen] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <InfoTrigger label="ช่วยกันทำ คืออะไร" onClick={() => setOpen(true)} testId="shared-item-info" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 sm:max-w-sm" data-testid="shared-item-guide" initialFocus={topRef}>
          <DialogHeader ref={topRef} tabIndex={-1} className="outline-none">
            <DialogTitle>ช่วยกันทำ คืออะไร</DialogTitle>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            <li>ใครในงานติ๊กข้อนี้ก็ได้</li>
            <li>ต้องเสร็จก่อน ทุกคนถึงจะครบ</li>
          </ul>
          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)} className="w-full sm:w-auto">
              เข้าใจแล้ว
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
