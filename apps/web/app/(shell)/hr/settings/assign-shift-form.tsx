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

type DayField = (typeof DAYS)[number][0];

export interface ShiftOption {
  id: string;
  label: string;
  restDay: boolean;
}

export interface PersonOption {
  id: string;
  label: string;
}

/** ตารางที่ผูกไว้จริงในระบบ — วันไหนไม่ได้ผูกกะเป็น `null` */
export interface CurrentPattern {
  effectiveFrom: string;
  effectiveTo: string | null;
  days: Record<DayField, string | null>;
}

/**
 * ผูกกะให้พนักงานหนึ่งคน
 *
 * คำถามที่คนตั้งค่าถามจริง ๆ คือ "คนนี้เข้างานกี่โมง" — คนหนึ่งเข้า 08:00-17:00
 * อีกคนเข้า 07:30-16:30 ⇒ เลือกกะครั้งเดียวจบ ไม่ใช่ไล่เลือกทีละวันเจ็ดช่อง
 * ซึ่งบังคับให้ตอบคำถามเดิมซ้ำเจ็ดรอบเพื่อได้คำตอบเดียวกันทั้งเจ็ดครั้ง
 *
 * กะคือ "เวลาทำงาน" อย่างเดียว ที่นี่จึงไม่มีให้เลือกว่าวันไหนหยุด — วันหยุด
 * ลงที่ปฏิทินรายเดือนในการ์ด "วันหยุดของคนนี้" ซึ่งคุมด้วยโควตา (4/6 วัน)
 * และทับตารางประจำสัปดาห์อยู่แล้ว ถามสองที่เท่ากับให้ตอบเรื่องเดียวกันสองแบบ
 * แล้วต้องมาเดาว่าอันไหนชนะเมื่อสองอันไม่ตรงกัน
 */
export function AssignShiftForm({
  employments,
  shifts,
  today,
  /** ตั้งค่าเมื่ออยู่ในหน้าของพนักงานคนเดียว — ซ่อนช่องเลือกคนทิ้ง */
  lockedTo,
  /** ตารางที่ผูกไว้อยู่ของคนนี้ — `null` = ยังไม่เคยผูก, `undefined` = อ่านไม่ได้ */
  current,
}: {
  employments: PersonOption[];
  shifts: ShiftOption[];
  today: string;
  lockedTo?: string;
  current?: CurrentPattern | null;
}) {
  const [state, formAction, pending] = useActionState(setRecurringPatternAction, EMPTY);

  const restShiftId = shifts.find((s) => s.restDay)?.id ?? "";
  const workShifts = shifts.filter((s) => !s.restDay);

  if (workShifts.length === 0) {
    return (
      <p className="text-sm text-(--ink-soft)">
        ยังไม่มีกะทำงานในระบบ — สร้างที่
        <Link href="/hr/settings" className="mx-1 text-(--app-strong) hover:underline">
          หน้าตั้งค่า HR
        </Link>
        ก่อน (เช่น “กะเช้า 08:00-17:00”) จึงจะผูกกะให้พนักงานได้
      </p>
    );
  }
  if (lockedTo === undefined && employments.length === 0) {
    return <p className="text-sm text-(--ink-soft)">ยังไม่มีพนักงานในระบบ</p>;
  }

  /*
   * ตารางเดิมอาจตั้งกะไว้คนละใบในแต่ละวัน (ของที่ผูกไว้ก่อนหน้านี้ หรือคนที่
   * เข้ากะเช้าสลับกะบ่าย) — ฟอร์มนี้เลือกได้กะเดียว จึงต้องรู้ว่ากำลังจะทำให้
   * ของเดิมง่ายลงหรือเปล่า แล้วบอกออกมาก่อนกด ไม่ใช่ให้รู้ตอนตารางเปลี่ยนไปแล้ว
   */
  const currentWorkShiftIds =
    current == null
      ? []
      : [
          ...new Set(
            DAYS.map(([field]) => current.days[field]).filter(
              (id): id is string => id !== null && id !== restShiftId,
            ),
          ),
        ];
  const mixed = currentWorkShiftIds.length > 1;

  const defaultWorkShift = currentWorkShiftIds[0] ?? workShifts[0]?.id ?? "";
  /** วันที่ตารางปัจจุบันไม่ได้ให้ทำงาน — กะวันหยุด หรือไม่ได้ผูกกะไว้เลย */
  const restDays = new Set<DayField>(
    current == null
      ? []
      : DAYS.map(([field]) => field).filter((field) => {
          const id = current.days[field];
          return id === null || id === restShiftId;
        }),
  );

  const labelOf = (shiftId: string): string =>
    shifts.find((s) => s.id === shiftId)?.label ?? "กะที่ถูกลบไปแล้ว";

  return (
    <>
      {/*
        เห็นของจริงก่อนแก้ — ช่องเลือกด้านล่างบอกไม่ได้ว่าอันไหนคือของที่ผูกไว้อยู่
        กับอันไหนคือค่าที่ระบบเดาให้
      */}
      {current === undefined ? (
        <p className="mb-3 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-2.5 text-xs text-(--ink-soft)">
          อ่านตารางที่ผูกไว้ไม่ได้ (ระบบบุคคลไม่ตอบ) — ช่องข้างล่างเป็นค่าตั้งต้นที่แนะนำ
          ถ้ากดบันทึกจะทับของเดิม
        </p>
      ) : current === null ? (
        <p className="mb-3 rounded-(--radius) border border-(--danger) bg-(--bg-soft) p-2.5 text-sm">
          <strong>ยังไม่เคยผูกกะ</strong> — ระบบยังไม่รู้ว่าคนนี้ควรเข้ากี่โมง
          จึงคิดสาย/ขาด/OT ให้ไม่ได้ เลือกกะข้างล่างแล้วกดผูกกะ
        </p>
      ) : (
        <div className="mb-4 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3">
          <p className="text-sm">
            ตอนนี้เข้ากะ{" "}
            <strong>
              {mixed
                ? currentWorkShiftIds.map(labelOf).join(" / ")
                : currentWorkShiftIds[0] !== undefined
                  ? labelOf(currentWorkShiftIds[0])
                  : "— ไม่มีวันทำงานเลย —"}
            </strong>
            <span className="ml-2 text-(--ink-soft)">
              เริ่ม {current.effectiveFrom}
              {current.effectiveTo === null ? "" : ` ถึง ${current.effectiveTo}`}
            </span>
          </p>
          {restDays.size > 0 && (
            <p className="mt-1 text-xs text-(--ink-soft)">
              ตารางเดิมตั้งให้หยุดประจำทุก{" "}
              {DAYS.filter(([field]) => restDays.has(field))
                .map(([, label]) => label)
                .join(" · ")}{" "}
              — บันทึกใหม่แล้ววันพวกนี้จะกลายเป็นวันทำงาน แล้วไปลงวันหยุดจริงที่ปฏิทินข้างล่าง
            </p>
          )}
          {mixed && (
            <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
              ตารางเดิมตั้งกะไม่เหมือนกันในแต่ละวัน — ถ้ากดบันทึกข้างล่าง
              ทุกวันทำงานจะเปลี่ยนเป็นกะเดียวกันหมดตามที่เลือก
            </p>
          )}
        </div>
      )}

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

          <Field label="คนนี้เข้ากะไหน *" hint="เวลาทำงานของคนนี้ · วันหยุดลงที่ปฏิทินข้างล่าง">
            <select
              name="work_shift_id"
              required
              defaultValue={defaultWorkShift}
              className={inputClass}
            >
              {workShifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
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

        {/*
          ลิสต์ในช่องมีเท่าที่บริษัทสร้างกะไว้ — บริษัทที่มีกะเดียวจะเห็นตัวเลือกเดียว
          แล้วเข้าใจว่าจอเสีย บอกจำนวนกะที่มีจริงพร้อมทางไปเพิ่ม จะได้รู้ว่าไม่ใช่ระบบพัง
        */}
        <p className="text-xs text-(--ink-soft)">
          ตอนนี้มีกะทำงานให้เลือก {workShifts.length} กะ — คนที่เข้างานเวลาอื่น
          (เช่น 07:30-16:30) ต้อง
          <Link href="/hr/settings" className="mx-1 text-(--app-strong) hover:underline">
            สร้างกะนั้นที่หน้าตั้งค่า HR
          </Link>
          ก่อน แล้วกลับมาเลือกที่นี่
        </p>

        <div>
          {/* คำเดียวกับที่หน้าลงเวลาใช้ ("ยังไม่ผูกกะ") ไม่ใช่ "บันทึกตาราง"
              ซึ่งไม่มีใครเดาได้ว่าคือปุ่มผูกกะ */}
          <Button type="submit" disabled={pending} className="sm:w-56">
            {pending ? "กำลังผูกกะ…" : current ? "บันทึกกะใหม่" : "ผูกกะให้คนนี้"}
          </Button>
        </div>
      </form>

      {state.error && <p className="mt-2 text-sm text-(--danger)">{state.error}</p>}

      {state.ok && (
        <div className="mt-3 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3 text-sm">
          <p className="font-medium">ผูกกะเรียบร้อยแล้ว</p>
          <p className="mt-1 text-(--ink-soft)">
            ตารางเดิมของคนนี้ถูกปิดให้อัตโนมัติ ระบบจะใช้กะใหม่คิดสาย/ขาด/OT
            ตั้งแต่วันที่ระบุเป็นต้นไป — ผลลงเวลาที่คำนวณไปแล้วต้องสั่งคำนวณใหม่ที่หน้า
            &ldquo;ผลลงเวลา&rdquo; ถ้าอยากให้ย้อนไปใช้เกณฑ์ใหม่
          </p>
        </div>
      )}
    </>
  );
}
