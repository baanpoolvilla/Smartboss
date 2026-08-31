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

  /*
   * "หยุด" ต้องเป็นกะประเภทวันหยุดจริง ๆ ไม่ใช่ค่าว่าง — เดิมวันที่เลือกหยุด
   * ถูกเก็บเป็น null ซึ่ง resolveShiftId คืน shiftId=null เท่ากับ "ไม่รู้ว่าวันนั้น
   * ควรเข้ากี่โมง" ⇒ หน้าลงเวลาขึ้น "ยังไม่ผูกกะ" ทุกเสาร์-อาทิตย์ และคนที่มา
   * สแกนในวันหยุดโดนตั้ง exception NO_SHIFT_ASSIGNED ทั้งที่ผูกครบแล้ว
   */
  const restShiftId = shifts.find((s) => s.restDay)?.id ?? "";
  const workShifts = shifts.filter((s) => !s.restDay);
  const defaultWorkShift = workShifts[0]?.id ?? "";

  /** ค่าที่ควรอยู่ในช่องของวันหนึ่ง — ของที่ผูกไว้จริงมาก่อนเสมอ */
  const valueFor = (field: DayField): string => {
    if (current !== undefined && current !== null) return current.days[field] ?? "";
    return field === "saturday" || field === "sunday" ? restShiftId : defaultWorkShift;
  };

  const labelOf = (shiftId: string): string =>
    shifts.find((s) => s.id === shiftId)?.label ?? "กะที่ถูกลบไปแล้ว";

  return (
    <>
      {/*
        เห็นของจริงก่อนแก้ — ช่องเลือกด้านล่างบอกไม่ได้ว่าอันไหนคือของที่ผูกไว้อยู่
        กับอันไหนคือค่าที่ระบบเดาให้ ตารางสรุปนี้จึงเป็นตัวตอบคำถามแรกสุดของคน
        ที่เปิดหน้ามา: "ตอนนี้คนนี้เข้ากะอะไรบ้าง"
      */}
      {current === undefined ? (
        <p className="mb-3 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-2.5 text-xs text-(--ink-soft)">
          อ่านตารางที่ผูกไว้ไม่ได้ (ระบบบุคคลไม่ตอบ) — ช่องข้างล่างเป็นค่าตั้งต้นที่แนะนำ
          ถ้ากดบันทึกจะทับของเดิมทั้งสัปดาห์
        </p>
      ) : current === null ? (
        <p className="mb-3 rounded-(--radius) border border-(--danger) bg-(--bg-soft) p-2.5 text-sm">
          <strong>ยังไม่เคยผูกกะ</strong> — ระบบยังไม่รู้ว่าคนนี้ควรเข้ากี่โมง
          จึงคิดสาย/ขาด/OT ให้ไม่ได้ เลือกกะของแต่ละวันข้างล่างแล้วกดผูกกะ
        </p>
      ) : (
        <div className="mb-4">
          <p className="mb-2 text-sm font-medium text-(--ink)">
            ตารางที่ใช้อยู่ตอนนี้
            <span className="ml-2 font-normal text-(--ink-soft)">
              เริ่ม {current.effectiveFrom}
              {current.effectiveTo === null
                ? " · ยังไม่มีวันสิ้นสุด"
                : ` ถึง ${current.effectiveTo}`}
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {DAYS.map(([field, label]) => {
              const shiftId = current.days[field];
              const shift =
                shiftId === null ? undefined : shifts.find((s) => s.id === shiftId);
              const isRest = shift?.restDay ?? false;
              return (
                <div
                  key={field}
                  className="rounded-(--radius) border border-(--line) p-2"
                  style={
                    shiftId === null
                      ? { borderColor: "var(--danger)" }
                      : isRest
                        ? { backgroundColor: "var(--bg-soft)" }
                        : undefined
                  }
                >
                  <p className="text-[11px] text-(--ink-soft)">{label}</p>
                  <p
                    className="text-xs font-medium"
                    style={{ color: shiftId === null ? "var(--danger)" : "var(--ink)" }}
                  >
                    {shiftId === null ? "ยังไม่ผูก" : isRest ? "หยุด" : labelOf(shiftId)}
                  </p>
                </div>
              );
            })}
          </div>
          {Object.values(current.days).some((id) => id === null) && (
            <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
              วันที่ขึ้น “ยังไม่ผูก” ทำให้หน้าลงเวลาแจ้งว่าคนนี้ยังไม่ผูกกะเฉพาะวันนั้น —
              ถ้าตั้งใจให้เป็นวันหยุด ให้เลือก “— หยุด —” ข้างล่างแล้วกดบันทึกใหม่
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {DAYS.map(([field, label]) => (
            <Field key={field} label={label}>
              <select
                name={field}
                defaultValue={valueFor(field)}
                className={`${inputClass} min-w-0`}
              >
                {/*
                  วันที่บันทึกไว้เป็น "ไม่มีกะ" ต้องมีตัวเลือกของตัวเองในลิสต์ —
                  ไม่งั้น defaultValue="" ไม่ตรงกับ option ไหนเลย เบราว์เซอร์จะ
                  หยิบตัวแรกมาโชว์แทน ⇒ จอบอกว่าเสาร์เป็นกะ Officer ทั้งที่ในระบบ
                  ยังว่างอยู่ แล้วคนกดบันทึกโดยนึกว่าไม่ได้แก้อะไร
                */}
                {restShiftId !== "" && valueFor(field) === "" && (
                  <option value="">— ยังไม่ผูก (ค่าที่บันทึกไว้) —</option>
                )}
                {/*
                  ค่าของ "หยุด" คือกะประเภทวันหยุด ไม่ใช่ค่าว่าง — เว้นแต่บริษัท
                  ยังไม่มีกะแบบนั้น ค่อยตกกลับเป็นค่าว่างพร้อมคำเตือนใต้ฟอร์ม
                */}
                <option value={restShiftId}>— หยุด —</option>
                {workShifts.map((s) => (
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
          ตอนนี้มีกะทำงานให้เลือก {workShifts.length} กะ (
          {workShifts.map((s) => s.label).join(" · ") || "ยังไม่มี"}) —
          ต้องการกะอื่นเช่นกะบ่าย/กะดึก
          <Link href="/hr/settings" className="mx-1 text-(--app-strong) hover:underline">
            เพิ่มที่หน้าตั้งค่า HR
          </Link>
          แล้วกลับมาที่นี่
        </p>

        {restShiftId === "" && (
          <p className="text-xs" style={{ color: "var(--danger)" }}>
            ยังไม่มีกะประเภท “วันหยุด” ในระบบ — วันที่เลือก “— หยุด —”
            จะถูกบันทึกเป็นวันที่ไม่มีกะ แล้วหน้าลงเวลาจะขึ้นว่า “ยังไม่ผูกกะ” ในวันนั้น
            ถ้าอยากให้ขึ้นว่าเป็นวันหยุด ให้สร้างกะหนึ่งใบที่ติ๊ก “เป็นวันหยุด”
            (เช่นรหัส OFF) ที่หน้าตั้งค่า HR ก่อน
          </p>
        )}

        <div>
          {/* คำเดียวกับที่หน้าลงเวลาใช้ ("ยังไม่ผูกกะ") ไม่ใช่ "บันทึกตาราง"
              ซึ่งไม่มีใครเดาได้ว่าคือปุ่มผูกกะ */}
          <Button type="submit" disabled={pending} className="sm:w-56">
            {pending ? "กำลังผูกกะ…" : current ? "บันทึกตารางใหม่" : "ผูกกะตามตารางนี้"}
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
