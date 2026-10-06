"use client";

import { useActionState, useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Field, inputClass } from "@/modules/hr/components/ui";
import { setDayOffQuotaAction, type QuotaState } from "../../actions";
import type { DayOffQuotaSource } from "@/lib/day-off-quota";

const EMPTY: QuotaState = {};

/**
 * โควตาวันหยุดต่อเดือนของคนนี้ — สองชั้น
 *
 * ── ค่าประจำ ──
 * ข้อตกลงจ้างงานรายคน: บางคนได้หยุดเดือนละ 4 วัน บางคน 6 วัน เป็นค่าถาวร
 * ตั้งครั้งเดียวแล้วมีผลทุกเดือน เดิมมีแต่ช่องรายเดือน คนที่ตกลงกันว่าได้ 6
 * จึงตกกลับไปเป็นค่ามาตรฐานของบริษัทเงียบ ๆ ทุกครั้งที่ขึ้นเดือนใหม่ แล้วลง
 * วันหยุดวันที่ 5-6 ไม่ได้ จนกว่าฝ่ายบุคคลจะไปกรอกใหม่
 *
 * ── ทับเฉพาะเดือนนี้ ──
 * เดือนที่ตกลงกันเป็นพิเศษ (เช่นปิดกิจการชั่วคราว) ต้องไม่ทำให้เดือนอื่นของ
 * คนนั้นเปลี่ยนตามไปด้วย จึงแยกเป็นอีกชั้นที่ผูกกับเดือนที่กำลังดูอยู่
 * เลือกได้สามแบบ แล้วใส่เลขบวกธรรมดาเสมอ: "เพิ่ม" (ใส่ 1 = ค่าประจำ 6 + 1 = 7 วัน) · "ลด" (ใส่ 2 = 4 วัน)
 * · "กำหนดเป็น" (ใส่ 4 = 4 วัน) — HR คิดเป็น "เดือนนี้ให้เพิ่มอีกวัน" พอช่องรับแต่ยอดรวม ใส่ 1 แล้วเดือนนั้น
 * เหลือหยุดได้วันเดียว และให้ใส่เลขติดลบเพื่อลดก็ไม่สะดวก ("ใส่ - คิดว่าไม่น่าจะสะดวก")
 * ที่เก็บจริงยังเป็นยอดรวมของเดือนนั้น (เซิร์ฟเวอร์คิดให้) ⇒ แก้ค่าประจำทีหลัง ยอดของเดือนที่ตั้งไว้แล้วไม่ขยับตาม
 *
 * ทั้งสองช่อง ปล่อยว่าง = กลับไปใช้ชั้นที่กว้างกว่า ไม่ใช่ 0 วัน — "ยังไม่ได้
 * ตกลงอะไรเป็นพิเศษ" กับ "ตกลงว่าไม่ได้หยุดเลย" คนละความหมาย
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
  /** ค่าประจำของคนนี้ · null = ยังไม่เคยตั้ง */
  employeeStanding: number | null;
  companyDefault: number;
  note: string;
}) {
  const [state, formAction, pending] = useActionState(setDayOffQuotaAction, EMPTY);
  // ฐานที่ช่อง "เพิ่ม/ลด" ของเดือนบวกเข้าไป = ค่าประจำของคนนี้ ถ้าไม่มีใช้ค่าตั้งต้นของบริษัท
  const base = employeeStanding ?? companyDefault;
  const extra = source === "month" ? daysPerMonth - base : null;
  const [mode, setMode] = useState<"add" | "sub" | "set">(extra !== null && extra < 0 ? "sub" : "add");
  const [amount, setAmount] = useState(extra === null ? "" : String(Math.abs(extra)));
  // ยอดที่เดือนนี้จะได้ถ้ากดบันทึกตอนนี้ — โชว์ใต้ช่องให้เห็นก่อนกด ไม่ต้องบวกลบในใจ
  const typed = amount.trim() === "" ? null : Number(amount);
  const preview =
    typed === null || !Number.isInteger(typed) || typed < 0
      ? null
      : mode === "add"
        ? base + typed
        : mode === "sub"
          ? base - typed
          : typed;

  const originLabel =
    source === "month"
      ? `ค่าประจำ ${base} วัน ${extra !== null && extra < 0 ? `ลด ${-extra}` : `เพิ่ม ${extra ?? 0}`} วันเฉพาะเดือนนี้`
      : source === "employee"
        ? `ค่าประจำของคนนี้ · มาตรฐานบริษัทคือ ${companyDefault} วัน`
        : "ตามค่าตั้งต้นของบริษัท";

  return (
    <>
      <p className="mb-3 text-sm">
        เดือน {month} คนนี้ได้หยุด <strong>{daysPerMonth} วัน</strong>{" "}
        <span className="text-(--ink-soft)">({originLabel})</span>
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── ค่าประจำ: ข้อตกลงจ้างงาน มีผลทุกเดือน ── */}
        <form action={formAction} data-save-toast="off" className="flex flex-col gap-3 rounded-(--radius) border border-(--line) p-3">
          <input type="hidden" name="employment_id" value={employmentId} />
          <input type="hidden" name="scope" value="standing" />
          <p className="text-xs font-semibold text-(--ink)">ค่าประจำของคนนี้ (ทุกเดือน)</p>
          <Field
            label="วันหยุดต่อเดือนตามสัญญาจ้าง"
            hint={`มีผลทุกเดือนจนกว่าจะแก้ · ปล่อยว่างเพื่อใช้ค่าตั้งต้นของบริษัท (${companyDefault} วัน)`}
          >
            <input
              name="standing_days"
              type="number"
              min={0}
              max={31}
              step={1}
              inputMode="numeric"
              // ยังไม่เคยตั้งรายคน = โชว์ค่าตั้งต้นของบริษัทเป็นตัวเลขในช่องเลย (ไม่ใช่ช่องว่างกับตัวอักษรจาง)
              // HR เห็นว่า "ตอนนี้คือ 6 วัน แก้ได้" · กดบันทึกทั้งอย่างนั้นก็แค่ตั้งค่าประจำของคนนี้เท่ากับค่าเดิม
              defaultValue={String(employeeStanding ?? companyDefault)}
              placeholder={String(companyDefault)}
              className={inputClass}
            />
          </Field>
          <Field label="หมายเหตุ" hint="เช่น ตามสัญญาจ้างฉบับ 2569">
            <input
              name="standing_note"
              maxLength={200}
              defaultValue={source === "employee" ? note : ""}
              className={inputClass}
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "กำลังบันทึก…" : "บันทึกค่าประจำ"}
          </Button>
        </form>

        {/* ── ทับเฉพาะเดือนที่กำลังดูอยู่ ── */}
        <form action={formAction} data-save-toast="off" className="flex flex-col gap-3 rounded-(--radius) border border-(--line) p-3">
          <input type="hidden" name="employment_id" value={employmentId} />
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="scope" value="month" />
          <p className="text-xs font-semibold text-(--ink)">เพิ่ม/ลดเฉพาะเดือน {month}</p>
          <Field
            label={`วันหยุดของเดือน ${month}`}
            hint={
              preview === null
                ? `ค่าประจำ ${base} วัน — เลือกเพิ่ม/ลด/กำหนดเป็น แล้วใส่จำนวนวัน · ปล่อยว่างเพื่อใช้ค่าประจำ`
                : preview < 0 || preview > 31
                  ? `ได้ ${preview} วัน — ต้องอยู่ระหว่าง 0–31 วัน`
                  : `เดือนนี้จะได้หยุด ${preview} วัน (ค่าประจำ ${base} วัน)`
            }
          >
            <div className="flex gap-2">
              <select
                name="month_mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as "add" | "sub" | "set")}
                className={`${inputClass} w-auto shrink-0`}
                aria-label="วิธีตั้งวันหยุดของเดือนนี้"
              >
                <option value="add">เพิ่ม</option>
                <option value="sub">ลด</option>
                <option value="set">กำหนดเป็น</option>
              </select>
              <input
                name="month_days"
                type="number"
                min={0}
                max={31}
                step={1}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={mode === "set" ? String(base) : "0"}
                aria-label="จำนวนวัน"
                className={inputClass}
              />
            </div>
          </Field>
          <Field label="หมายเหตุ" hint="เช่น ปิดกิจการชั่วคราว">
            <input
              name="note"
              maxLength={200}
              defaultValue={source === "month" ? note : ""}
              className={inputClass}
            />
          </Field>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "กำลังบันทึก…" : "บันทึกเฉพาะเดือนนี้"}
          </Button>
        </form>
      </div>

      {state.error && <p className="mt-2 text-sm text-(--danger)">{state.error}</p>}
      {state.ok && (
        <p className="mt-2 text-sm text-(--ink-soft)">
          {state.cleared
            ? state.scope === "standing"
              ? `ล้างค่าประจำแล้ว — กลับไปใช้ค่าตั้งต้นของบริษัท (${companyDefault} วัน)`
              : `ล้างของเดือนนี้แล้ว — กลับไปใช้ค่าประจำ (${base} วัน)`
            : state.scope === "standing"
              ? `บันทึกแล้ว — คนนี้ได้หยุดเดือนละ ${state.daysPerMonth} วันทุกเดือน`
              : `บันทึกแล้ว — เดือนนี้คนนี้ได้หยุด ${state.daysPerMonth} วัน`}
        </p>
      )}
    </>
  );
}
