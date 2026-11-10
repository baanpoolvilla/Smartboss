"use client";

import { useRef, useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * ปุ่ม (i) → ป๊อปอัปสั้น ๆ อธิบาย ครบทุกคน / คนใดคนหนึ่ง / ข้อช่วยกันทำ
 * ผู้ใช้ 10/11/2569: "กด i แล้วเป็น pop up" แล้วตามมาว่า "เยอะเกิน สรุปให้เข้าใจง่าย ๆ" แล้ว "ละเอียดหน่อย" — แบบละ 4 หัวข้อสั้น (ทำ / ปิดงาน / หักคะแนน / เช่น)
 * ข้อความตรงกับกติกาจริง: task-completion.ts (ปิดงาน) · task-penalty-sweep.ts (หักคะแนน)
 */
type Rule = "all" | "any";

const RULES: { v: Rule; name: string; tagline: string; lines: [string, string][] }[] = [
  {
    v: "all",
    name: "ครบทุกคน",
    tagline: "แบ่งงานกันทำ",
    lines: [
      ["ทำ", "ทุกคนทำข้อที่มีชื่อตัวเองให้ครบ"],
      ["ปิดงาน", "เมื่อครบทุกคน — คนเดียวปิดไม่ได้"],
      ["หักคะแนน", "เลยกำหนด หักเฉพาะคนที่ยังไม่เสร็จ"],
      ["เช่น", "แบ่งกันทำคนละห้อง คนละบ้าน"],
    ],
  },
  {
    v: "any",
    name: "คนใดคนหนึ่ง",
    tagline: "ใครทำก็ได้",
    lines: [
      ["ทำ", "ใครว่างคนนั้นทำ ไม่ต้องทำซ้ำกัน"],
      ["ปิดงาน", "คนแรกทำครบ งานปิดเลย"],
      ["หักคะแนน", "มีคนเสร็จทันกำหนด ไม่มีใครโดน · ไม่มีใครเสร็จเลย หักทุกคน"],
      ["เช่น", "ไปรับของ โทรหาลูกค้า"],
    ],
  },
];

/** ข้อ "ช่วยกันทำ" — ใช้ทั้งในป๊อปอัปปิดงานเมื่อ และป๊อปอัปของข้อนั้นเอง */
function SharedLines() {
  return (
    <dl className="mt-1 space-y-1">
      {[
        ["ทำ", "ใครในงานติ๊กข้อนี้ก็ได้ (ข้อที่มีชื่อคนอื่น ติ๊กแทนไม่ได้)"],
        ["ปิดงาน", "ต้องเสร็จก่อน ทุกคนถึงจะครบส่วนของตัวเอง"],
        ["หักคะแนน", "ทุกข้อเป็นช่วยกันทำ แล้วเลยกำหนด หักทุกคน"],
        ["เช่น", "เตรียมอุปกรณ์ เก็บขยะ ล็อกบ้าน"],
      ].map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="w-16 shrink-0 text-xs leading-5 font-medium text-[var(--ink-soft)]">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

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
        <DialogContent className="gap-3 sm:max-w-2xl" data-testid="completion-rule-guide" initialFocus={topRef}>
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
                <dl className="mt-1.5 space-y-1 text-sm">
                  {r.lines.map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="w-16 shrink-0 text-xs leading-5 font-medium text-[var(--ink-soft)]">{k}</dt>
                      <dd className="min-w-0">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <section className="rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-sm">
            <h3 className="font-semibold">
              ช่วยกันทำ <span className="font-normal text-[var(--ink-soft)]">· ตั้งที่เช็คลิสต์แต่ละข้อ</span>
            </h3>
            <SharedLines />
          </section>
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
          <div className="text-sm">
            <SharedLines />
          </div>
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
