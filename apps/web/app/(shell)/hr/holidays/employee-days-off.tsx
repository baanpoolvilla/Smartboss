"use client";

import { useActionState, useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { setEmployeeDaysOffAction, type DaysOffState } from "../actions";
import type { DayOffQuotaSource } from "@/lib/day-off-quota";

const EMPTY: DaysOffState = {};
const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

export interface ShiftChoice {
  id: string;
  label: string;
}

/**
 * ปฏิทินคลิกเลือกวันหยุดรายคน
 *
 * ใช้ checkbox จริงซ่อนไว้แล้วจัดสไตล์ที่ label — ไม่ต้องเก็บค่าที่ติ๊กไว้ใน
 * React ฟอร์มจึงส่งค่าถูกต้องแม้ JS ยังโหลดไม่เสร็จ และไม่มีทางที่จอกับค่าที่ส่ง
 * จะไม่ตรงกัน (state ที่มีเก็บแค่ "ติ๊กไปกี่วันแล้ว" ไว้โชว์ตัวนับ ไม่ใช่ตัวค่า)
 */
export function EmployeeDaysOff({
  companyId,
  employmentId,
  month,
  initialOff,
  workShifts,
  restShiftId,
  /** หยุดได้กี่วันในเดือนนี้ — ตรวจซ้ำฝั่งเซิร์ฟเวอร์อีกชั้นเสมอ */
  quota,
  /** โควตาที่ใช้จริงมาจากชั้นไหน — เฉพาะเดือนนี้ / ค่าประจำของคนนี้ / ค่าบริษัท */
  quotaSource,
  /** กะที่ผูกไว้กับคนนี้ — วันที่ไม่ได้หยุดต้องใช้กะเดียวกับที่ผูกไว้ ไม่ใช่ให้เลือกซ้ำ */
  boundShiftId,
}: {
  companyId: string;
  employmentId: string;
  month: string;
  initialOff: string[];
  workShifts: ShiftChoice[];
  restShiftId: string | null;
  quota: number;
  quotaSource: DayOffQuotaSource;
  boundShiftId: string | null;
}) {
  const [state, formAction, pending] = useActionState(setEmployeeDaysOffAction, EMPTY);
  const [picked, setPicked] = useState(initialOff.length);

  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year!, mon!, 0)).getUTCDate();
  const leading = new Date(Date.UTC(year!, mon! - 1, 1)).getUTCDay();
  const offSet = new Set(initialOff);
  const over = picked > quota;
  const bound = workShifts.find((s) => s.id === boundShiftId);

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

      {/*
        ตัวนับต้องอยู่เหนือปฏิทิน ไม่ใช่ใต้ปุ่ม — คนตัดสินใจว่าจะติ๊กวันไหนต่อ
        ตอนที่สายตาอยู่บนปฏิทิน ถ้าตัวเลขอยู่ใต้ปุ่มก็รู้ว่าเกินตอนกดไปแล้ว
      */}
      <p
        className="rounded-(--radius) border p-2.5 text-sm"
        style={{
          borderColor: over ? "var(--danger)" : "var(--line)",
          backgroundColor: "var(--bg-soft)",
          color: over ? "var(--danger)" : "var(--ink)",
        }}
      >
        เลือกไว้ <strong>{picked}</strong> วัน จากโควตา <strong>{quota}</strong> วัน/เดือน
        <span className="ml-1 text-(--ink-soft)">
          ({quotaSource === "month"
            ? "ตั้งไว้เฉพาะเดือนนี้"
            : quotaSource === "employee"
              ? "ค่าประจำของคนนี้"
              : "ค่าตั้งต้นของบริษัท"})
        </span>
        {over && <span className="ml-1 font-medium">— เกินโควตา บันทึกไม่ได้</span>}
      </p>

      {/*
        คนที่ผูกกะไว้แล้วไม่ต้องตอบซ้ำว่าวันทำงานใช้กะอะไร — ถ้าให้เลือกได้อีกที่
        แล้วเลือกไม่ตรงกับที่ผูกไว้ ทั้งเดือนจะถูกเขียนทับด้วยกะที่ไม่ได้ตั้งใจ
        โดยไม่มีอะไรเตือน (roster ทับ pattern เสมอ)
      */}
      {bound === undefined ? (
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
      ) : (
        <>
          <input type="hidden" name="work_shift_id" value={bound.id} />
          <p className="text-xs text-(--ink-soft)">
            วันที่ไม่ได้หยุดใช้กะที่ผูกไว้: <strong>{bound.label}</strong>
          </p>
        </>
      )}

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
          /*
           * label ต้อง relative — เป็น grid item ตรง ๆ ของ grid-cols-7 ข้างบน
           * ถ้าไม่ตั้ง position ตัว checkbox ที่ sr-only (position: absolute)
           * ข้างในจะหาตำแหน่งอิงจาก ancestor ที่ positioned ตัวถัดไป (เช่น AppBar
           * ที่ sticky) แทนที่จะอิงจาก label ของตัวเอง ⇒ พิกัดเพี้ยนไปไกลมาก
           * แล้วพอคลิก label ทำให้ input โฟกัส เบราว์เซอร์ scrollIntoView ไปหา
           * พิกัดที่เพี้ยนนั้น หน้าเลยกระโดดไปพื้นที่ว่างเปล่าให้เห็น (เจอจริงตอน
           * ทดสอบ — คลิกวันที่ในปฏิทินแล้วจอเลื่อนลงไปที่ว่าง)
           */
          return (
            <label key={date} className="relative cursor-pointer">
              <input
                type="checkbox"
                name="off"
                value={date}
                defaultChecked={offSet.has(date)}
                onChange={(e) => setPicked((n) => n + (e.target.checked ? 1 : -1))}
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
        <Button type="submit" disabled={pending || over} className="sm:w-52">
          {pending ? "กำลังบันทึก…" : "บันทึกวันหยุดของเดือนนี้"}
        </Button>
      </div>

      {state.error && <p className="text-sm text-(--danger)">{state.error}</p>}
      {state.ok && (
        <div className="rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3 text-sm">
          <p className="font-medium">
            บันทึกแล้ว — หยุด {state.offDays} วันในเดือนนี้
            {state.quota !== undefined && ` (โควตา ${state.quota} วัน)`}
          </p>
          <p className="mt-1 text-(--ink-soft)">
            ตารางนี้ทับตารางประจำสัปดาห์เฉพาะเดือนที่บันทึก
            และไปสั่งคำนวณใหม่ที่หน้า “ผลลงเวลา” เพื่อให้ผลที่คำนวณไปแล้วใช้เกณฑ์ใหม่
          </p>
        </div>
      )}
    </form>
  );
}
