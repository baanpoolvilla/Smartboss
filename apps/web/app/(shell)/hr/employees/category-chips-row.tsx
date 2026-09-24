"use client";

import { useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "@/components/module/dialog";
import { PenaltyRequestChip } from "./penalty-request-chip";

export interface CategoryRow {
  category: string;
  label: string;
  points: number;
  count: number;
}

/**
 * แถวชิป "เสียคะแนนเพราะ" ของตาราง "คะแนน & เกรด" — โชว์แค่ 3 หมวดที่หัก
 * คะแนนเยอะสุดเป็นชิปตามเดิม (เรียงมาจาก buildScorecards แล้ว) ส่วนที่เหลือ
 * (ถ้ามี) รวบเป็นปุ่ม "+N" กดได้ เปิดไดอะล็อกดูครบทุกหมวด — เดิม "+N" เป็นแค่
 * ตัวเลขเฉยๆ กดไม่ได้ ข้อมูลที่เหลือมีอยู่แล้วใน card.byCategory (หน้าโปรไฟล์
 * พนักงานเองก็โชว์ครบทุกหมวดแบบนี้อยู่แล้ว) แค่ต้องมีที่ให้กดดูจากตารางรวมนี้
 * ด้วยโดยไม่ต้องออกไปหน้าโปรไฟล์
 */
export function CategoryChipsRow({ userId, rows }: { userId: string; rows: CategoryRow[] }) {
  const [open, setOpen] = useState(false);
  const visible = rows.slice(0, 3);
  const hiddenCount = rows.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((row) =>
        row.category === "report_missed" || row.category === "report_late" ? (
          <PenaltyRequestChip
            key={row.category}
            userId={userId}
            category={row.category}
            label={row.label}
            points={row.points}
            count={row.count}
          />
        ) : (
          <span
            key={row.category}
            className="rounded-full border border-(--line) px-2 py-0.5 text-[11px] text-(--ink-soft)"
          >
            {row.label} <span style={{ color: "var(--danger)" }}>{row.points}</span>
            {row.count > 1 ? ` ×${row.count}` : ""}
          </span>
        )
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full px-1.5 text-[11px] text-(--ink-soft) underline decoration-dotted underline-offset-2 hover:text-(--ink)"
          title="ดูหมวดที่เหลือทั้งหมด"
        >
          +{hiddenCount}
        </button>
      )}

      {open && (
        <Modal
          title="เสียคะแนนเพราะ — ทุกหมวด"
          onClose={() => setOpen(false)}
          actions={<Button onClick={() => setOpen(false)}>ปิด</Button>}
        >
          <div className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <div
                key={row.category}
                className="flex items-center justify-between gap-3 rounded-(--radius) border border-(--line) px-3 py-2 text-sm"
              >
                <span className="text-(--ink)">{row.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {row.count > 1 && <span className="text-(--ink-soft)">×{row.count}</span>}
                  <span className="font-mono font-medium" style={{ color: "var(--danger)" }}>
                    {row.points}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
