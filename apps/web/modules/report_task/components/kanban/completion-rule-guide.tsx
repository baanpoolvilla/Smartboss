"use client";

import { useRef, useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * ปุ่ม (i) → ป๊อปอัปอธิบาย ครบทุกคน / คนใดคนหนึ่ง / ข้อช่วยกันทำ — คนสร้างงานกลุ่มมักงงว่าใครต้องทำอะไร
 * ปิดคนเดียวได้ไหม โดนหักยังไง (ผู้ใช้ 10/11/2569 "กด i แล้วเป็น pop up อธิบาย คำนึงถึงมือถือ โน้ตบุ๊ก")
 * มือถือ: การ์ดทีละแบบซ้อนลงมา · จอกว้าง: ตารางเทียบ · ข้อความตรงกับกติกาจริง:
 * task-completion.ts (ปิดงาน) · task-penalty-sweep.ts (หักคะแนน) · rejectGroupReview (ตรวจไม่ผ่าน)
 */
type Rule = "all" | "any";

const ROWS: { q: string; all: string; any: string }[] = [
  {
    q: "ใครต้องทำอะไร",
    all: "ทุกคนทำส่วนของตัวเอง (ข้อในเช็คลิสต์ที่มีชื่อตัวเอง) — คนที่ไม่มีข้อของตัวเอง กดว่าส่วนของตัวเองเสร็จ",
    any: "ทุกคนได้งานเดียวกัน ใครว่างคนนั้นทำ ไม่ต้องทำซ้ำกัน",
  },
  { q: "งานปิดเมื่อไหร่", all: "เมื่อทุกคนทำส่วนของตัวเองครบ", any: "ทันทีที่มีคนแรกทำส่วนของตัวเองครบ" },
  { q: "ปิดงานคนเดียวได้ไหม", all: "ไม่ได้ — ทำครบแค่ส่วนของตัวเอง ต้องรอคนอื่น", any: "ได้ — คนเดียวทำครบ งานปิดเลย" },
  {
    q: "เลยกำหนดส่ง โดนหักยังไง",
    all: "หักเฉพาะคนที่ยังไม่เสร็จ (ดูวันส่งของแต่ละคน) — คนที่เสร็จแล้วไม่โดน",
    any: "มีคนเสร็จทันกำหนด = ไม่มีใครโดน · เลยกำหนดแล้วยังไม่มีใครเสร็จ = หักทุกคน",
  },
  { q: "ตรวจแล้วไม่ผ่าน", all: "ส่งกลับเฉพาะคนที่เลือก — คนที่ผ่านแล้วไม่ต้องทำใหม่", any: "ทุกคนกลับไปทำใหม่ (งานชิ้นเดียวกัน)" },
  { q: "เหมาะกับ", all: "แบ่งงานกันทำคนละส่วน เช่น คนละห้อง คนละบ้าน", any: "งานชิ้นเดียว ใครก็ทำแทนกันได้ เช่น ไปรับของ โทรหาลูกค้า" },
];

const RULE_NAME: Record<Rule, string> = { all: "ครบทุกคน", any: "คนใดคนหนึ่ง" };

function SharedItemsExplain() {
  return (
    <ul className="list-disc space-y-1 pl-5">
      <li>ใครในงานติ๊กข้อนี้ก็ได้ — ข้อที่มีชื่อคนอื่น ยังติ๊กแทนไม่ได้</li>
      <li>ต้องเสร็จก่อน ทุกคนถึงจะนับว่าครบส่วนของตัวเอง</li>
      <li>ทุกข้อเป็นช่วยกันทำ = ครบทุกข้อแล้วงานปิด · เลยกำหนดแล้วยังไม่ครบ หักทุกคน</li>
      <li className="text-[var(--ink-soft)]">เหมาะกับข้อที่ใครทำก็ได้ เช่น เตรียมอุปกรณ์ เก็บขยะ ล็อกบ้าน</li>
    </ul>
  );
}

/** ปุ่มวงกลม (i) — เป้ากดใหญ่พอสำหรับนิ้ว (36px) แต่ไอคอนเล็ก ไม่เกะกะ */
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

/** (i) ข้าง "ปิดงานเมื่อ" — ป๊อปอัปเทียบ ครบทุกคน / คนใดคนหนึ่ง + ข้อช่วยกันทำ */
export function CompletionRuleInfo({ selected }: { selected: Rule }) {
  const [open, setOpen] = useState(false);
  // เปิดมาให้อยู่บนสุด — ปล่อยตามค่าเดิม โฟกัสจะไปปุ่ม "เข้าใจแล้ว" ท้ายกล่อง แล้วกล่องเลื่อนลงล่างเอง
  const topRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <InfoTrigger label="ครบทุกคน กับ คนใดคนหนึ่ง ต่างกันยังไง" onClick={() => setOpen(true)} testId="completion-rule-info" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 sm:max-w-2xl" data-testid="completion-rule-guide" initialFocus={topRef}>
          <DialogHeader ref={topRef} tabIndex={-1} className="outline-none">
            <DialogTitle>ปิดงานเมื่อ — ต่างกันยังไง</DialogTitle>
            <DialogDescription>งานกลุ่มเลือกได้ 2 แบบ · ตอนนี้เลือก &quot;{RULE_NAME[selected]}&quot;</DialogDescription>
          </DialogHeader>

          {/* มือถือ: ทีละแบบ แบบที่เลือกอยู่ขึ้นก่อน */}
          <div className="space-y-3 text-sm leading-relaxed sm:hidden">
            {(selected === "all" ? (["all", "any"] as const) : (["any", "all"] as const)).map((r) => (
              <section key={r} className={cn("rounded-lg border p-3", selected === r ? "border-2 border-[var(--brand-navy,#1b2537)]" : "border-[var(--line)]")}>
                <h3 className="font-semibold">
                  {RULE_NAME[r]}
                  {selected === r ? <span className="ml-1.5 text-xs font-normal text-[var(--ink-soft)]">(เลือกอยู่)</span> : null}
                </h3>
                <dl className="mt-1.5 space-y-1.5">
                  {ROWS.map((row) => (
                    <div key={row.q}>
                      <dt className="text-xs font-medium text-[var(--ink-soft)]">{row.q}</dt>
                      <dd>{r === "all" ? row.all : row.any}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>

          {/* โน้ตบุ๊ก/จอกว้าง: ตารางเทียบ */}
          <table className="hidden w-full border-collapse text-sm leading-relaxed sm:table">
            <thead>
              <tr>
                <th className="w-[22%] border-b border-[var(--line)] p-2" />
                {(["all", "any"] as const).map((r) => (
                  <th
                    key={r}
                    className={cn("border-b border-[var(--line)] p-2 text-left font-semibold", selected === r ? "bg-[var(--bg-soft)]" : "text-[var(--ink-soft)]")}
                  >
                    {RULE_NAME[r]}
                    {selected === r ? <span className="ml-1.5 text-xs font-normal text-[var(--ink-soft)]">(เลือกอยู่)</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.q}>
                  <th scope="row" className="border-b border-[var(--line)] p-2 text-left align-top text-xs font-medium text-[var(--ink-soft)]">
                    {row.q}
                  </th>
                  <td className={cn("border-b border-[var(--line)] p-2 align-top", selected === "all" && "bg-[var(--bg-soft)]")}>{row.all}</td>
                  <td className={cn("border-b border-[var(--line)] p-2 align-top", selected === "any" && "bg-[var(--bg-soft)]")}>{row.any}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="rounded-lg bg-[var(--bg-soft)] p-3 text-sm leading-relaxed">
            <h3 className="mb-1 font-semibold">ข้อ &quot;ช่วยกันทำ&quot; ในเช็คลิสต์ (ใช้ได้กับทั้งสองแบบ)</h3>
            <SharedItemsExplain />
            <p className="mt-1 text-xs text-[var(--ink-soft)]">ตั้งที่ ตัวเลือกขั้นสูง → มีเช็คลิสต์ → เลือก &quot;ช่วยกันทำ&quot; ที่แต่ละข้อ</p>
          </section>
          <p className="text-xs text-[var(--ink-soft)]">คะแนนที่หักเป็นไปตามตั้งค่าคะแนน (ปกติ −3) · ขอเลื่อนกำหนดส่งได้รายคน · งานส่วนตัวไม่นับคะแนน</p>
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

/** (i) ข้างข้อ/ป้าย "ช่วยกันทำ" — ป๊อปอัปสั้น ๆ */
export function SharedItemInfo() {
  const [open, setOpen] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <InfoTrigger label="ช่วยกันทำ คืออะไร" onClick={() => setOpen(true)} testId="shared-item-info" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 sm:max-w-md" data-testid="shared-item-guide" initialFocus={topRef}>
          <DialogHeader ref={topRef} tabIndex={-1} className="outline-none">
            <DialogTitle>ข้อ &quot;ช่วยกันทำ&quot; คืออะไร</DialogTitle>
          </DialogHeader>
          <div className="text-sm leading-relaxed">
            <SharedItemsExplain />
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
