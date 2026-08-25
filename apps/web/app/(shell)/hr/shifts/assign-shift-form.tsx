"use client";

import { useActionState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Field, inputClass } from "@/modules/hr/components/ui";
import { setRecurringPatternAction, type PatternState } from "../actions";

const EMPTY: PatternState = {};

const DAYS = [
  ["monday", "จันทร์"],
  ["tuesday", "อังคาร"],
  ["wednesday", "พุธ"],
  ["thursday", "พฤหัสบดี"],
  ["friday", "ศุกร์"],
  ["saturday", "เสาร์"],
  ["sunday", "อาทิตย์"],
] as const;

export interface ShiftOption {
  id: string;
  label: string;
  restDay: boolean;
}

export interface PersonOption {
  id: string;
  label: string;
}

export function AssignShiftForm({
  employments,
  shifts,
  today,
}: {
  employments: PersonOption[];
  shifts: ShiftOption[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(setRecurringPatternAction, EMPTY);

  if (shifts.length === 0 || employments.length === 0) {
    return (
      <p className="text-sm text-(--ink-soft)">
        ต้องมีทั้งกะทำงานและพนักงานอย่างน้อยอย่างละหนึ่งก่อน จึงจะผูกตารางได้
      </p>
    );
  }

  // วันทำงานตั้งต้นให้กะแรกที่ไม่ใช่วันหยุด — ส่วนเสาร์-อาทิตย์ปล่อยว่าง
  const defaultWorkShift = shifts.find((s) => !s.restDay)?.id ?? "";

  return (
    <>
      <form action={formAction} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="พนักงาน *">
            <select name="employment_id" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                เลือกพนักงาน
              </option>
              {employments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="เริ่มใช้ตั้งแต่ *" hint="ผลลงเวลาก่อนวันนี้ยังใช้ตารางเดิม">
            <input
              type="date"
              name="effective_from"
              required
              defaultValue={today}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {DAYS.map(([field, label]) => (
            <Field key={field} label={label}>
              <select
                name={field}
                defaultValue={
                  field === "saturday" || field === "sunday" ? "" : defaultWorkShift
                }
                className={inputClass}
              >
                <option value="">— หยุด —</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>

        <div>
          <Button type="submit" disabled={pending} className="sm:w-44">
            {pending ? "กำลังบันทึก…" : "บันทึกตาราง"}
          </Button>
        </div>
      </form>

      {state.error && <p className="mt-2 text-sm text-(--danger)">{state.error}</p>}

      {state.ok && (
        <div className="mt-3 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3 text-sm">
          <p className="font-medium">บันทึกตารางแล้ว</p>
          <p className="mt-1 text-(--ink-soft)">
            ตารางเดิมของคนนี้ถูกปิดให้อัตโนมัติ ระบบจะใช้ตารางใหม่คิดสาย/ขาด/OT
            ตั้งแต่วันที่ระบุเป็นต้นไป — ผลลงเวลาที่คำนวณไปแล้วต้องสั่งคำนวณใหม่ที่หน้า
            &ldquo;ผลลงเวลา&rdquo; ถ้าอยากให้ย้อนไปใช้เกณฑ์ใหม่
          </p>
        </div>
      )}
    </>
  );
}
