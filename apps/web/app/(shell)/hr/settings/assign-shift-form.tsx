"use client";

import Link from "next/link";
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
  /** ตั้งค่าเมื่ออยู่ในหน้าของพนักงานคนเดียว — ซ่อนช่องเลือกคนทิ้ง */
  lockedTo,
}: {
  employments: PersonOption[];
  shifts: ShiftOption[];
  today: string;
  lockedTo?: string;
}) {
  const [state, formAction, pending] = useActionState(setRecurringPatternAction, EMPTY);

  if (shifts.length === 0) {
    return (
      <p className="text-sm text-(--ink-soft)">
        ยังไม่มีกะทำงานในระบบ — สร้างที่
        <Link href="/hr/settings" className="mx-1 text-(--app-strong) hover:underline">
          หน้าตั้งค่า HR
        </Link>
        ก่อนจึงจะผูกตารางได้
      </p>
    );
  }
  if (lockedTo === undefined && employments.length === 0) {
    return <p className="text-sm text-(--ink-soft)">ยังไม่มีพนักงานในระบบ</p>;
  }

  // วันทำงานตั้งต้นให้กะแรกที่ไม่ใช่วันหยุด — ส่วนเสาร์-อาทิตย์ปล่อยว่าง
  const defaultWorkShift = shifts.find((s) => !s.restDay)?.id ?? "";

  return (
    <>
      <form action={formAction} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {lockedTo === undefined ? (
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
          ) : (
            <input type="hidden" name="employment_id" value={lockedTo} />
          )}
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

        {/*
          สูงสุด 4 คอลัมน์ ไม่ใช่ 7 — เจ็ดช่องบนการ์ดกว้าง ~900px เหลือช่องละ
          ~120px ซึ่งตัดชื่อกะทิ้งตั้งแต่ "Officer 08…" อ่านไม่ออกว่าเลือกกะไหน
          เข้ากี่โมง (select ของเบราว์เซอร์ตัดข้อความตอนหุบ ไม่มีทาง ellipsis หนี)
        */}
        {/*
          ⚠ ช่องข้างล่างเป็นค่าตั้งต้น ไม่ใช่ตารางที่บันทึกไว้ — workforce API มีแค่
          POST /recurring-work-patterns ไม่มี GET จึงอ่านของเดิมกลับมาแสดงไม่ได้
          คนเปิดหน้ามาเห็นจันทร์-ศุกร์เติม "Officer" ไว้แล้วจึงนึกว่าผูกเสร็จแล้ว
          ทั้งที่หน้าลงเวลายังขึ้น "ยังไม่ผูกกะ" อยู่ — ต้องบอกออกมาตรง ๆ จนกว่า
          จะมี endpoint อ่านตารางปัจจุบัน
        */}
        <p className="rounded-(--radius) border border-(--line) bg-(--bg-soft) p-2.5 text-xs text-(--ink-soft)">
          ช่องข้างล่างเป็น<strong>ค่าตั้งต้นที่แนะนำ ไม่ใช่ตารางที่ผูกไว้อยู่</strong> —
          ระบบยังอ่านตารางเดิมกลับมาแสดงไม่ได้ ถ้าหน้า “การลงเวลา”
          ยังขึ้นว่าคนนี้ยังไม่ผูกกะ แปลว่ายังไม่เคยกดปุ่มข้างล่างนี้
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {DAYS.map(([field, label]) => (
            <Field key={field} label={label}>
              <select
                name={field}
                defaultValue={
                  field === "saturday" || field === "sunday" ? "" : defaultWorkShift
                }
                className={`${inputClass} min-w-0`}
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

        {/*
          ลิสต์ในช่องมีเท่าที่บริษัทสร้างกะไว้ — บริษัทที่มีกะเดียวจะเห็นแค่
          "— หยุด — / Officer" แล้วเข้าใจว่าจอเสีย ("ไม่เห็นมีให้เลือกกะเลย")
          บอกจำนวนกะที่มีจริงพร้อมทางไปเพิ่ม จะได้รู้ว่าไม่ใช่ระบบพัง
        */}
        <p className="text-xs text-(--ink-soft)">
          ตอนนี้มีกะให้เลือก {shifts.length} กะ ({shifts.map((s) => s.label).join(" · ")})
          — ต้องการกะอื่นเช่นกะบ่าย/กะดึก
          <Link href="/hr/settings" className="mx-1 text-(--app-strong) hover:underline">
            เพิ่มที่หน้าตั้งค่า HR
          </Link>
          แล้วกลับมาที่นี่
        </p>

        <div>
          {/* คำเดียวกับที่หน้าลงเวลาใช้ ("ยังไม่ผูกกะ") ไม่ใช่ "บันทึกตาราง"
              ซึ่งไม่มีใครเดาได้ว่าคือปุ่มผูกกะ */}
          <Button type="submit" disabled={pending} className="sm:w-56">
            {pending ? "กำลังผูกกะ…" : "ผูกกะตามตารางนี้"}
          </Button>
        </div>
      </form>

      {state.error && <p className="mt-2 text-sm text-(--danger)">{state.error}</p>}

      {state.ok && (
        <div className="mt-3 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3 text-sm">
          <p className="font-medium">ผูกกะเรียบร้อยแล้ว</p>
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
