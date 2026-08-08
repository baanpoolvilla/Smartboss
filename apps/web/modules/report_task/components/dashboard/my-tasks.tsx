"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD, DASHBOARD_LIST_CARD_H, DASHBOARD_LIST_SCROLL } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Button } from "@/modules/report_task/components/ui/button";
import { getUser } from "@/modules/report_task/data/mock";
import { statusMeta, priorityMeta } from "@/modules/report_task/lib/task-meta";
import { formatShortDate, daysUntil } from "@/modules/report_task/lib/format";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { cn } from "@/modules/report_task/lib/utils";
import { ArrowUpRight } from "lucide-react";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";
import type { Task } from "@/modules/report_task/types";

type Tab = "mine" | "given";

export function MyTasks() {
  const tasks = useTaskStore((s) => s.tasks);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const personId = useDashboardFilterStore((s) => s.personId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  const [tab, setTab] = useState<Tab>("mine");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const focusUserId = personId === "all" ? viewingAsUserId : personId;
  const focusUser = getUser(focusUserId);
  const isSelf = focusUserId === viewingAsUserId;

  const { mine, given } = useMemo(() => {
    const range = presetRange(preset, customFrom, customTo);
    const inRange = (t: Task) => {
      if (!range) return true;
      const due = new Date(t.dueDate).getTime();
      return due >= range.from.getTime() && due <= range.to.getTime();
    };
    const openTasks = tasks.filter((t) => t.status !== "done" && inRange(t));
    const sortByDue = (a: Task, b: Task) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    return {
      // งานที่เราต้องลงมือทำเอง
      mine: openTasks.filter((t) => t.assigneeIds.includes(focusUserId)).sort(sortByDue),
      // งานที่เราเป็นคนสร้าง/แจกให้คนอื่นทำ (ไม่รวมที่แจกให้ตัวเองด้วย)
      given: openTasks
        .filter((t) => t.assignedById === focusUserId && !t.assigneeIds.includes(focusUserId))
        .sort(sortByDue),
    };
  }, [tasks, focusUserId, preset, customFrom, customTo]);

  const activeTasks = tab === "mine" ? mine : given;

  return (
    <Card className={cn(DASHBOARD_CARD, DASHBOARD_LIST_CARD_H)}>
      <CardHeader className="flex-row items-start justify-between gap-2 flex-wrap">
        <div>
          <CardTitle className="text-base font-semibold">{isSelf ? "งานค้างของฉัน" : `งานค้างของ ${focusUser?.name}`}</CardTitle>
          <p className="text-xs text-[var(--ink-soft)] mt-0.5">เฉพาะงานที่ยังไม่เสร็จ (งานที่เสร็จแล้วจะไม่แสดงที่นี่)</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          className="text-[var(--brand-green-dark)]"
          render={
            <Link href="/tasks">
              ดูบอร์ดงาน <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col space-y-1">
        <div className="flex items-center gap-1 bg-[var(--bg-soft)] rounded-lg p-1 mb-2 w-fit shrink-0">
          <button
            data-tour="dashboard-mine-tab"
            onClick={() => setTab("mine")}
            className={cn(
              "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
              tab === "mine" ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
            )}
          >
            งานของตัวเอง ({mine.length})
          </button>
          <button
            data-tour="dashboard-given-tab"
            onClick={() => setTab("given")}
            className={cn(
              "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
              tab === "given" ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
            )}
          >
            งานที่แจกให้คนอื่น ({given.length})
          </button>
        </div>

        <div className={DASHBOARD_LIST_SCROLL}>
        {activeTasks.length === 0 && (
          <p className="text-sm text-[var(--ink-soft)] py-6 text-center">
            {tab === "mine" ? "ไม่มีงานค้าง เยี่ยมมาก!" : "ยังไม่ได้แจกงานให้ใคร"}
          </p>
        )}
        {activeTasks.map((t) => {
          const days = daysUntil(t.dueDate);
          const urgency = dueUrgency(t);
          const assignee = tab === "given" ? getUser(t.assigneeIds[0] ?? "") : null;
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
              <span className={cn("h-2 w-2 rounded-full shrink-0 mt-1.5", statusMeta[t.status].dot)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium truncate min-w-0">{t.title}</span>
                  <span
                    className={cn(
                      "text-xs font-medium shrink-0 whitespace-nowrap",
                      urgency === "overdue" && "text-[var(--chart-red)]",
                      urgency === "soon" && "text-[var(--chart-amber)]",
                      urgency === "normal" && "text-[var(--ink-soft)] font-normal"
                    )}
                  >
                    {days < 0 ? `เลยกำหนด ${Math.abs(days)} วัน` : days === 0 ? "ครบกำหนดวันนี้" : formatShortDate(t.dueDate)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant="outline" className={cn("text-[10px]", priorityMeta[t.priority].badgeClass)}>
                    {priorityMeta[t.priority].label}
                  </Badge>
                  {assignee && <span className="text-xs text-[var(--ink-soft)] truncate">{assignee.name}</span>}
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </CardContent>

      <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
    </Card>
  );
}
