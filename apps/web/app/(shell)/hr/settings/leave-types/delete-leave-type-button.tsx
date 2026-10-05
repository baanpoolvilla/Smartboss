"use client";

import { useState, useTransition } from "react";
import { Button } from "@smartboss/ui/components/button";
import { inputClass } from "@/modules/hr/components/ui";
import { deleteLeaveTypeAction } from "../../actions";

/**
 * ลบประเภทการลาออกจากรายการ — ถามยืนยันในที่เดิมก่อน เพราะกดแล้วพนักงานเลือกประเภทนี้ไม่ได้ทันที
 *
 * เลือกได้ว่าใบที่ลงไว้แล้วจะ "คงประเภทเดิม" หรือ "ย้ายไปประเภทอื่น" — อย่างหลังใช้รวมประเภทที่สร้างซ้ำกัน
 * (เช่น "วันหยุดประจำเดือน" กับ "Day-Off" ซึ่งคืออันเดียวกัน: ย้ายแล้วปฏิทินและโควตารายเดือนนับรวมเป็นประเภทเดียว)
 */
export function DeleteLeaveTypeButton({
  id,
  name,
  others,
}: {
  id: string;
  name: string;
  /** ประเภทอื่นที่ยังใช้งาน — ปลายทางให้ย้ายใบไป */
  others: { id: string; name: string }[];
}) {
  const [confirming, setConfirming] = useState(false);
  const [mergeInto, setMergeInto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (!confirming) {
    return (
      <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs text-(--danger)" onClick={() => setConfirming(true)}>
        ลบ
      </Button>
    );
  }
  return (
    <span className="flex basis-full flex-wrap items-center gap-1.5 rounded-(--radius) border border-(--line) bg-(--bg-soft) px-2 py-1.5 text-xs">
      <span className="text-(--ink)">ลบ “{name}” · ใบที่ลงไว้แล้ว:</span>
      <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className={`${inputClass} h-7 w-auto text-xs`} aria-label="ใบที่ลงไว้แล้ว">
        <option value="">คงเป็น “{name}” เหมือนเดิม</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            ย้ายไปเป็น “{o.name}”
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        variant="danger"
        className="h-7 px-2 text-xs"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const result = await deleteLeaveTypeAction(id, mergeInto || null);
            if (result.error) setError(result.error);
          })
        }
      >
        {busy ? "กำลังลบ…" : "ยืนยันลบ"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={busy}
        onClick={() => {
          setConfirming(false);
          setError(null);
        }}
      >
        ยกเลิก
      </Button>
      {error && <span className="basis-full text-(--danger)">{error}</span>}
    </span>
  );
}
