"use client";

import { useMemo } from "react";

import { getUser } from "@/modules/report_task/lib/directory";
import { PROJECT_STATUS_META, dayNum } from "@/modules/report_task/lib/project-schedule";
import { cn } from "@/modules/report_task/lib/utils";
import { useHolidayStore } from "@/modules/report_task/store/holiday-store";
import type { ProjectStatus } from "@/modules/report_task/types";

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export const TH_MONTH_SHORT = TH_MONTHS;

/** "16 ต.ค." / "16 ต.ค. 2569" */
export function fmtDay(s: string, withYear = false): string {
  const d = new Date(dayNum(s.slice(0, 10)) * 864e5);
  return `${d.getUTCDate()} ${TH_MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear() + 543}` : ""}`;
}

/** วันนี้ตามเวลาไทย YYYY-MM-DD */
export function todayBkk(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

/** วันหยุดบริษัท (ไม่นับเป็นวันทำงาน) — บริษัทที่แปลงวันหยุดเป็นสิทธิ์ลาเอง ไม่ใช่วันที่ทุกคนหยุด จึงไม่นับ */
export function useCompanyHolidays(): Set<string> {
  const holidays = useHolidayStore((s) => s.holidays);
  const credit = useHolidayStore((s) => s.holidaysAreLeaveCredit);
  return useMemo(() => (credit ? new Set<string>() : new Set(holidays.map((h) => h.start.slice(0, 10)))), [holidays, credit]);
}

const TONE: Record<string, string> = {
  ok: "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  risk: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  late: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  info: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  muted: "bg-[var(--bg-soft)] text-[var(--ink-soft)]",
};
const DOT: Record<string, string> = { ok: "bg-green-500", risk: "bg-amber-500", late: "bg-red-500", info: "bg-sky-500", muted: "bg-slate-400" };

export function ProjectStatusChip({ status, className }: { status: ProjectStatus; className?: string }) {
  const m = PROJECT_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", TONE[m.tone], className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[m.tone])} />
      {m.label}
    </span>
  );
}

export function PersonDot({ userId, size = 22 }: { userId: string; size?: number }) {
  const u = getUser(userId);
  return u?.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={u.avatarUrl} alt={u.name} title={u.name} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      title={u?.name ?? ""}
      className="inline-grid shrink-0 place-items-center rounded-full bg-[var(--bg-soft)] font-semibold text-[var(--ink-soft)] ring-1 ring-[var(--line)]"
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4) }}
    >
      {u?.avatar ?? "?"}
    </span>
  );
}

export function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="h-1.5 min-w-14 flex-1 overflow-hidden rounded-full bg-[var(--bg-soft)]">
        <span className="block h-full rounded-full bg-[var(--brand-green)]" style={{ width: `${pct}%` }} />
      </span>
      <b className="text-xs tabular-nums">{pct}%</b>
    </span>
  );
}

export const PCT_HELP = "คิดจากจำนวนวันของงาน ไม่ใช่จำนวนงาน — งาน 10 วันที่เสร็จนับมากกว่างาน 1 วัน · งานที่กำลังทำนับตาม % เช็คลิสต์ที่ติ๊กแล้ว";

export const STATE_COLOR: Record<string, string> = {
  done: "var(--chart-green)",
  doing: "var(--chart-blue)",
  todo: "var(--chart-gray)",
  late: "var(--chart-red)",
};
export const STATE_LABEL: Record<string, string> = { done: "เสร็จ", doing: "กำลังทำ", todo: "ยังไม่เริ่ม", late: "เลยกำหนด" };
