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

function hhmm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * OT รออนุมัติหนึ่งรายการ — อนุมัติกับไม่อนุมัติเป็นคนละ <form> ส่ง decision ผ่าน
 * hidden input (เหตุผลเดียวกับ CorrectionCard: ไม่แชร์ input ข้ามปุ่ม submit)
 */
export function OvertimeCard({ item }: { item: OvertimeItem }) {
  const [mode, setMode] = useState<"none" | "approve" | "reject">("none");
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
          <span className="text-sm font-semibold tabular-nums text-(--ink)">
            OT {hhmm(item.detectedMinutes)} ชม.
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => toggle("approve")}>
          อนุมัติ
        </Button>
        <Button type="button" variant="outline" onClick={() => toggle("reject")}>
          ไม่อนุมัติ
        </Button>
      </div>

      {mode === "approve" && (
        <form
          action={decideOvertimeAction}
          className="mt-2 flex flex-col gap-2 rounded-(--radius) bg-(--bg-soft) p-2 sm:flex-row sm:items-center"
        >
          {hidden}
          <input type="hidden" name="decision" value="APPROVE" />
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-(--ink-soft)">
            อนุมัติกี่นาที
            <input
              type="number"
              name="approved_minutes"
              defaultValue={item.detectedMinutes}
              min={1}
              max={item.detectedMinutes}
              required
              aria-label="จำนวนนาทีที่อนุมัติ"
              className={`${inputClass} h-9 w-24`}
            />
          </label>
          <input
            name="reason"
            required
            maxLength={500}
            placeholder="เหตุผลที่อนุมัติ เช่น หัวหน้างานสั่งให้มาทำ"
            className={`${inputClass} h-9`}
          />
          <Button type="submit" className="shrink-0">
            ยืนยันอนุมัติ
          </Button>
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
