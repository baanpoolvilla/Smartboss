"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD, DASHBOARD_LIST_CARD_H, DASHBOARD_LIST_SCROLL } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Progress } from "@/modules/report_task/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { users, getDepartment } from "@/modules/report_task/data/mock";
import { buildUserReports } from "@/modules/report_task/lib/reports";
import { cn } from "@/modules/report_task/lib/utils";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { filterTasksByDashboard } from "@/modules/report_task/lib/date-filter";
import { Info } from "lucide-react";
import type { ScoreBreakdown } from "@/modules/report_task/types";

const rankStyles = [
  "bg-amber-100 text-amber-700",
  "bg-slate-100 text-slate-600",
  "bg-orange-100 text-orange-700",
];

interface BreakdownCounts {
  assignedTasks: number;
  completedTasks: number;
  lateTasks: number;
  revisionCount: number;
  manualPenaltyCount: number;
  stickerCount: number;
}

/** Turns "why is my score 56" into a plain read-out — every ± line that fed the total, with the raw count behind each one. */
function ScoreBreakdownPopover({ breakdown, counts }: { breakdown: ScoreBreakdown; counts: BreakdownCounts }) {
  const rows: { label: string; detail: string; value: number }[] = [
    { label: "ฐาน", detail: `${counts.completedTasks}/${counts.assignedTasks} งานเสร็จ`, value: breakdown.base },
    { label: "งานเลยกำหนด", detail: `${counts.lateTasks} งาน`, value: -breakdown.latePenalty },
    { label: "เลื่อนกำหนดส่ง", detail: `${counts.revisionCount} ครั้ง`, value: -breakdown.revisionPenalty },
    { label: "หักคะแนนด้วยมือ", detail: `${counts.manualPenaltyCount} งาน`, value: -breakdown.manualPenalty },
    { label: "สติกเกอร์", detail: `${counts.stickerCount} ครั้ง`, value: breakdown.stickerAdjustment },
  ];
  return (
    <Popover>
      <PopoverTrigger
        className="shrink-0 text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)]"
        aria-label="วิธีคิดคะแนน"
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <p className="text-xs font-semibold">วิธีคิดคะแนนนี้</p>
        <div className="space-y-1 text-xs">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 text-[var(--ink-soft)]">
              <span className="truncate">
                {row.label} <span className="text-[var(--ink-soft)]/70">({row.detail})</span>
              </span>
              <span className={cn("tabular-nums font-medium shrink-0", row.value < 0 ? "text-[var(--chart-red)]" : "text-[var(--ink)]")}>
                {row.value > 0 ? "+" : ""}
                {row.value}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1 mt-1 border-t border-[var(--line)] font-semibold">
            <span>รวม (0–100)</span>
            <span className="tabular-nums">{breakdown.total}</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TeamLeaderboard() {
  const tasks = useVisibleTasks();
  const stickers = useStickerStore((s) => s.stickers);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const priority = useDashboardFilterStore((s) => s.priority);

  // personId stays hardcoded "all" — a leaderboard scoped to one person isn't
  // a leaderboard — but every other filter (department/priority) narrows the
  // ranking the same way it narrows every other dashboard widget.
  const scoped = useMemo(
    () => filterTasksByDashboard(tasks, { personId: "all", preset, customFrom, customTo, departmentId, priority }),
    [tasks, preset, customFrom, customTo, departmentId, priority]
  );

  const reports = buildUserReports(scoped, stickers)
    .filter((r) => r.assignedTasks > 0)
    .sort((a, b) => b.score - a.score);

  return (
    <Card className={cn(DASHBOARD_CARD, DASHBOARD_LIST_CARD_H)}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
          อันดับทีม
          {reports.length > 0 && (
            <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
              {reports.length}
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-[var(--ink-soft)]">จัดอันดับตามคะแนนผลงาน (กดไอคอน ⓘ ดูวิธีคิดคะแนน) · เรียงจากสูงไปต่ำ</p>
      </CardHeader>
      <CardContent className={cn(DASHBOARD_LIST_SCROLL, "space-y-3.5")}>
        {reports.length === 0 && (
          <p className="text-sm text-[var(--ink-soft)] py-6 text-center">ไม่มีข้อมูลในช่วงเวลานี้ — ลองปรับตัวกรองด้านบน</p>
        )}
        {reports.map((r, i) => {
          const user = users.find((u) => u.id === r.userId)!;
          const dept = getDepartment(user.departmentId);
          const ownTasks = scoped.filter((t) => t.assigneeIds.includes(r.userId));
          const counts: BreakdownCounts = {
            assignedTasks: r.assignedTasks,
            completedTasks: r.completedTasks,
            lateTasks: r.lateTasks,
            revisionCount: r.revisionCount,
            manualPenaltyCount: ownTasks.filter((t) => t.penalty).length,
            stickerCount: ownTasks.reduce((sum, t) => sum + t.reactions.length, 0),
          };
          return (
            <div key={r.userId} className="flex items-center gap-3">
              <span
                className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0",
                  i < 3 ? rankStyles[i] : "bg-[var(--bg-soft)] text-[var(--ink-soft)]"
                )}
              >
                {i + 1}
              </span>
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                  {user.avatar}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{user.name}</p>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="text-sm font-semibold tabular-nums">{r.score}</span>
                    <ScoreBreakdownPopover breakdown={r.scoreBreakdown} counts={counts} />
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Progress value={r.completionRate} className="h-1.5" />
                  {dept && (
                    <Badge variant="secondary" className="text-[10px] font-normal shrink-0">
                      {dept.name}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
