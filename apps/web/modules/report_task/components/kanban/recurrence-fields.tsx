"use client";

import { AlarmClock, Repeat } from "lucide-react";

import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import {
  addDaysYmd,
  describeEnd,
  describeRule,
  formatThaiDate,
  occurrenceDates,
  TH_MONTHS,
  TH_WEEKDAYS,
  TH_WEEKDAYS_SHORT,
  validateRule,
} from "@/modules/report_task/lib/task-recurrence";
import { cn } from "@/modules/report_task/lib/utils";
import { usePenaltySettingsStore } from "@/modules/report_task/store/penalty-settings-store";
import type { TaskRecurrenceRule } from "@/modules/report_task/types";

/** ค่าเริ่มต้นตอนเปิดสวิตช์ทำซ้ำ — รายเดือน วันเดียวกับวันเริ่มต้น ครบ 12 ครั้ง */
export function defaultRecurrenceRule(anchor: string): TaskRecurrenceRule {
  const day = Number(anchor.slice(8, 10)) || 1;
  return { freq: "monthly", interval: 1, monthlyMode: "date", monthDay: day, leadDays: 3, anchor, end: { mode: "count", count: 12 } };
}

// มือถือ: สูง 40px กดง่าย + ตัวอักษร 16px กัน iOS ซูมเข้าตอนแตะช่อง
const FIELD = "h-8 [@media(pointer:coarse)]:h-10 rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 text-base sm:text-sm outline-none focus:border-[var(--brand-green)]/60";
const NUM = cn(FIELD, "w-16 text-center tabular-nums");
const FREQS: { id: TaskRecurrenceRule["freq"]; label: string; unit: string }[] = [
  { id: "daily", label: "รายวัน", unit: "วัน" },
  { id: "weekly", label: "รายสัปดาห์", unit: "สัปดาห์" },
  { id: "monthly", label: "รายเดือน", unit: "เดือน" },
  { id: "yearly", label: "รายปี", unit: "ปี" },
];

function clampInt(v: string, min: number, max: number, fallback: number) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * ช่องตั้งค่าการทำซ้ำ (ความถี่ / วันไหน / ขึ้นบอร์ดล่วงหน้า / สิ้นสุด) — ใช้ทั้งตอนสร้างงานและ "แก้การทำซ้ำ"
 * เวลาส่งใช้ช่อง "เวลากำหนดส่ง" เดิมของงาน ไม่มีช่องซ้ำตรงนี้
 */
export function RecurrenceFields({ rule, onChange }: { rule: TaskRecurrenceRule; onChange: (r: TaskRecurrenceRule) => void }) {
  const set = (patch: Partial<TaskRecurrenceRule>) => onChange({ ...rule, ...patch });
  const unit = FREQS.find((f) => f.id === rule.freq)!.unit;
  const anchorDay = Number(rule.anchor.slice(8, 10)) || 1;

  return (
    <div className="space-y-3 rounded-xl border border-[var(--line)] p-3">
      <div className="space-y-1">
        <p className="text-xs font-semibold">ทำซ้ำแบบ</p>
        <div role="group" aria-label="ความถี่" className="inline-flex flex-wrap gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-0.5">
          {FREQS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={rule.freq === f.id}
              onClick={() =>
                set({
                  freq: f.id,
                  ...(f.id === "weekly" && !(rule.weekdays ?? []).length
                    ? { weekdays: [new Date(`${rule.anchor}T00:00:00Z`).getUTCDay()] }
                    : {}),
                  ...(f.id === "yearly" && rule.yearMonth === undefined
                    ? { yearMonth: Number(rule.anchor.slice(5, 7)) - 1, monthDay: anchorDay }
                    : {}),
                })
              }
              className={cn(
                "rounded-md px-3 py-1 [@media(pointer:coarse)]:py-2 text-xs transition-colors",
                rule.freq === f.id ? "bg-[var(--bg)] font-semibold text-[var(--ink)] shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>ทุก</span>
        <input
          type="number"
          min={1}
          max={30}
          aria-label={`ทุกกี่${unit}`}
          value={rule.interval}
          onChange={(e) => set({ interval: clampInt(e.target.value, 1, 30, 1) })}
          className={NUM}
        />
        <span>{unit}</span>
        {rule.freq === "daily" && (
          <label className="ml-2 flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={!!rule.skipWeekends}
              onChange={(e) => set({ skipWeekends: e.target.checked })}
              className="h-4 w-4 accent-[var(--brand-green)]"
            />
            ไม่นับเสาร์-อาทิตย์
          </label>
        )}
      </div>

      {rule.freq === "weekly" && (
        <div className="space-y-1">
          <p className="text-xs text-[var(--ink-soft)]">ส่งทุกวัน</p>
          <div className="flex flex-wrap gap-1">
            {TH_WEEKDAYS_SHORT.map((d, i) => {
              const on = (rule.weekdays ?? []).includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  aria-label={`วัน${TH_WEEKDAYS[i]}`}
                  onClick={() =>
                    set({ weekdays: on ? (rule.weekdays ?? []).filter((x) => x !== i) : [...(rule.weekdays ?? []), i] })
                  }
                  className={cn(
                    "h-8 w-8 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 rounded-full border text-xs transition-colors",
                    on
                      ? "border-[var(--brand-green)] bg-[var(--brand-green)] font-semibold text-white"
                      : "border-[var(--line)] bg-[var(--bg)] text-[var(--ink-soft)] hover:border-[var(--brand-green)]/50"
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {rule.freq === "monthly" && (
        <div className="space-y-1.5 text-sm">
          <p className="text-xs font-semibold">ส่งภายในวันไหนของเดือน</p>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name="rec-mm" checked={(rule.monthlyMode ?? "date") === "date"} onChange={() => set({ monthlyMode: "date" })} className="h-4 w-4 accent-[var(--brand-green)]" />
            วันที่
            <select
              aria-label="วันที่ของเดือน"
              value={rule.monthDay ?? anchorDay}
              onChange={(e) => set({ monthlyMode: "date", monthDay: Number(e.target.value) })}
              className={FIELD}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            ของทุกเดือน
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="rec-mm" checked={rule.monthlyMode === "last"} onChange={() => set({ monthlyMode: "last" })} className="h-4 w-4 accent-[var(--brand-green)]" />
            วันสุดท้ายของเดือน
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name="rec-mm" checked={rule.monthlyMode === "nth"} onChange={() => set({ monthlyMode: "nth", nth: rule.nth ?? 1, nthWeekday: rule.nthWeekday ?? 1 })} className="h-4 w-4 accent-[var(--brand-green)]" />
            <select aria-label="สัปดาห์ที่" value={rule.nth ?? 1} onChange={(e) => set({ monthlyMode: "nth", nth: Number(e.target.value) })} className={FIELD}>
              <option value={1}>วันแรก</option>
              <option value={2}>ที่ 2</option>
              <option value={3}>ที่ 3</option>
              <option value={4}>ที่ 4</option>
              <option value={-1}>สุดท้าย</option>
            </select>
            <select aria-label="วันในสัปดาห์" value={rule.nthWeekday ?? 1} onChange={(e) => set({ monthlyMode: "nth", nthWeekday: Number(e.target.value) })} className={FIELD}>
              {TH_WEEKDAYS.map((d, i) => (
                <option key={i} value={i}>วัน{d}</option>
              ))}
            </select>
            ของเดือน
          </label>
          {(rule.monthlyMode ?? "date") === "date" && (rule.monthDay ?? anchorDay) > 28 && (
            <p className="text-[11px] text-[var(--ink-soft)]">เดือนที่ไม่มีวันที่นี้ (เช่น ก.พ.) จะใช้วันสุดท้ายของเดือนแทน</p>
          )}
        </div>
      )}

      {rule.freq === "yearly" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>ทุกวันที่</span>
          <select aria-label="วันที่" value={rule.monthDay ?? anchorDay} onChange={(e) => set({ monthDay: Number(e.target.value) })} className={FIELD}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select aria-label="เดือน" value={rule.yearMonth ?? 0} onChange={(e) => set({ yearMonth: Number(e.target.value) })} className={FIELD}>
            {TH_MONTHS.map((m, i) => (
              <option key={i} value={i}>{m}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>ให้งานขึ้นบอร์ดก่อนกำหนดส่ง</span>
        <input
          type="number"
          min={0}
          max={60}
          aria-label="ขึ้นบอร์ดก่อนกำหนดส่งกี่วัน"
          value={rule.leadDays}
          onChange={(e) => set({ leadDays: clampInt(e.target.value, 0, 60, 0) })}
          className={NUM}
        />
        <span>วัน</span>
      </div>

      <div className="space-y-1.5 text-sm">
        <p className="text-xs font-semibold">สิ้นสุด</p>
        <label className="flex items-center gap-2">
          <input type="radio" name="rec-end" checked={rule.end.mode === "never"} onChange={() => set({ end: { mode: "never" } })} className="h-4 w-4 accent-[var(--brand-green)]" />
          ไม่มีวันสิ้นสุด
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="rec-end"
              checked={rule.end.mode === "date"}
              onChange={() => set({ end: { mode: "date", until: addDaysYmd(rule.anchor, 365) } })}
              className="h-4 w-4 accent-[var(--brand-green)]"
            />
            ถึงวันที่
          </label>
          {rule.end.mode === "date" && (
            <DatePickerField value={rule.end.until} minDate={rule.anchor} onChange={(v) => set({ end: { mode: "date", until: v } })} className="h-8 w-[150px] text-xs" />
          )}
        </div>
        <label className="flex flex-wrap items-center gap-2">
          <input
            type="radio"
            name="rec-end"
            checked={rule.end.mode === "count"}
            onChange={() => set({ end: { mode: "count", count: rule.end.mode === "count" ? rule.end.count : 12 } })}
            className="h-4 w-4 accent-[var(--brand-green)]"
          />
          ครบ
          <input
            type="number"
            min={1}
            max={500}
            aria-label="จำนวนครั้ง"
            value={rule.end.mode === "count" ? rule.end.count : 12}
            onChange={(e) => set({ end: { mode: "count", count: clampInt(e.target.value, 1, 500, 12) } })}
            className={NUM}
          />
          ครั้ง
        </label>
      </div>
    </div>
  );
}

/** สรุป + รอบที่จะเกิดขึ้น 5 รอบแรก + หมายเหตุการหักคะแนน */
export function RecurrencePreview({ rule, dueTime, fromOccurrence = 1 }: { rule: TaskRecurrenceRule; dueTime?: string; fromOccurrence?: number }) {
  const points = usePenaltySettingsStore((s) => s.defaultPoints);
  const error = validateRule(rule);
  const start = Math.max(1, rule.startOccurrence ?? 1);
  const dates = error ? [] : occurrenceDates(rule, fromOccurrence - start + 5).slice(Math.max(0, fromOccurrence - start));
  const lead = Math.max(0, rule.leadDays || 0);
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-lg bg-[var(--accent)] px-3 py-2">
        <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-green-dark)]" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-[var(--brand-green-dark)]">
            {describeRule(rule)}
            {dueTime ? ` · ส่งภายใน ${dueTime}` : ""}
          </p>
          <p className="text-xs text-[var(--ink-soft)]">{error ?? describeEnd(rule)}</p>
        </div>
      </div>
      {dates.length > 0 && (
        <ul className="space-y-1">
          {dates.map((d, i) => (
            <li key={d} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-md border border-[var(--line)] px-2.5 py-1.5 text-xs tabular-nums">
              <span className="text-[var(--ink-soft)]">รอบ {fromOccurrence + i}</span>
              <span className="font-semibold">
                {TH_WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]} {formatThaiDate(d)}
              </span>
              <span className="text-[var(--ink-soft)]">ขึ้นบอร์ด {formatThaiDate(addDaysYmd(d, -lead), false)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs dark:bg-red-950/40">
        <AlarmClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
        <span>
          รอบไหนไม่ส่งภายในกำหนด จะ<b className="text-red-700 dark:text-red-300">หัก {points} คะแนนอัตโนมัติ</b>เหมือนงานปกติ นับแยกทุกรอบ
        </span>
      </div>
    </div>
  );
}
