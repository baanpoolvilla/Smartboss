"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smartboss/ui/components/button";
import { cancelLeaveForAction, setEmployeeDaysOffAction, submitLeaveAction, type DaysOffState } from "../../actions";

const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const EMPTY: DaysOffState = {};

export interface DayOffEntry {
  /** id ของใบ — ใช้ยกเลิก */
  id: string;
  date: string;
  typeName: string;
  leaveTypeId: string;
  /** true = วันหยุดตามสิทธิ์ (Day-Off) ที่นับในโควตาของเดือน · false = การลาประเภทอื่น (แสดงเฉย ๆ) */
  isDayOff: boolean;
  pending: boolean;
}

/**
 * วันหยุดตามสิทธิ์ (Day-Off) ของคนนี้ในเดือนที่ดู — ชุดเดียวกับที่พนักงานลงเองในปฏิทินทีม
 *
 * เดิมตรงนี้เป็นปฏิทินอีกระบบหนึ่ง (HR ติ๊กวันหยุดลงตารางกะ) ที่ไม่รู้จัก Day-Off เลย: พนักงานลง Day-Off
 * ไปแล้วกี่วันก็ไม่ขึ้นที่นี่ ตัวนับ "เลือกไว้ N วัน จากโควตา" จึงไม่ใช่จำนวนที่หยุดจริง และลงสองทางพร้อมกัน
 * ได้วันหยุดเกินโควตา ("ให้ดึงมาจาก day-off เอา จะได้ไม่งง ปรับที่เดียว") ⇒ ตอนนี้อ่าน/เขียนใบ Day-Off ตรง ๆ:
 * กดวันว่าง = ลง Day-Off ให้คนนี้ · กดวันที่ลงไว้ = ยกเลิก · โควตาตรวจที่เซิร์ฟเวอร์ตัวเดียวกับตอนพนักงานลงเอง
 *
 * วันหยุดแบบเดิมที่เคยลงไว้ในตารางกะยังมีผลกับการลงเวลา จึงแสดงให้เห็นและมีปุ่มล้าง ไม่หายไปเฉย ๆ
 */
export function EmployeeDayOffCalendar({
  employmentId,
  month,
  dayOffTypes,
  entries,
  legacyOff,
  legacyClear,
}: {
  employmentId: string;
  /** "YYYY-MM" */
  month: string;
  /** ประเภทวันหยุดตามสิทธิ์ที่ลงได้ — ปกติมีอันเดียว (Day-Off) · days = จำนวนของเดือนนี้ (null = ไม่จำกัด) */
  dayOffTypes: { id: string; name: string; days: number | null }[];
  entries: DayOffEntry[];
  /** วันที่เคยลงเป็นวันหยุดในตารางกะแบบเดิม */
  legacyOff: string[];
  /** ข้อมูลสำหรับล้างวันหยุดแบบเดิม · null = ล้างจากที่นี่ไม่ได้ (ยังไม่ผูกกะ/ไม่มีกะวันหยุด) */
  legacyClear: { companyId: string; restShiftId: string; workShiftId: string } | null;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [typeId, setTypeId] = useState(dayOffTypes[0]?.id ?? "");
  const [legacyState, legacyAction, legacyPending] = useActionState(setEmployeeDaysOffAction, EMPTY);

  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year!, mon!, 0)).getUTCDate();
  const leading = new Date(Date.UTC(year!, mon! - 1, 1)).getUTCDay();
  const entryOf = new Map(entries.map((e) => [e.date, e]));
  const legacySet = new Set(legacyOff);
  const usedOf = (id: string) => entries.filter((e) => e.isDayOff && e.leaveTypeId === id).length;
  const typeName = dayOffTypes.find((t) => t.id === typeId)?.name ?? "Day-Off";

  function add(date: string) {
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("employment_id", employmentId);
      form.set("leave_type_id", typeId);
      form.append("day", date);
      form.set("reason", "ฝ่ายบุคคลลงให้จากหน้าพนักงาน");
      const result = await submitLeaveAction({}, form);
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  function cancel(entry: DayOffEntry) {
    if (!window.confirm(`ยกเลิก ${entry.typeName} วันที่ ${Number(entry.date.slice(8))} ของคนนี้?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelLeaveForAction(entry.id, "ฝ่ายบุคคลยกเลิกจากหน้าพนักงาน");
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  /**
   * ย้ายวันหยุดแบบเดิม (ตารางกะ) มาเป็นวันหยุดตามสิทธิ์ในคลิกเดียว: ล้างของเดิมก่อน แล้วลงวันเดียวกันเป็น
   * ประเภทที่เลือก — HR ไม่ต้องจำวันแล้วกดลงใหม่เอง · ลงไม่ผ่านบางวัน (เช่น เกินจำนวนของเดือน) จะบอกให้เห็น
   * วันนั้นกลับเป็นวันทำงาน ไม่ค้างเป็นวันหยุดสองระบบ
   */
  function convertLegacy() {
    if (!legacyClear) return;
    setError(null);
    startTransition(async () => {
      const clear = new FormData();
      clear.set("company_id", legacyClear.companyId);
      clear.set("employment_id", employmentId);
      clear.set("month", month);
      clear.set("rest_shift_id", legacyClear.restShiftId);
      clear.set("work_shift_id", legacyClear.workShiftId);
      const cleared = await setEmployeeDaysOffAction({}, clear);
      if (cleared.error) {
        setError(cleared.error);
        return;
      }
      const form = new FormData();
      form.set("employment_id", employmentId);
      form.set("leave_type_id", typeId);
      for (const date of legacyOff) form.append("day", date);
      form.set("reason", "ย้ายจากวันหยุดแบบเดิมในตารางกะ");
      const result = await submitLeaveAction({}, form);
      if (result.error) {
        setError(`ล้างวันหยุดแบบเดิมแล้ว แต่ลงเป็น ${typeName} ไม่ได้: ${result.error}`);
      } else if ((result.days ?? 0) < legacyOff.length) {
        setError(`ย้ายได้ ${result.days ?? 0} จาก ${legacyOff.length} วัน — วันที่เหลือลงไม่ได้ (น่าจะเกินจำนวนของเดือนนี้) กดลงเองในปฏิทินหลังปรับจำนวนวัน`);
      }
      router.refresh();
    });
  }

  if (dayOffTypes.length === 0) {
    return (
      <p className="text-sm text-(--ink-soft)">
        ยังไม่มีประเภทวันหยุดตามสิทธิ์ (เช่น Day-Off) — สร้างที่ ตั้งค่า › ประเภทการลา โดยติ๊ก “เป็นสิทธิ์ ไม่ต้องอนุมัติ”
        และใส่โควตามากกว่า 0 ก่อน พนักงานจึงจะลงวันหยุดได้
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-(--radius) border border-(--line) bg-(--bg-soft) p-2.5 text-sm">
        {dayOffTypes.map((t) => {
          const used = usedOf(t.id);
          const over = t.days !== null && used > t.days;
          return (
            <p key={t.id} style={{ color: over ? "var(--danger)" : "var(--ink)" }}>
              {t.name}: ลงไว้ <strong>{used}</strong> วัน
              {t.days === null ? " (ไม่จำกัด)" : (
                <>
                  {" "}จาก <strong>{t.days}</strong> วันของเดือนนี้
                </>
              )}
              {over && <span className="ml-1 font-medium">— เกินจำนวนของเดือนนี้</span>}
            </p>
          );
        })}
        <p className="text-xs text-(--ink-soft)">รวมที่พนักงานลงเองในปฏิทินทีม</p>
      </div>

      {dayOffTypes.length > 1 && (
        <label className="flex max-w-md flex-col gap-1">
          <span className="text-xs font-medium text-(--ink-soft)">กดวันว่างแล้วลงเป็นประเภท</span>
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            className="h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm"
          >
            {dayOffTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="text-xs text-(--ink-soft)">
        กดวันว่าง = ลง {typeName} ให้คนนี้ · กดวันที่ลงไว้แล้ว = ยกเลิก
      </p>

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
          const entry = entryOf.get(date);
          const legacy = legacySet.has(date);
          const base = "h-10 rounded-(--radius) border text-sm tabular-nums transition-colors disabled:cursor-default";
          if (entry?.isDayOff) {
            return (
              <button
                key={date}
                type="button"
                disabled={busy}
                onClick={() => cancel(entry)}
                title={`${entry.typeName}${entry.pending ? " (รออนุมัติ)" : ""} — กดเพื่อยกเลิก`}
                className={`${base} border-transparent font-semibold text-white`}
                style={{ backgroundColor: "var(--app-strong)", opacity: entry.pending ? 0.6 : 1 }}
              >
                {day}
              </button>
            );
          }
          if (entry) {
            return (
              <button
                key={date}
                type="button"
                disabled
                title={`${entry.typeName}${entry.pending ? " (รออนุมัติ)" : ""} — แก้ที่ปฏิทินทีม`}
                className={`${base} border-(--line) font-medium text-(--ink)`}
                style={{ backgroundColor: "color-mix(in srgb, var(--tone-ok) 16%, transparent)" }}
              >
                {day}
              </button>
            );
          }
          if (legacy) {
            return (
              <button
                key={date}
                type="button"
                disabled
                title="วันหยุดแบบเดิมที่ลงไว้ในตารางกะ — ล้างได้ด้วยปุ่มด้านล่าง"
                className={`${base} border-dashed font-semibold`}
                style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
              >
                {day}
              </button>
            );
          }
          return (
            <button
              key={date}
              type="button"
              disabled={busy}
              onClick={() => add(date)}
              title={`ลง ${typeName} วันที่ ${day}`}
              className={`${base} border-(--line) bg-(--bg) text-(--ink) hover:bg-(--bg-soft)`}
            >
              {day}
            </button>
          );
        })}
      </div>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-(--ink-soft)">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: "var(--app-strong)" }} /> วันหยุดตามสิทธิ์ (นับในจำนวนของเดือน)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: "color-mix(in srgb, var(--tone-ok) 30%, transparent)" }} /> ลาประเภทอื่น
        </span>
      </p>

      {busy && <p className="text-sm text-(--ink-soft)">กำลังบันทึก…</p>}
      {error && <p className="text-sm text-(--danger)">{error}</p>}

      {legacyOff.length > 0 && (
        <form
          action={legacyAction}
          data-save-toast="off"
          className="flex flex-col gap-2 rounded-(--radius) border border-dashed p-3 text-sm"
          style={{ borderColor: "var(--danger)" }}
        >
          <p>
            เดือนนี้มีวันหยุดแบบเดิมที่ลงไว้ในตารางกะ <strong>{legacyOff.length}</strong> วัน (วันที่{" "}
            {legacyOff.map((d) => Number(d.slice(8))).join(", ")}) — ระบบลงเวลายังถือเป็นวันหยุด แต่ไม่ขึ้นในปฏิทินทีมและ
            ไม่นับในจำนวนของเดือน
          </p>
          {legacyClear ? (
            <>
              <input type="hidden" name="company_id" value={legacyClear.companyId} />
              <input type="hidden" name="employment_id" value={employmentId} />
              <input type="hidden" name="month" value={month} />
              <input type="hidden" name="rest_shift_id" value={legacyClear.restShiftId} />
              <input type="hidden" name="work_shift_id" value={legacyClear.workShiftId} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={legacyPending || busy} onClick={convertLegacy}>
                  ย้ายมาเป็น {typeName}
                </Button>
                <Button type="submit" size="sm" variant="outline" disabled={legacyPending || busy}>
                  {legacyPending ? "กำลังล้าง…" : "ล้างทิ้ง (กลับเป็นวันทำงาน)"}
                </Button>
              </div>
              <p className="text-xs text-(--ink-soft)">
                ยังต้องหยุดวันเหล่านั้น = กด “ย้ายมาเป็น {typeName}” (ขึ้นในปฏิทินทีมและนับในจำนวนของเดือน) ·
                ไม่ต้องหยุดแล้ว = กด “ล้างทิ้ง”
              </p>
            </>
          ) : (
            <p className="text-xs text-(--ink-soft)">ต้องผูกกะให้คนนี้ก่อน จึงจะล้างจากหน้านี้ได้</p>
          )}
          {legacyState.error && <p className="text-(--danger)">{legacyState.error}</p>}
          {legacyState.ok && <p className="text-(--ink-soft)">ล้างแล้ว</p>}
        </form>
      )}
    </div>
  );
}
