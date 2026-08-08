"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD, DASHBOARD_LIST_CARD_H, DASHBOARD_LIST_SCROLL } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { getUser, getDepartment } from "@/modules/report_task/data/mock";
import { formatShortDate, daysUntil } from "@/modules/report_task/lib/format";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { cn } from "@/modules/report_task/lib/utils";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";

export function UpcomingDeadlines() {
  const tasks = useVisibleTasks();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const personId = useDashboardFilterStore((s) => s.personId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const priority = useDashboardFilterStore((s) => s.priority);

  const upcoming = useMemo(() => {
    const range = presetRange(preset, customFrom, customTo);
    return tasks
      .filter((t) => {
        if (personId !== "all" && !t.assigneeIds.includes(personId)) return false;
        if (departmentId !== "all" && !t.departmentIds.includes(departmentId)) return false;
        if (priority !== "all" && t.priority !== priority) return false;
        if (t.status === "done") return false;
        const days = daysUntil(t.dueDate);
        if (days < 0 || days > 7) return false;
        if (range) {
          const due = new Date(t.dueDate).getTime();
          if (due < range.from.getTime() || due > range.to.getTime()) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [tasks, personId, preset, customFrom, customTo, departmentId, priority]);

  // States who these deadlines belong to — "งานทั้งหมด" on its own read as
  // ambiguous (mine? everyone's?) once the person/department picker up top
  // narrows things, so spell out the actual scope instead of a generic label.
  const scopeLabel =
    personId !== "all" ? getUser(personId)?.name ?? "" : departmentId !== "all" ? `ทีม${getDepartment(departmentId)?.name ?? ""}` : "ทุกคนในบริษัท";

  return (
    <Card className={cn(DASHBOARD_CARD, DASHBOARD_LIST_CARD_H)}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
          กำหนดส่งที่ใกล้ถึง
          {upcoming.length > 0 && (
            <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
              {upcoming.length}
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-[var(--ink-soft)]">
          งานของ{scopeLabel}ที่ยังไม่เสร็จและครบกำหนดใน 7 วันข้างหน้า
        </p>
      </CardHeader>
      <CardContent className={DASHBOARD_LIST_SCROLL}>
        {upcoming.length === 0 && (
          <p className="text-sm text-[var(--ink-soft)] py-6 text-center">ไม่มีงานครบกำหนดใน 7 วันข้างหน้า</p>
        )}
        {upcoming.map((t) => {
          const assignee = getUser(t.assigneeIds[0] ?? "");
          const days = daysUntil(t.dueDate);
          const urgency = dueUrgency(t);
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => setOpenTaskId(t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenTaskId(t.id);
                }
              }}
              className="flex items-start justify-between gap-2 py-2.5 border-b last:border-0 border-[var(--line)] cursor-pointer hover:bg-[var(--bg-soft)] transition-colors -mx-1 px-1 rounded-lg"
            >
              <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                <AvatarFallback className="text-[10px] bg-[var(--bg-soft)] text-[var(--ink)]">
                  {assignee?.avatar}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium truncate min-w-0">{t.title}</span>
                  <span className="text-xs text-[var(--ink-soft)] shrink-0 whitespace-nowrap">{formatShortDate(t.dueDate)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", urgency === "soon" ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-[var(--bg-soft)]")}
                  >
                    {days === 0 ? "วันนี้" : `เหลือ ${days} วัน`}
                  </Badge>
                  {assignee && <span className="text-xs text-[var(--ink-soft)] truncate">{assignee.name}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>

      <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
    </Card>
  );
}
