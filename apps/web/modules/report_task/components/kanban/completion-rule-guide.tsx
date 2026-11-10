"use client";

import { useState } from "react";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * "ต่างกันยังไง?" ใต้ปุ่มปิดงานเมื่อ — คนสร้างงานกลุ่มมักงงว่า ครบทุกคน / คนใดคนหนึ่ง / ช่วยกันทำ
 * ต่างกันยังไง ใครต้องทำอะไร ปิดคนเดียวได้ไหม โดนหักยังไง (ผู้ใช้ 10/11/2569)
 * ข้อความตรงกับกติกาจริง: task-completion.ts (ปิดงาน) · task-penalty-sweep.ts (หักคะแนน) · rejectGroupReview (ตรวจไม่ผ่าน)
 */
type Rule = "all" | "any";

const ROWS: { q: string; all: string; any: string }[] = [
  {
    q: "ใครต้องทำอะไร",
    all: "ทุกคนทำส่วนของตัวเอง (ข้อในเช็คลิสต์ที่มีชื่อตัวเอง) — คนที่ไม่มีข้อของตัวเอง กดว่าส่วนของตัวเองเสร็จ",
    any: "ทุกคนได้งานเดียวกัน ใครว่างคนนั้นทำ ไม่ต้องทำซ้ำกัน",
  },
  {
    q: "งานปิดเมื่อไหร่",
    all: "เมื่อทุกคนทำส่วนของตัวเองครบ",
    any: "ทันทีที่มีคนแรกทำส่วนของตัวเองครบ",
  },
  {
    q: "ปิดงานคนเดียวได้ไหม",
    all: "ไม่ได้ — ทำครบแค่ส่วนของตัวเอง ต้องรอคนอื่น",
    any: "ได้ — คนเดียวทำครบ งานปิดเลย",
  },
  {
    q: "เลยกำหนดส่ง โดนหักยังไง",
    all: "หักเฉพาะคนที่ยังไม่เสร็จ (ดูวันส่งของแต่ละคน) — คนที่เสร็จแล้วไม่โดน",
    any: "มีคนเสร็จทันกำหนด = ไม่มีใครโดน · เลยกำหนดแล้วยังไม่มีใครเสร็จ = หักทุกคน",
  },
  {
    q: "ตรวจแล้วไม่ผ่าน",
    all: "ส่งกลับเฉพาะคนที่เลือก — คนที่ผ่านแล้วไม่ต้องทำใหม่",
    any: "ทุกคนกลับไปทำใหม่ (งานชิ้นเดียวกัน)",
  },
  {
    q: "เหมาะกับ",
    all: "แบ่งงานกันทำคนละส่วน เช่น คนละห้อง คนละบ้าน",
    any: "งานชิ้นเดียว ใครก็ทำแทนกันได้ เช่น ไปรับของ โทรหาลูกค้า",
  },
];

export function CompletionRuleGuide({ selected, hasChecklist }: { selected: Rule; hasChecklist: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-[11px] font-medium text-[var(--brand-navy,#1b2537)] underline-offset-2 hover:underline"
        data-testid="completion-rule-guide-toggle"
      >
        {open ? "ซ่อนคำอธิบาย" : "ต่างกันยังไง? ใครต้องทำอะไร โดนหักยังไง"}
      </button>
      {open && (
        <div className="space-y-2 rounded-lg border border-[var(--line)] bg-white p-2.5 text-[11px] leading-snug" data-testid="completion-rule-guide">
          {/* มือถือ: ทีละแบบ ซ้อนลงมา (ตารางกว้างเกินจอ) */}
          <div className="space-y-2 sm:hidden">
            {(["all", "any"] as const).map((r) => (
              <div key={r} className={cn("rounded-md border p-2", selected === r ? "border-[var(--brand-navy,#1b2537)]" : "border-[var(--line)]")}>
                <p className="font-semibold text-[var(--ink)]">
                  {r === "all" ? "ครบทุกคน" : "คนใดคนหนึ่ง"}
                  {selected === r ? <span className="ml-1 font-normal text-[var(--ink-soft)]">(เลือกอยู่)</span> : null}
                </p>
                <dl className="mt-1 space-y-1">
                  {ROWS.map((row) => (
                    <div key={row.q}>
                      <dt className="font-medium text-[var(--ink-soft)]">{row.q}</dt>
                      <dd className="text-[var(--ink)]">{r === "all" ? row.all : row.any}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="w-[26%] border-b border-[var(--line)] p-1.5 text-left font-medium text-[var(--ink-soft)]" />
                  {(["all", "any"] as const).map((r) => (
                    <th
                      key={r}
                      className={cn(
                        "border-b border-[var(--line)] p-1.5 text-left font-semibold",
                        selected === r ? "bg-[var(--bg-soft)] text-[var(--ink)]" : "text-[var(--ink-soft)]",
                      )}
                    >
                      {r === "all" ? "ครบทุกคน" : "คนใดคนหนึ่ง"}
                      {selected === r ? <span className="ml-1 font-normal text-[var(--ink-soft)]">(เลือกอยู่)</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.q}>
                    <td className="border-b border-[var(--line)] p-1.5 align-top font-medium text-[var(--ink-soft)]">{row.q}</td>
                    <td className={cn("border-b border-[var(--line)] p-1.5 align-top", selected === "all" && "bg-[var(--bg-soft)]")}>{row.all}</td>
                    <td className={cn("border-b border-[var(--line)] p-1.5 align-top", selected === "any" && "bg-[var(--bg-soft)]")}>{row.any}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-md bg-[var(--bg-soft)] p-2">
            <p className="font-semibold text-[var(--ink)]">ข้อ &quot;ช่วยกันทำ&quot; ในเช็คลิสต์ (ใช้ได้กับทั้งสองแบบ)</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[var(--ink)]">
              <li>ใครในงานติ๊กก็ได้ — ข้อที่มีชื่อคนอื่น ยังติ๊กแทนไม่ได้</li>
              <li>ต้องเสร็จก่อน ทุกคนถึงจะนับว่าครบส่วนของตัวเอง</li>
              <li>ทุกข้อเป็นช่วยกันทำ = ครบทุกข้อแล้วงานปิด · เลยกำหนดยังไม่ครบ หักทุกคน</li>
            </ul>
            {!hasChecklist && <p className="mt-1 text-[var(--ink-soft)]">ตั้งได้ที่ ตัวเลือกขั้นสูง → มีเช็คลิสต์ → เลือก &quot;ช่วยกันทำ&quot; ที่แต่ละข้อ</p>}
          </div>
          <p className="text-[var(--ink-soft)]">
            คะแนนที่หักตามที่ตั้งไว้ในตั้งค่าคะแนน · ขอเลื่อนกำหนดส่งได้รายคน · งานส่วนตัวไม่นับคะแนน
          </p>
        </div>
      )}
    </div>
  );
}
