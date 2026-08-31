"use client";

import { useActionState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Field, inputClass } from "@/modules/hr/components/ui";
import { setDayOffQuotaAction, type QuotaState } from "../../actions";

const EMPTY: QuotaState = {};

/**
 * โควตาวันหยุดต่อเดือนของคนนี้
 *
 * ปล่อยว่าง = ใช้ค่าตั้งต้นของบริษัท ไม่ใช่ 0 วัน — ต้องแยกให้ออก เพราะ
 * "ยังไม่ได้ตกลงอะไรเป็นพิเศษ" กับ "ตกลงว่าไม่ได้หยุดเลย" คนละความหมาย
 * และการเผลอเก็บ 0 แทนค่าว่างจะทำให้บันทึกวันหยุดไม่ได้สักวัน
 */
export function DayOffQuotaForm({
  employmentId,
  daysPerMonth,
  perEmployee,
  companyDefault,
  note,
}: {
  employmentId: string;
  daysPerMonth: number;
  perEmployee: boolean;
  companyDefault: number;
  note: string;
}) {
  const [state, formAction, pending] = useActionState(setDayOffQuotaAction, EMPTY);

  return (
    <>
      <p className="mb-3 text-sm">
        ตอนนี้คนนี้ได้หยุด <strong>{daysPerMonth} วัน/เดือน</strong>{" "}
        <span className="text-(--ink-soft)">
          ({perEmployee
            ? `ตั้งไว้เฉพาะคนนี้ · มาตรฐานบริษัทคือ ${companyDefault} วัน`
            : "ตามค่าตั้งต้นของบริษัท"}
          )
        </span>
      </p>

      <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <input type="hidden" name="employment_id" value={employmentId} />
        <Field
          label="วันหยุดต่อเดือน"
          hint={`ปล่อยว่างเพื่อใช้ค่าตั้งต้นของบริษัท (${companyDefault} วัน)`}
        >
          <input
            name="days_per_month"
            type="number"
            min={0}
            max={31}
            step={1}
            inputMode="numeric"
            defaultValue={perEmployee ? String(daysPerMonth) : ""}
            placeholder={String(companyDefault)}
            className={inputClass}
          />
        </Field>
        <Field label="หมายเหตุ" hint="เช่น ตามสัญญาจ้างฉบับ 2569">
          <input name="note" maxLength={200} defaultValue={note} className={inputClass} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={pending}>
            {pending ? "กำลังบันทึก…" : "บันทึกโควตา"}
          </Button>
        </div>
      </form>

      {state.error && <p className="mt-2 text-sm text-(--danger)">{state.error}</p>}
      {state.ok && (
        <p className="mt-2 text-sm text-(--ink-soft)">
          {state.cleared
            ? `ล้างโควตาเฉพาะคนนี้แล้ว — กลับไปใช้ค่าตั้งต้นของบริษัท (${companyDefault} วัน)`
            : `บันทึกแล้ว — คนนี้ได้หยุด ${state.daysPerMonth} วัน/เดือน`}
        </p>
      )}
    </>
  );
}
