"use client";

import { useActionState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Field, inputClass } from "@/modules/hr/components/ui";
import { setDayOffQuotaAction, type QuotaState } from "../../actions";

const EMPTY: QuotaState = {};

/**
 * โควตาวันหยุดต่อเดือนของคนนี้ — ผูกกับเดือนที่กำลังดูอยู่ (การ์ดปฏิทินข้างล่าง
 * ใช้ปุ่ม ◀ ▶ เปลี่ยนเดือนอันเดียวกัน) ไม่ใช่ค่าที่ทับตลอดกาล
 *
 * เดิมตั้งครั้งเดียวมีผลกับทุกเดือนของคนนั้นไปตลอด — เดือนที่ตกลงกันให้หยุด
 * พิเศษ (เช่นปิดกิจการชั่วคราว) จะเปลี่ยนโควตาเดือนอื่น ๆ ของคนนั้นไปด้วย
 * โดยไม่มีใครตั้งใจ ต้องกลับมาแก้คืนเองทีหลัง
 *
 * ปล่อยว่าง = ใช้ค่าตั้งต้นของบริษัทเฉพาะเดือนนี้ ไม่ใช่ 0 วัน — ต้องแยกให้ออก
 * เพราะ "ยังไม่ได้ตกลงอะไรเป็นพิเศษ" กับ "ตกลงว่าไม่ได้หยุดเลย" คนละความหมาย
 */
export function DayOffQuotaForm({
  employmentId,
  month,
  daysPerMonth,
  perEmployee,
  companyDefault,
  note,
}: {
  employmentId: string;
  /** "YYYY-MM" — เดือนที่การ์ดนี้กำลังตั้งค่าอยู่ */
  month: string;
  daysPerMonth: number;
  perEmployee: boolean;
  companyDefault: number;
  note: string;
}) {
  const [state, formAction, pending] = useActionState(setDayOffQuotaAction, EMPTY);

  return (
    <>
      <p className="mb-3 text-sm">
        เดือน {month} คนนี้ได้หยุด <strong>{daysPerMonth} วัน</strong>{" "}
        <span className="text-(--ink-soft)">
          ({perEmployee
            ? `ตั้งไว้เฉพาะเดือนนี้ · มาตรฐานบริษัทคือ ${companyDefault} วัน`
            : "ตามค่าตั้งต้นของบริษัท"}
          )
        </span>
      </p>

      <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <input type="hidden" name="employment_id" value={employmentId} />
        <input type="hidden" name="month" value={month} />
        <Field
          label={`วันหยุดต่อเดือน (${month})`}
          hint={`มีผลแค่เดือนนี้ · ปล่อยว่างเพื่อใช้ค่าตั้งต้นของบริษัท (${companyDefault} วัน)`}
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
            {pending ? "กำลังบันทึก…" : "บันทึกโควตาเดือนนี้"}
          </Button>
        </div>
      </form>

      {state.error && <p className="mt-2 text-sm text-(--danger)">{state.error}</p>}
      {state.ok && (
        <p className="mt-2 text-sm text-(--ink-soft)">
          {state.cleared
            ? `ล้างโควตาของเดือนนี้แล้ว — กลับไปใช้ค่าตั้งต้นของบริษัท (${companyDefault} วัน)`
            : `บันทึกแล้ว — เดือนนี้คนนี้ได้หยุด ${state.daysPerMonth} วัน`}
        </p>
      )}
    </>
  );
}
