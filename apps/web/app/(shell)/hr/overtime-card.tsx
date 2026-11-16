"use client";

import { useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Pill, inputClass } from "@/modules/hr/components/ui";
import { formatDate, formatTime } from "@/modules/hr/lib/labels";
import { decideOvertimeAction } from "./actions";

export interface OvertimeItem {
  employmentId: string;
  name: string;
  code: string;
  workDate: string;
  dayLabel: string;
  inAt: string | null;
  outAt: string | null;
  detectedMinutes: number;
}

/** "8 ชม. 51 นาที" — ข้อความเต็ม ไม่ใช้ 8:51 */
function hoursText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h} ชม.` : "", m > 0 ? `${m} นาที` : ""].filter(Boolean).join(" ") || "0 นาที";
}

/** 1.5 → "1.5 ชม." · 8 → "8 ชม." */
const hrs = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} ชม.`;

/**
 * อนุมัติ OT เป็นชั่วโมง ไม่ใช่นาที — ผู้ใช้ 16/11/2569 (CEO: "เอาเป็นตัดที่ ชม. ดีกว่า จะเอาเศษนาที")
 * ตามที่หัวหน้าสั่งให้ทำวันนั้น เช่น 1.5 ชม. / 2 ชม. / ทั้งวัน · เศษนาทีที่สแกนเกินไม่นับ
 * ทั้งวัน = 8 ชม. (เวลาทำงานปกติ 1 วัน) · เกินเวลาที่สแกนจริงไม่ได้ (ฝั่ง API บังคับอยู่แล้ว) → ปุ่มนั้นกดไม่ได้
 * ส่งไป API เป็นนาทีเหมือนเดิม (ชม. × 60)
 */
const QUICK_HOURS = [1, 1.5, 2, 3, 4];
const FULL_DAY_HOURS = 8;

/**
 * OT รออนุมัติหนึ่งรายการ — อนุมัติกับไม่อนุมัติเป็นคนละ <form> ส่ง decision ผ่าน
 * hidden input (เหตุผลเดียวกับ CorrectionCard: ไม่แชร์ input ข้ามปุ่ม submit)
 */
export function OvertimeCard({ item, canDecide = true, approvers = "" }: { item: OvertimeItem; canDecide?: boolean; approvers?: string }) {
  const [mode, setMode] = useState<"none" | "approve" | "reject">("none");
  const [hours, setHours] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  // ชั่วโมงสูงสุดที่เลือกได้ = เวลาที่สแกนจริง ปัดลงทีละครึ่งชั่วโมง
  const maxHours = Math.floor(item.detectedMinutes / 30) / 2;
  const customHours = Number(custom);
  const customOk = custom !== "" && Number.isFinite(customHours) && customHours > 0 && customHours * 2 === Math.round(customHours * 2) && customHours <= maxHours;
  const picked = custom !== "" ? (customOk ? customHours : null) : hours;
  const toggle = (next: "approve" | "reject") => setMode((m) => (m === next ? "none" : next));

  const hidden = (
    <>
      <input type="hidden" name="employment_id" value={item.employmentId} />
      <input type="hidden" name="work_date" value={item.workDate} />
    </>
  );

  return (
    <div className="rounded-(--radius) border border-(--line) p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-(--ink)">
            {item.name}{" "}
            <span className="font-mono text-[11px] text-(--ink-soft)">{item.code}</span>
          </p>
          <p className="text-sm text-(--ink-soft)">
            {formatDate(item.workDate)} · สแกน {item.inAt ? formatTime(item.inAt) : "—"} –{" "}
            {item.outAt ? formatTime(item.outAt) : "—"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Pill tone="var(--tone-info)">{item.dayLabel}</Pill>
          <span className="text-sm tabular-nums text-(--ink-soft)">
            สแกนได้ <b className="text-(--ink)">{hoursText(item.detectedMinutes)}</b>
          </span>
        </div>
      </div>

      {!canDecide && <p className="mt-2 text-xs text-(--ink-soft)">รอผู้อนุมัติ OT{approvers ? `: ${approvers}` : ""}</p>}
      {canDecide && (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => toggle("approve")}>
          อนุมัติ
        </Button>
        <Button type="button" variant="outline" onClick={() => toggle("reject")}>
          ไม่อนุมัติ
        </Button>
      </div>
      )}

      {mode === "approve" && (
        <form action={decideOvertimeAction} className="mt-2 flex flex-col gap-3 rounded-(--radius) bg-(--bg-soft) p-3">
          {hidden}
          <input type="hidden" name="decision" value="APPROVE" />
          {picked !== null && <input type="hidden" name="approved_minutes" value={Math.round(picked * 60)} />}
          <div>
            <p className="text-sm font-medium text-(--ink)">หัวหน้าสั่งให้ทำกี่ชั่วโมง</p>
            <p className="text-xs text-(--ink-soft)">นับเป็นชั่วโมง เศษนาทีไม่นับ · เลือกได้ไม่เกินเวลาที่สแกน ({hoursText(item.detectedMinutes)})</p>
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="จำนวนชั่วโมง OT ที่อนุมัติ">
            {[...QUICK_HOURS.map((h) => ({ h, label: hrs(h) })), { h: FULL_DAY_HOURS, label: `ทั้งวัน (${FULL_DAY_HOURS} ชม.)` }].map(({ h, label }) => {
              const on = custom === "" && hours === h;
              const disabled = h > maxHours;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => {
                    setHours(h);
                    setCustom("");
                  }}
                  className={`h-10 rounded-full border px-4 text-sm tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    on
                      ? "border-[var(--brand-navy)] bg-[var(--brand-navy)] font-semibold text-white"
                      : "border-(--line) bg-white text-(--ink) hover:border-[var(--brand-navy)]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
            <label className={`flex h-10 items-center gap-1.5 rounded-full border bg-white pl-3 pr-2 text-sm ${custom !== "" ? "border-[var(--brand-navy)]" : "border-(--line)"}`}>
              ระบุเอง
              <input
                type="number"
                inputMode="decimal"
                step={0.5}
                min={0.5}
                max={maxHours}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                aria-label="จำนวนชั่วโมงที่อนุมัติ (ระบุเอง)"
                className="h-7 w-16 rounded-md border border-(--line) px-2 text-center tabular-nums"
              />
              ชม.
            </label>
          </div>
          {custom !== "" && !customOk && (
            <p className="text-xs text-(--danger)">ใส่ทีละครึ่งชั่วโมง (เช่น 1, 1.5, 2) และไม่เกิน {hrs(maxHours)}</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              name="reason"
              required
              maxLength={500}
              placeholder="เหตุผลที่อนุมัติ เช่น หัวหน้างานสั่งให้มาทำ"
              className={`${inputClass} h-10`}
            />
            <Button type="submit" className="shrink-0" disabled={picked === null}>
              {picked === null ? "เลือกจำนวนชั่วโมงก่อน" : `ยืนยันอนุมัติ ${hrs(picked)}`}
            </Button>
          </div>
        </form>
      )}

      {mode === "reject" && (
        <form
          action={decideOvertimeAction}
          className="mt-2 flex flex-col gap-2 rounded-(--radius) bg-(--bg-soft) p-2 sm:flex-row"
        >
          {hidden}
          <input type="hidden" name="decision" value="REJECT" />
          <input
            name="reason"
            required
            maxLength={500}
            placeholder="เหตุผลที่ไม่อนุมัติ เช่น สแกนออกช้า ไม่ได้ทำงานจริง"
            className={`${inputClass} h-9`}
          />
          <Button type="submit" variant="danger" className="shrink-0">
            ยืนยันไม่อนุมัติ
          </Button>
        </form>
      )}
    </div>
  );
}
