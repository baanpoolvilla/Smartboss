"use client";

import { useActionState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Field, inputClass } from "@/modules/hr/components/ui";
import { setDayOffQuotaAction, type QuotaState } from "../../actions";
import type { DayOffQuotaSource } from "@/lib/day-off-quota";

const EMPTY: QuotaState = {};

/**
 * วันหยุดของคนนี้ในเดือนที่กำลังดู — ตั้งเป็นเดือน ๆ ไป
 *
 * เดือนที่ไม่ได้มาแก้ = ค่าตั้งต้น (6 วัน) · มาแก้เดือนไหนก็มีผลแค่เดือนนั้น ช่องเดียว ใส่จำนวนวันที่ได้ตรง ๆ
 * (เดือนนี้ให้ 7 ก็ใส่ 7 · ให้ 4 ก็ใส่ 4)
 *
 * เดิมมีสองช่อง "ค่าประจำทุกเดือน" กับ "ทับเฉพาะเดือน" — ค่าประจำเป็นเลขเดียวที่ย้อนไปมีผลกับเดือนเก่าด้วย
 * เปลี่ยนจาก 6 เป็น 4 แล้วเดือนที่แล้วกลายเป็น 4 ตาม คนใช้ต้องคิดสองชั้น ("เอาเป็นเดือน ๆ ไปดีไหม แต่ถ้า
 * ไม่มาแก้ของเดือนนั้น ๆ ก็เป็น 6") จึงเหลือช่องรายเดือนช่องเดียว
 *
 * คนที่เคยตั้งค่าประจำไว้ก่อนหน้านี้: ค่านั้นยังเป็นฐานของเดือนที่ไม่ได้แก้อยู่ (ข้อมูลเดิมไม่หาย) — มีบรรทัดบอก
 * พร้อมปุ่มล้าง ให้กลับไปใช้ 6 วันเหมือนคนอื่น
 */
export function DayOffQuotaForm({
  employmentId,
  month,
  daysPerMonth,
  source,
  employeeStanding,
  companyDefault,
  note,
}: {
  employmentId: string;
  /** "YYYY-MM" — เดือนที่การ์ดนี้กำลังตั้งค่าอยู่ */
  month: string;
  daysPerMonth: number;
  source: DayOffQuotaSource;
  /** ค่าประจำที่เคยตั้งไว้ของคนนี้ · null = ไม่มี (กรณีปกติ) */
  employeeStanding: number | null;
  companyDefault: number;
  note: string;
}) {
  const [state, formAction, pending] = useActionState(setDayOffQuotaAction, EMPTY);
  // เดือนที่ไม่ได้แก้ได้กี่วัน — ปกติคือค่าตั้งต้น เว้นแต่คนนี้มีค่าประจำเดิมค้างอยู่
  const base = employeeStanding ?? companyDefault;

  return (
    <>
      <form
        action={formAction}
        data-save-toast="off"
        // key = ค่าปัจจุบันของเดือน — บันทึก/ล้างแล้วช่องต้องกลับมาแสดงค่าจริงล่าสุด ไม่ค้างค่าที่พิมพ์ไว้
        key={`${month}:${source}:${daysPerMonth}`}
        className="flex flex-col gap-3 rounded-(--radius) border border-(--line) p-3"
      >
        <input type="hidden" name="employment_id" value={employmentId} />
        <input type="hidden" name="month" value={month} />
        <input type="hidden" name="scope" value="month" />
        <input type="hidden" name="month_mode" value="set" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={`วันหยุดของเดือน ${month}`}
            hint={
              source === "month"
                ? `แก้ไว้เฉพาะเดือนนี้ · เดือนที่ไม่ได้แก้ได้ ${base} วัน`
                : `ยังไม่ได้แก้ของเดือนนี้ — ใช้ ${base} วัน · แก้แล้วมีผลแค่เดือนนี้`
            }
          >
            <input
              name="month_days"
              type="number"
              min={0}
              max={31}
              step={1}
              inputMode="numeric"
              required
              defaultValue={String(daysPerMonth)}
              className={inputClass}
            />
          </Field>
          <Field label="หมายเหตุ" hint="เช่น ปิดกิจการชั่วคราว">
            <input name="note" maxLength={200} defaultValue={source === "month" ? note : ""} className={inputClass} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "กำลังบันทึก…" : "บันทึกของเดือนนี้"}
          </Button>
          {source === "month" && (
            <Button type="submit" name="reset" value="1" formNoValidate variant="outline" disabled={pending}>
              กลับไปใช้ {base} วัน
            </Button>
          )}
        </div>
      </form>

      {employeeStanding !== null && (
        <form action={formAction} data-save-toast="off" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-(--ink-soft)">
          <input type="hidden" name="employment_id" value={employmentId} />
          <input type="hidden" name="scope" value="standing" />
          <input type="hidden" name="standing_days" value="" />
          <span>
            คนนี้เคยตั้งค่าประจำไว้ {employeeStanding} วัน/เดือน — เดือนที่ไม่ได้แก้จึงได้ {employeeStanding} วัน ไม่ใช่ {companyDefault}
          </span>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            ล้าง ให้ใช้ {companyDefault} วัน
          </Button>
        </form>
      )}

      {state.error && <p className="mt-2 text-sm text-(--danger)">{state.error}</p>}
      {state.ok && (
        <p className="mt-2 text-sm text-(--ink-soft)">
          {state.cleared
            ? state.scope === "standing"
              ? `ล้างค่าประจำแล้ว — เดือนที่ไม่ได้แก้ใช้ ${companyDefault} วัน`
              : `ล้างของเดือนนี้แล้ว — กลับไปใช้ ${base} วัน`
            : `บันทึกแล้ว — เดือนนี้คนนี้ได้หยุด ${state.daysPerMonth} วัน`}
        </p>
      )}
    </>
  );
}
