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
 * ปุ่มสั่งคำนวณผลลงเวลาของช่วงที่กำลังดูอยู่
 *
 * การสแกนไม่กลายเป็นผลลงเวลาเอง — ถ้าไม่มีปุ่มนี้ หน้าจะขึ้น 0 ตลอด
 * ทั้งที่เครื่องส่งข้อมูลมาแล้ว ซึ่งอ่านแล้วนึกว่าเครื่องพัง
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
          {pending ? "กำลังคำนวณ…" : "คำนวณ"}
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
        การสแกนถูกบันทึกทันที แต่จะกลายเป็นสาย/ขาด/OT ก็ต่อเมื่อสั่งคำนวณ —
        และคนที่ยังไม่ถูกผูกกะจะคำนวณไม่ได้ เพราะไม่มีเวลามาตรฐานให้เทียบ
        (ตั้งที่หน้า &ldquo;กะทำงาน&rdquo;)
      </p>
    </div>
  );
}
