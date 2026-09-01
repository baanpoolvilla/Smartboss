"use client";

import { useActionState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { inputClass } from "@/modules/hr/components/ui";
import { recalculateAttendanceAction, type RecalcState } from "../actions";

const EMPTY: RecalcState = {};

export interface RecalcPerson {
  id: string;
  label: string;
}

/**
 * ปุ่มสั่งคำนวณผลลงเวลาซ้ำของช่วงที่กำลังดูอยู่
 *
 * หน้านี้คำนวณให้ทุกคนอัตโนมัติอยู่แล้วตอนโหลด (ดู auto-recalculate.ts) —
 * ปุ่มนี้เหลือไว้สำหรับกรณีที่แก้กะ/อนุมัติลาย้อนหลังแล้วอยากให้ผลอัปเดต
 * ทันทีโดยไม่ต้องรอโหลดหน้าใหม่ ไม่ใช่ขั้นตอนบังคับที่ต้องกดก่อนเห็นตัวเลข
 */
export function RecalculateForm({
  people,
  from,
  to,
}: {
  people: RecalcPerson[];
  from: string;
  to: string;
}) {
  const [state, formAction, pending] = useActionState(recalculateAttendanceAction, EMPTY);

  return (
    <div className="mb-4 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="from" value={from} />
        <input type="hidden" name="to" value={to} />
        <div className="min-w-52">
          <label className="mb-1 block text-xs font-medium text-(--ink-soft)">
            คำนวณผลลงเวลา {from} → {to}
          </label>
          <select name="employment_id" defaultValue="ALL" className={inputClass}>
            <option value="ALL">พนักงานทุกคน</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="default" disabled={pending}>
          {pending ? "กำลังคำนวณ…" : "คำนวณใหม่"}
        </Button>
      </form>

      {state.error && <p className="mt-2 text-sm text-(--danger)">{state.error}</p>}

      {state.ok && (
        <p className="mt-2 text-sm">
          คำนวณแล้ว {state.people} คน
          {state.failed ? ` · ข้าม ${state.failed} คนที่ยังไม่ได้ผูกกะ` : ""}
        </p>
      )}

      <p className="mt-2 text-xs text-(--ink-soft)">
        ตัวเลขในหน้านี้คำนวณให้อัตโนมัติทุกครั้งที่เปิดหน้าอยู่แล้ว — ใช้ปุ่มนี้
        เมื่อเพิ่งแก้กะ/อนุมัติลาย้อนหลัง แล้วอยากให้ผลอัปเดตทันทีโดยไม่ต้องรอ
        โหลดหน้าใหม่ · คนที่ยังไม่ถูกผูกกะจะคำนวณไม่ได้ เพราะไม่มีเวลามาตรฐานให้เทียบ
        (ตั้งที่หน้า &ldquo;กะทำงาน&rdquo;)
      </p>
    </div>
  );
}
