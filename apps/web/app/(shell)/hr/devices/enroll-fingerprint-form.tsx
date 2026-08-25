"use client";

import { useActionState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Field, inputClass } from "@/modules/hr/components/ui";
import { requestEnrollmentAction, type EnrollState } from "../actions";

const EMPTY: EnrollState = {};

/** นิ้วที่ใช้บ่อย — เก็บเป็นข้อความอิสระฝั่ง API (สูงสุด 30 ตัวอักษร) */
const FINGERS = [
  ["RIGHT_THUMB", "นิ้วโป้งขวา"],
  ["RIGHT_INDEX", "นิ้วชี้ขวา"],
  ["RIGHT_MIDDLE", "นิ้วกลางขวา"],
  ["LEFT_THUMB", "นิ้วโป้งซ้าย"],
  ["LEFT_INDEX", "นิ้วชี้ซ้าย"],
  ["LEFT_MIDDLE", "นิ้วกลางซ้าย"],
] as const;

export interface EnrollOption {
  id: string;
  label: string;
}

export function EnrollFingerprintForm({
  employments,
  devices,
  nextSlot,
}: {
  employments: EnrollOption[];
  devices: EnrollOption[];
  nextSlot: number;
}) {
  const [state, formAction, pending] = useActionState(requestEnrollmentAction, EMPTY);

  if (devices.length === 0) {
    return (
      <p className="text-sm text-(--ink-soft)">
        ยังไม่มีเครื่องที่ผูกกุญแจแล้ว — ต้องออกโทเคนแล้วผูกเครื่องให้สำเร็จก่อน
        จึงจะสั่งลงทะเบียนลายนิ้วมือได้
      </p>
    );
  }

  return (
    <>
      <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
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

        <Field label="เครื่องสแกน *">
          <select name="device_id" required defaultValue={devices[0]?.id} className={inputClass}>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Slot *" hint="ช่องเก็บในเซ็นเซอร์">
          <input
            name="template_slot"
            type="number"
            required
            min={0}
            max={65535}
            defaultValue={nextSlot}
            className={`${inputClass} font-mono`}
          />
        </Field>

        <Field label="นิ้ว">
          <select name="finger_position" defaultValue="RIGHT_THUMB" className={inputClass}>
            {FINGERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex items-end">
          <Button type="submit" disabled={pending}>
            {pending ? "กำลังสั่ง…" : "สั่งลงทะเบียน"}
          </Button>
        </div>
      </form>

      {state.error && <p className="mt-2 text-sm text-(--danger)">{state.error}</p>}

      {state.ok && (
        <div className="mt-3 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3 text-sm">
          <p className="font-medium">ส่งคำสั่งไปที่เครื่องแล้ว — slot {state.slot}</p>
          <p className="mt-1 text-(--ink-soft)">
            เดินไปที่เครื่องภายใน <strong>10 นาที</strong> จอจะขึ้น
            &ldquo;Place finger&rdquo; ให้วางนิ้ว <strong>2 ครั้ง</strong>
            {" "}แล้วสถานะในตารางข้างล่างจะเปลี่ยนจาก &ldquo;รอวางนิ้ว&rdquo; เป็น
            &ldquo;ใช้งานได้&rdquo; (กด refresh หน้าเพื่อดูสถานะล่าสุด)
          </p>
          <p className="mt-1 text-(--ink-soft)">
            ถ้าไม่ไปวางนิ้ว คำสั่งจะหมดอายุและต้องสั่งใหม่ — การสแกนจะยังไม่ผูกกับใคร
          </p>
        </div>
      )}
    </>
  );
}
