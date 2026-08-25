"use client";

import { useActionState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { setEmployeeDaysOffAction, type DaysOffState } from "../actions";

const EMPTY: DaysOffState = {};
const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

export interface ShiftChoice {
  id: string;
  label: string;
}

/**
 * ปฏิทินคลิกเลือกวันหยุดรายคน
 *
 * ใช้ checkbox จริงซ่อนไว้แล้วจัดสไตล์ที่ label — ไม่ต้องเก็บ state ใน React
 * ฟอร์มจึงส่งค่าถูกต้องแม้ JS ยังโหลดไม่เสร็จ และไม่มีทางที่จอกับค่าที่ส่ง
 * จะไม่ตรงกัน
 */
export function EmployeeDaysOff({
  companyId,
  employmentId,
  month,
  initialOff,
  workShifts,
  restShiftId,
}: {
  companyId: string;
  employmentId: string;
  month: string;
  initialOff: string[];
  workShifts: ShiftChoice[];
  restShiftId: string | null;
}) {
  const [state, formAction, pending] = useActionState(setEmployeeDaysOffAction, EMPTY);

  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year!, mon!, 0)).getUTCDate();
  const leading = new Date(Date.UTC(year!, mon! - 1, 1)).getUTCDay();
  const offSet = new Set(initialOff);

  if (restShiftId === null) {
    return (
      <p className="text-sm text-(--danger)">
        ยังไม่มีกะประเภท “วันหยุด” — ไปที่หน้า “กะทำงาน” สร้างกะแล้วติ๊ก
        “เป็นวันหยุด” หนึ่งใบก่อน (เช่นรหัส OFF) จึงจะลงวันหยุดรายคนได้
      </p>
    );
  }

  if (workShifts.length === 0) {
    return (
      <p className="text-sm text-(--danger)">
        ยังไม่มีกะสำหรับวันทำงาน — สร้างที่หน้า “กะทำงาน” ก่อน
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="employment_id" value={employmentId} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="rest_shift_id" value={restShiftId} />

      <label className="flex max-w-md flex-col gap-1">
        <span className="text-xs font-medium text-(--ink-soft)">
          กะสำหรับวันที่ไม่ได้หยุด *
        </span>
        <select
          name="work_shift_id"
          required
          defaultValue={workShifts[0]?.id}
          className="h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm"
        >
          {workShifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid max-w-md grid-cols-7 gap-1 text-center">
        {DOW.map((d) => (
          <span key={d} className="text-[11px] text-(--ink-soft)">
            {d}
          </span>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <span key={`pad${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          return (
            <label key={date} className="cursor-pointer">
              <input
                type="checkbox"
                name="off"
                value={date}
                defaultChecked={offSet.has(date)}
                className="peer sr-only"
              />
              <span
                className="block rounded-(--radius) border border-(--line) py-1.5 text-xs transition-colors peer-checked:border-transparent peer-checked:bg-(--danger) peer-checked:font-semibold peer-checked:text-white hover:bg-(--bg-soft)"
              >
                {day}
              </span>
            </label>
          );
        })}
      </div>

      <div>
        <Button type="submit" disabled={pending} className="sm:w-52">
          {pending ? "กำลังบันทึก…" : "บันทึกวันหยุดของเดือนนี้"}
        </Button>
      </div>

      {state.error && <p className="text-sm text-(--danger)">{state.error}</p>}
      {state.ok && (
        <div className="rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3 text-sm">
          <p className="font-medium">บันทึกแล้ว — หยุด {state.offDays} วันในเดือนนี้</p>
          <p className="mt-1 text-(--ink-soft)">
            ตารางนี้ทับตารางประจำสัปดาห์เฉพาะเดือนที่บันทึก
            และไปสั่งคำนวณใหม่ที่หน้า “ผลลงเวลา” เพื่อให้ผลที่คำนวณไปแล้วใช้เกณฑ์ใหม่
          </p>
        </div>
      )}
    </form>
  );
}
