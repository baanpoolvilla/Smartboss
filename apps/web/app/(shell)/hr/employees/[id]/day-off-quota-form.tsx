"use client";

import { useActionState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Field, inputClass } from "@/modules/hr/components/ui";
import { setDayOffQuotaAction, type QuotaState } from "../../actions";
import type { DayOffQuotaSource } from "@/lib/day-off-quota";

const EMPTY: QuotaState = {};

/**
 * วันหยุดตามสิทธิ์ของคนนี้ในเดือนที่กำลังดู — หนึ่งฟอร์มต่อหนึ่งประเภทวันหยุด (Day-Off, หยุดชดเชย ฯลฯ)
 *
 * เดือนที่ไม่ได้มาแก้ = วัน/เดือน ของประเภทนั้น (ตั้งที่ ตั้งค่า › ประเภทการลา) · มาแก้เดือนไหนก็มีผลแค่เดือนนั้น
 * ช่องเดียว ใส่จำนวนวันที่ได้ตรง ๆ (เดือนนี้ให้ 7 ก็ใส่ 7 · ให้ 4 ก็ใส่ 4)
 *
 * เดิมมีสองช่อง "ค่าประจำทุกเดือน" กับ "ทับเฉพาะเดือน" และเป็นเลขเดียวของทุกประเภท — ค่าประจำย้อนไปมีผลกับ
 * เดือนเก่าด้วย และบริษัทที่มีวันหยุดตามสิทธิ์สองประเภทตั้งแยกกันไม่ได้ ("เอาเป็นเดือน ๆ ไป" /
 * "วันหยุดรูปแบบนี้คนนี้ได้กี่วัน") จึงเหลือช่องรายเดือนช่องเดียวต่อประเภท
 */
export function DayOffQuotaForm({
  employmentId,
  month,
  leaveTypeId,
  typeName,
  days,
  source,
  typeDefault,
  used,
  note,
}: {
  employmentId: string;
  /** "YYYY-MM" — เดือนที่การ์ดนี้กำลังตั้งค่าอยู่ */
  month: string;
  leaveTypeId: string;
  typeName: string;
  /** จำนวนวันที่ใช้จริงของเดือนนี้ */
  days: number;
  source: DayOffQuotaSource;
  /** วัน/เดือน ของประเภท · 0 = ไม่จำกัด */
  typeDefault: number;
  /** ลงไว้แล้วกี่วันในเดือนนี้ (รวมที่พนักงานลงเอง) */
  used: number;
  note: string;
}) {
  const [state, formAction, pending] = useActionState(setDayOffQuotaAction, EMPTY);
  const edited = source !== "type";
  const unlimited = !edited && typeDefault === 0;
  const defaultLabel = typeDefault === 0 ? "ไม่จำกัด" : `${typeDefault} วัน`;

  return (
    <form
      action={formAction}
      data-save-toast="off"
      // key = ค่าปัจจุบันของเดือน — บันทึก/ล้างแล้วช่องต้องกลับมาแสดงค่าจริงล่าสุด ไม่ค้างค่าที่พิมพ์ไว้
      key={`${month}:${source}:${days}`}
      className="flex flex-col gap-3 rounded-(--radius) border border-(--line) p-3"
    >
      <input type="hidden" name="employment_id" value={employmentId} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="leave_type_id" value={leaveTypeId} />
      <input type="hidden" name="scope" value="month" />
      <p className="text-sm">
        <strong>{typeName}</strong>{" "}
        <span className="text-(--ink-soft)">
          · ลงไว้แล้ว {used} วัน{unlimited ? "" : ` จาก ${days} วัน`}
        </span>
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label={`${typeName} ของเดือน ${month} (วัน)`}
          hint={
            source === "month"
              ? `แก้ไว้เฉพาะเดือนนี้ · เดือนที่ไม่ได้แก้ได้ ${defaultLabel}`
              : source === "legacy"
                ? `ค่าที่ตั้งไว้เดิมของคนนี้ · ค่าของประเภทคือ ${defaultLabel}`
                : `ยังไม่ได้แก้ของเดือนนี้ — ใช้ค่าของประเภท (${defaultLabel}) · แก้แล้วมีผลแค่เดือนนี้`
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
            defaultValue={unlimited ? "" : String(days)}
            placeholder={unlimited ? "ไม่จำกัด" : undefined}
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
        {edited && (
          <Button type="submit" name="reset" value="1" formNoValidate variant="outline" disabled={pending}>
            กลับไปใช้ค่าของประเภท ({defaultLabel})
          </Button>
        )}
      </div>
      {state.error && <p className="text-sm text-(--danger)">{state.error}</p>}
      {state.ok && (
        <p className="text-sm text-(--ink-soft)">
          {state.cleared
            ? `ล้างของเดือนนี้แล้ว — กลับไปใช้ค่าของประเภท (${defaultLabel})`
            : `บันทึกแล้ว — เดือนนี้คนนี้ได้ ${typeName} ${state.daysPerMonth} วัน`}
        </p>
      )}
    </form>
  );
}

/** คนที่เคยตั้ง "ค่าประจำ" ไว้ในระบบเดิม — ค่านั้นยังใช้กับเดือนที่ไม่ได้แก้อยู่ จนกว่าจะล้าง */
export function LegacyStandingNotice({ employmentId, standing }: { employmentId: string; standing: number }) {
  const [state, formAction, pending] = useActionState(setDayOffQuotaAction, EMPTY);
  return (
    <form action={formAction} data-save-toast="off" className="flex flex-wrap items-center gap-2 text-xs text-(--ink-soft)">
      <input type="hidden" name="employment_id" value={employmentId} />
      <input type="hidden" name="scope" value="standing" />
      <span>
        คนนี้เคยตั้งค่าประจำไว้ {standing} วัน/เดือน — เดือนที่ไม่ได้แก้จึงได้ {standing} วัน ไม่ใช่ค่าของประเภท
      </span>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        ล้างค่าประจำเดิม
      </Button>
      {state.error && <span className="text-(--danger)">{state.error}</span>}
    </form>
  );
}
