"use client";

import { useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { SectionCard, inputClass } from "@/modules/hr/components/ui";
import { holidayValidMonths, holidayYearCarry, yearCarryOptionLabel } from "@/modules/hr/lib/holiday-valid-months";

/**
 * รูปแบบวันหยุด Holiday ของบริษัท — เลือกได้สองแบบ
 *
 *   หยุดตามวัน  = ทุกคนหยุดตรงวันหยุดบริษัท ไม่ต้องลงเอง (ระบบลงเวลานับวันนั้นเป็นวันหยุดให้)
 *   เลือกวันเอง = วันหยุดบริษัทของแต่ละเดือนกลายเป็นสิทธิ์ ให้พนักงานเลือกวันหยุดเอง ใช้ได้ภายใน N เดือน
 *                (N ตั้งได้ 1–12 ค่าเดิม 3 — ผู้ใช้ 19/11/2569 ให้ HR/Boss เลือกเอง)
 *                วันหยุดบริษัทเองเป็นวันทำงานปกติ (ไม่งั้นได้หยุดซ้ำสองต่อ)
 *
 * แบบหลังต้องบอกว่าประเภทการลาตัวไหนคือ Holiday — currentId = ตัวที่ใช้อยู่ (null = หยุดตามวัน)
 */
export function HolidayModeForm({
  action,
  types,
  currentId,
  startsLabel,
  validMonths,
  validMonthsAction,
  yearCarryMonths,
}: {
  action: (formData: FormData) => void | Promise<void>;
  types: { id: string; name: string }[];
  currentId: string | null;
  /** เดือนที่เริ่มนับสิทธิ์ของตัวที่ใช้อยู่ (เช่น "ตุลาคม 2569") — ก่อนหน้านี้ไม่นับย้อนหลัง */
  startsLabel: string | null;
  /** สิทธิ์ของแต่ละเดือนใช้ได้กี่เดือน (ของตัวที่ใช้อยู่) */
  validMonths?: number;
  validMonthsAction?: (formData: FormData) => void | Promise<void>;
  /** ตัดตามรอบปี (0 = สิ้น ธ.ค. ปีนั้น · 1 = สิ้น ม.ค. ปีถัดไป …) · null = ไม่ตัด */
  yearCarryMonths?: number | null;
}) {
  const months = holidayValidMonths(validMonths);
  const [mode, setMode] = useState<"fixed" | "floating">(currentId ? "floating" : "fixed");
  // เดาตัวเลือกแรกจากชื่อ — ส่วนใหญ่ตั้งชื่อประเภทว่า Holiday อยู่แล้ว
  const guess = types.find((t) => /holiday|ฮอลิเดย์|นักขัตฤกษ์/i.test(t.name))?.id ?? types[0]?.id ?? "";
  const optionClass = (on: boolean) =>
    `flex cursor-pointer items-start gap-2 rounded-(--radius) border px-3 py-2 ${on ? "border-(--app-strong) bg-(--bg-soft)" : "border-(--line)"}`;

  return (
    <SectionCard
      title="รูปแบบวันหยุด Holiday"
      description="วันหยุดบริษัท (นักขัตฤกษ์) ให้พนักงานหยุดแบบไหน — เปลี่ยนได้ทุกเมื่อ ใบที่ลงไว้แล้วไม่หาย"
    >
      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="current_id" value={currentId ?? ""} />
        <label className={optionClass(mode === "fixed")}>
          <input
            type="radio"
            name="mode"
            value="fixed"
            checked={mode === "fixed"}
            onChange={() => setMode("fixed")}
            className="mt-0.5 h-4 w-4"
          />
          <span className="text-sm">
            <span className="font-semibold text-(--ink)">หยุดตามวัน</span>
            <span className="block text-xs text-(--ink-soft)">
              ทุกคนหยุดตรงวันหยุดบริษัท ไม่ต้องลงเอง — มาทำงานวันนั้นขึ้นเป็น OT รอหัวหน้าอนุมัติ
            </span>
          </span>
        </label>
        <label className={optionClass(mode === "floating")}>
          <input
            type="radio"
            name="mode"
            value="floating"
            checked={mode === "floating"}
            onChange={() => setMode("floating")}
            className="mt-0.5 h-4 w-4"
          />
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-semibold text-(--ink)">สะสม เลือกวันหยุดเอง</span>
            <span className="block text-xs text-(--ink-soft)">
              เดือนไหนมีวันหยุดบริษัทกี่วัน ได้สิทธิ์เท่านั้นวัน เลือกหยุดวันไหนก็ได้ ใช้ได้ภายใน {months} เดือน เกินนั้นตัดทิ้ง
              — วันหยุดบริษัทเองเป็นวันทำงานปกติ
            </span>
            {mode === "floating" && (
              <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-(--ink)">
                ใช้ประเภทการลา
                <select
                  name="leave_type_id"
                  defaultValue={currentId ?? guess}
                  className={`${inputClass} h-8 w-auto text-xs`}
                  aria-label="ประเภทการลาที่ใช้เป็น Holiday"
                >
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                เป็น Holiday
              </span>
            )}
            <span className="mt-1 block text-xs text-(--ink-soft)">
              {startsLabel
                ? `เริ่มนับสิทธิ์ตั้งแต่ ${startsLabel} — วันหยุดและใบที่ลงไว้ก่อนหน้านั้นไม่นำมาคิด`
                : "เริ่มนับสิทธิ์ตั้งแต่เดือนที่กดบันทึก ไม่นับย้อนหลัง"}
            </span>
          </span>
        </label>
        <div>
          <Button type="submit" size="sm">
            บันทึกรูปแบบ
          </Button>
        </div>
      </form>
      {/* ตั้งได้เมื่อใช้แบบสะสมอยู่แล้ว (มีประเภทที่เป็น Holiday) — ฟอร์มแยก ไม่ปนกับการเปลี่ยนรูปแบบ */}
      {currentId && validMonthsAction && (
        <HolidayExpirySettings action={validMonthsAction} leaveTypeId={currentId} months={months} yearCarry={holidayYearCarry(yearCarryMonths)} />
      )}
    </SectionCard>
  );
}

const TH_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** สิทธิ์ของเดือน (index 0–11 ของปี be) หมดเมื่อไร — "ส.ค. 2570" + ถูกตัดตามรอบปีไหม (สูตรเดียวกับระบบบุคคล holiday-accrual.ts) */
function expiryLabel(monthIdx: number, be: number, months: number, carry: number | null): { text: string; cut: boolean } {
  const start = be * 12 + monthIdx;
  const byMonths = start + months - 1;
  const byYear = carry === null ? Infinity : be * 12 + 11 + carry;
  const end = Math.min(byMonths, byYear);
  return { text: `${TH_SHORT[end % 12]} ${Math.floor(end / 12)}`, cut: byYear < byMonths };
}

/**
 * อายุของสิทธิ์ Holiday — 2 ค่าในฟอร์มเดียว (ผู้ใช้ 19/11/2569)
 *   1) ใช้ได้กี่เดือนนับรวมเดือนที่ได้  2) ตัดตามรอบปี: ของปีนี้ใช้ข้ามปีได้ถึงเดือนไหน
 * ตัวอย่างใต้ช่องเปลี่ยนตามที่เลือกทันที (ยังไม่บันทึก) ให้ HR เห็นผลก่อนกดบันทึก
 */
function HolidayExpirySettings({
  action,
  leaveTypeId,
  months: savedMonths,
  yearCarry: savedCarry,
}: {
  action: (formData: FormData) => void | Promise<void>;
  leaveTypeId: string;
  months: number;
  yearCarry: number | null;
}) {
  const [months, setMonths] = useState(savedMonths);
  const [carry, setCarry] = useState<number | null>(savedCarry);
  const be = new Date().getFullYear() + 543;
  const jul = expiryLabel(6, be, months, carry);
  const nov = expiryLabel(10, be, months, carry);
  const dec = expiryLabel(11, be, months, carry);
  const changed = months !== savedMonths || carry !== savedCarry;
  return (
    <form action={action} className="mt-3 flex flex-col gap-2 border-t border-(--line) pt-3" data-testid="holiday-valid-months">
      <input type="hidden" name="leave_type_id" value={leaveTypeId} />
      <p className="text-sm font-semibold text-(--ink)">อายุของสิทธิ์ Holiday</p>
      <label className="flex flex-wrap items-center gap-2 text-sm text-(--ink)">
        สิทธิ์ของแต่ละเดือนใช้ได้
        <span className="w-28 shrink-0">
          <select name="months" value={String(months)} onChange={(e) => setMonths(Number(e.target.value))} className={`${inputClass} h-9 text-sm`} aria-label="สิทธิ์ Holiday ใช้ได้กี่เดือน">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} เดือน
              </option>
            ))}
          </select>
        </span>
        นับรวมเดือนที่ได้
      </label>
      <label className="flex flex-wrap items-center gap-2 text-sm text-(--ink)">
        สิทธิ์ของแต่ละปีใช้ได้ไม่เกิน
        <span className="w-64 max-w-full shrink-0">
          <select
            name="year_carry_months"
            value={carry === null ? "" : String(carry)}
            onChange={(e) => setCarry(e.target.value === "" ? null : Number(e.target.value))}
            className={`${inputClass} h-9 text-sm`}
            aria-label="ตัดสิทธิ์ Holiday ตามรอบปี"
          >
            <option value="">ไม่ตัดตามปี (ข้ามปีได้ตามจำนวนเดือน)</option>
            {Array.from({ length: 12 }, (_, i) => i).map((n) => (
              <option key={n} value={n}>
                {yearCarryOptionLabel(n)}
              </option>
            ))}
          </select>
        </span>
      </label>
      <div className="rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-xs text-(--ink)" aria-live="polite">
        <p className="font-semibold">ตัวอย่างตามที่เลือก{changed ? " (ยังไม่บันทึก)" : ""}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>
            ของ ก.ค. {be} ใช้ได้ถึงสิ้น {jul.text}
            {jul.cut ? " (ตัดตามรอบปี)" : ""}
          </li>
          <li>
            ของ พ.ย. {be} ใช้ได้ถึงสิ้น {nov.text}
            {nov.cut ? " (ตัดตามรอบปี)" : ""}
          </li>
          <li>
            ของ ธ.ค. {be} ใช้ได้ถึงสิ้น {dec.text}
            {dec.cut ? " (ตัดตามรอบปี)" : ""}
          </li>
        </ul>
        <p className="mt-1 text-(--ink-soft)">
          หมดอายุตามอันที่ถึงก่อน · พนักงานเห็นวันหมดอายุของแต่ละเดือนในการ์ดวันหยุดของตัวเอง · เปลี่ยนแล้วยอดของทุกคนคิดใหม่ทันที
        </p>
      </div>
      <div>
        <Button type="submit" size="sm" variant="outline">
          บันทึกอายุสิทธิ์
        </Button>
      </div>
    </form>
  );
}
