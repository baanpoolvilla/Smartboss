"use client";

import { useActionState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Field, inputClass } from "@/modules/hr/components/ui";
import { addHolidayAction, type HolidayState } from "../actions";

const EMPTY: HolidayState = {};

export function AddHolidayForm({
  companyId,
  defaultDate,
}: {
  companyId: string;
  defaultDate: string;
}) {
  const [state, formAction, pending] = useActionState(addHolidayAction, EMPTY);

  return (
    <>
      <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <input type="hidden" name="company_id" value={companyId} />
        <Field label="วันที่ *">
          <input
            type="date"
            name="holiday_date"
            required
            defaultValue={defaultDate}
            className={inputClass}
          />
        </Field>
        <Field label="ชื่อวันหยุด *">
          <input
            name="name"
            required
            maxLength={120}
            placeholder="วันสงกรานต์"
            className={inputClass}
          />
        </Field>
        <Field label="ค่าจ้าง">
          <select name="paid" defaultValue="1" className={inputClass}>
            <option value="1">หยุดโดยได้รับค่าจ้าง</option>
            <option value="0">หยุดโดยไม่ได้รับค่าจ้าง</option>
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={pending}>
            {pending ? "กำลังเพิ่ม…" : "เพิ่มวันหยุด"}
          </Button>
        </div>
      </form>

      {state.error && <p className="mt-2 text-sm text-(--danger)">{state.error}</p>}
      {state.ok && (
        <p className="mt-2 text-sm">
          เพิ่ม {state.added} แล้ว — วันนั้นจะไม่ถูกนับเป็นขาดงานอีกต่อไป
          แต่ผลลงเวลาที่คำนวณไปแล้วต้องสั่งคำนวณใหม่ที่หน้า “ผลลงเวลา”
        </p>
      )}
    </>
  );
}
