"use client";

import { useMemo, useState } from "react";
import { getDepartment, users } from "@/modules/report_task/lib/directory";
import { useLeaveStore } from "@/modules/report_task/store/leave-store";
import { useLeaveTypeStore } from "@/modules/report_task/store/leave-type-store";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { leaveIconOf } from "@/modules/report_task/lib/leave-icons";
import { now } from "@/modules/report_task/lib/now";
import { cn } from "@/modules/report_task/lib/utils";
import { CalendarDays } from "lucide-react";

type Period = "month" | "year" | "all";

const periodOptions: { key: Period; label: string }[] = [
  { key: "month", label: "เดือนนี้" },
  { key: "year", label: "ปีนี้" },
  { key: "all", label: "ทั้งหมด" },
];

/** Half-open [start, end) day span in whole days — matches how a leave's own `end` is stored (exclusive), so a single-day leave still counts as 1. */
function leaveDays(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000));
}

/**
 * Owner-only: how many days off each person took, broken down by leave type
 * — a company-wide roster instead of the per-person view any employee
 * already sees on their own calendar. Lives on the settings page (company
 * tab) alongside the other owner-only company-wide views.
 */
export function LeaveSummaryPanel() {
  const leaves = useLeaveStore((s) => s.leaves);
  const leaveTypes = useLeaveTypeStore((s) => s.types);
  const [period, setPeriod] = useState<Period>("month");

  const rangeStart = useMemo(() => {
    const anchor = now();
    if (period === "month") return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    if (period === "year") return new Date(anchor.getFullYear(), 0, 1);
    return null;
  }, [period]);
  const rangeEndExclusive = useMemo(() => {
    const anchor = now();
    if (period === "month") return new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    if (period === "year") return new Date(anchor.getFullYear() + 1, 0, 1);
    return null;
  }, [period]);

  const rows = useMemo(() => {
    const inRange = (l: (typeof leaves)[number]) => {
      if (!rangeStart || !rangeEndExclusive) return true;
      const s = new Date(l.start).getTime();
      return s >= rangeStart.getTime() && s < rangeEndExclusive.getTime();
    };
    return users
      .map((u) => {
        const mine = leaves.filter((l) => l.userId === u.id && inRange(l));
        const byType = new Map<string, number>();
        let total = 0;
        for (const l of mine) {
          const days = leaveDays(l.start, l.end);
          total += days;
          const key = l.leaveType ?? "other";
          byType.set(key, (byType.get(key) ?? 0) + days);
        }
        return { user: u, total, byType };
      })
      .sort((a, b) => b.total - a.total || a.user.name.localeCompare(b.user.name, "th"));
  }, [leaves, rangeStart, rangeEndExclusive]);

  const totalDays = rows.reduce((sum, r) => sum + r.total, 0);

  return (
    <div className="rounded-lg border border-[var(--line)] overflow-hidden">
      <div className="p-4 pb-3.5 border-b border-[var(--line)] bg-[var(--bg-soft)]/60">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--brand-green-dark)] shrink-0">
            <CalendarDays className="h-4 w-4" />
          </span>
          สรุปวันลาพนักงาน
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-1">ใครหยุดไปกี่วัน แยกตามประเภทการลา — รายบุคคล</p>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex rounded-lg bg-[var(--bg-soft)] p-1 text-sm">
            {periodOptions.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition-colors",
                  period === p.key ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-[var(--ink-soft)] shrink-0">
            รวมทั้งบริษัท <span className="font-semibold text-[var(--ink)] tabular-nums">{totalDays}</span> วัน
          </p>
        </div>

        <div className="max-h-[28rem] overflow-y-auto space-y-1">
          {rows.map(({ user, total, byType }) => {
            const dept = getDepartment(user.departmentId);
            return (
              <div key={user.id} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-[var(--bg-soft)]/60">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={user.avatarUrl ?? undefined} alt={user.name} />
                  <AvatarFallback className="text-[11px]">{user.avatar}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium leading-tight">{user.name}</p>
                  <p className="truncate text-[11px] text-[var(--ink-soft)] leading-tight">{dept?.name ?? user.role}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0 max-w-[55%]">
                  {byType.size === 0 ? (
                    <span className="text-[11px] text-[var(--ink-soft)]">ไม่มีวันลา</span>
                  ) : (
                    [...byType.entries()].map(([typeId, days]) => {
                      const lt = leaveTypes.find((t) => t.id === typeId);
                      const Icon = leaveIconOf(lt?.icon);
                      return (
                        <span
                          key={typeId}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ backgroundColor: `color-mix(in srgb, ${lt?.color ?? "var(--ink-soft)"} 14%, white)`, color: lt?.color ?? "var(--ink-soft)" }}
                        >
                          <Icon className="h-3 w-3" />
                          {lt?.label ?? (typeId === "other" ? "อื่นๆ" : typeId)} {days}
                        </span>
                      );
                    })
                  )}
                </div>
                <span className="w-10 text-right text-sm font-semibold tabular-nums shrink-0">{total}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
