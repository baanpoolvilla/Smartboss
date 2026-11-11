"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";

/**
 * (i) ข้าง "ปิดงานเมื่อ" ของใบแจ้งซ่อมกลุ่ม — แบบเดียวกับงาน (report_task completion-rule-guide.tsx)
 * ข้อความตรงกับกติกาจริง: lib/work-order-members.ts (ปิดงาน) · data/cron.ts (หักคนที่ยังไม่เสร็จตามกำหนดรายคน)
 * · lib/work-order-review.ts (ใบที่คนเปิดต้องผ่านการตรวจ) — ผู้ใช้ 10/11/2569 "แบบละเอียด แต่อ่านง่าย"
 */
type Rule = "all" | "any" | "shared";

const RULES: { v: Rule; name: string; tagline: string; lines: [string, string][] }[] = [
  {
    v: "all",
    name: "ครบทุกคน",
    tagline: "แบ่งงานกันทำ",
    lines: [
      ["ทำ", "ทุกคนทำส่วนของตัวเอง แล้วกด \"เสร็จส่วนของฉันแล้ว\" (หรือติ๊กเช็กลิสต์ของตัวเองครบ)"],
      ["ปิดงาน", "คนสุดท้ายที่เสร็จกดปิดงาน — คนเดียวปิดไม่ได้"],
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
      ["ปิดงาน", "คนแรกที่ทำเสร็จกดปิดงานได้เลย"],
      ["หักคะแนน", "ปิดทันกำหนด ไม่มีใครโดน · เลยกำหนดยังไม่ปิด หักทุกคน"],
      ["เช่น", "ไปรับของ ไปดูหน้างาน"],
    ],
  },
  {
    v: "shared",
    name: "ช่วยกันทำ",
    tagline: "ทำด้วยกัน",
    lines: [
      ["ทำ", "ช่วยกันทำเช็กลิสต์ ใครติ๊กข้อไหนก็ได้"],
      ["ปิดงาน", "ใครในกลุ่มกดปิดงานก็ได้"],
      ["หักคะแนน", "เลยกำหนดยังไม่ปิด หักทุกคน"],
      ["เช่น", "ทำความสะอาดใหญ่ ย้ายของทั้งบ้าน"],
    ],
  },
];

export function WoRuleInfo({ selected }: { selected: Rule }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="ปิดงานเมื่อ ต่างกันยังไง"
        title="ปิดงานเมื่อ ต่างกันยังไง"
        data-testid="wo-rule-info"
        className="-m-2 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-(--ink-soft) hover:text-(--brand-navy,#1b2537)"
      >
        <Info className="size-4" aria-hidden />
      </button>
      {open && (
        <Modal
          title="ปิดงานเมื่อ — ต่างกันยังไง"
          wide
          onClose={() => setOpen(false)}
          actions={
            <Button type="button" onClick={() => setOpen(false)} className="w-full sm:w-auto">
              เข้าใจแล้ว
            </Button>
          }
        >
          <div className="space-y-3 text-sm text-(--ink)" data-testid="wo-rule-guide">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {RULES.map((r) => (
                <section
                  key={r.v}
                  className={`rounded-lg p-3 ${selected === r.v ? "border-2 border-(--brand-navy,#1b2537)" : "border border-(--line)"}`}
                >
                  <h3 className="font-semibold">
                    {r.name} <span className="font-normal text-(--ink-soft)">· {r.tagline}</span>
                  </h3>
                  {selected === r.v && <p className="text-[11px] text-(--ink-soft)">เลือกอยู่</p>}
                  <dl className="mt-1.5 space-y-1">
                    {r.lines.map(([k, v]) => (
                      <div key={k} className="flex gap-2 sm:block">
                        <dt className="w-16 shrink-0 text-xs font-medium text-(--ink-soft)">{k}</dt>
                        <dd className="min-w-0">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
            <p className="rounded-lg bg-(--bg-soft) px-3 py-2">
              <b>ทุกแบบ:</b> ใบที่คนเปิด ปิดงานแล้วรอคนเปิดใบกด ผ่าน / ไม่ผ่าน ก่อนไปบันทึกค่าใช้จ่าย · ส่งงานทันกำหนด = ไม่โดนหัก แม้ตรวจทีหลัง
            </p>
            <p className="text-xs text-(--ink-soft)">คะแนนที่หักเป็นไปตามตั้งค่าคะแนน (ใบงานเกินกำหนด ปกติ −3) · ขอเลื่อนกำหนดส่งได้รายคน</p>
          </div>
        </Modal>
      )}
    </>
  );
}
