"use client";

import { useMemo, useState } from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { ShowMoreToggle } from "@/modules/report_task/components/shared/show-more-toggle";
import { useShowMore } from "@/modules/report_task/hooks/use-show-more";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Button } from "@/modules/report_task/components/ui/button";
import { getUser, getDepartment, canManage } from "@/modules/report_task/lib/directory";
import { overdueTasks } from "@/modules/report_task/lib/reports";
import { formatShortDate, daysUntil } from "@/modules/report_task/lib/format";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { previousPeriodRange, periodTrend } from "@/modules/report_task/lib/dashboard-trend";
import { TrendText } from "@/modules/report_task/components/shared/trend-badge";
import { statusMeta } from "@/modules/report_task/lib/task-meta";
import { cn } from "@/modules/report_task/lib/utils";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";
import { StickerConfirmDialog } from "@/modules/report_task/components/shared/sticker-confirm-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import { AlertOctagon, Info } from "lucide-react";
import { showStickerToast } from "@/modules/report_task/lib/sticker-toast";

export function EscalationsPanel() {
  const tasks = useVisibleTasks();
  const addReaction = useTaskStore((s) => s.addReaction);
  const stickers = useStickerStore((s) => s.stickers);
  const angrySticker = stickers.find((s) => s.id === "angry") ?? stickers[0];
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const personId = useDashboardFilterStore((s) => s.personId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  // Shared with every other dashboard widget now — used to have its own local
  // department scope + <Select> here, which could point at a different
  // department than the "ทุกแผนก" picker up top at the same time. One filter,
  // one source of truth (read-only badge below, not a second control).
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [pendingSticker, setPendingSticker] = useState<{ taskId: string; title: string; recipientName: string } | null>(null);

  const scope = useMemo(() => {
    let all = overdueTasks(tasks);
    const range = presetRange(preset, customFrom, customTo);
    if (range) {
      all = all.filter((t) => {
        const due = new Date(t.dueDate).getTime();
        return due >= range.from.getTime() && due <= range.to.getTime();
      });
    }
    if (personId !== "all") return all.filter((t) => t.assigneeIds.includes(personId));
    if (departmentId !== "all") return all.filter((t) => t.departmentIds.includes(departmentId));
    return all;
  }, [tasks, personId, preset, customFrom, customTo, departmentId]);

  // Same previous-period comparison as the KPI card's own trend — "more
  // overdue than last period" reads as worse, not better, so higherIsGood
  // is false here (unlike a success-rate trend). null (no comparison shown)
  // for the unbounded "ทั้งหมด" preset.
  const trend = useMemo(() => {
    const prevRange = previousPeriodRange(preset, customFrom, customTo);
    if (!prevRange) return null;
    let prevAll = overdueTasks(tasks).filter((t) => {
      const due = new Date(t.dueDate).getTime();
      return due >= prevRange.from.getTime() && due <= prevRange.to.getTime();
    });
    if (personId !== "all") prevAll = prevAll.filter((t) => t.assigneeIds.includes(personId));
    else if (departmentId !== "all") prevAll = prevAll.filter((t) => t.departmentIds.includes(departmentId));
    return periodTrend(scope.length, prevAll.length);
  }, [tasks, personId, preset, customFrom, customTo, departmentId, scope.length]);

  const canPickScope = personId === "all";
  const scopeLabel = departmentId === "all" ? "ทั้งองค์กร" : `ทีม${getDepartment(departmentId)?.name}`;
  const { visible, remaining, expanded, toggle } = useShowMore(scope, 5);

  function flagAngry(taskId: string, title: string, recipientName: string) {
    if (!angrySticker) return;
    setPendingSticker({ taskId, title, recipientName });
  }

  function confirmSticker() {
    if (!pendingSticker || !angrySticker) return;
    addReaction(pendingSticker.taskId, angrySticker.id, viewingAsUserId);
    showStickerToast(angrySticker, pendingSticker.title);
    setPendingSticker(null);
  }

  return (
    <Card className={cn(DASHBOARD_CARD, "h-full flex flex-col", "border-[var(--chart-red)]/20")}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <AlertOctagon className="h-4.5 w-4.5 text-[var(--chart-red)]" />
          งานที่เลยกำหนด
          {scope.length > 0 && (
            <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
              {scope.length}
            </span>
          )}
        </CardTitle>
        {trend && (
          <div className="mt-1">
            <TrendText trend={trend} higherIsGood={false} />
          </div>
        )}
        {/* CardHeader lays out as a CSS grid, not flex — a plain sibling div
            here would just stack as a second grid row (left-aligned, under
            the title) instead of sitting beside it. CardAction's
            data-slot="card-action" is what triggers CardHeader's own
            grid-cols-[1fr_auto]/row-span-2 rules to actually pin this to
            the top-right corner. */}
        <CardAction>
          <Badge variant="outline" className="text-[10px] bg-red-50 text-[var(--chart-red)] border-red-200">
            {canPickScope ? scopeLabel : getUser(personId)?.name}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        {scope.length === 0 && (
          <p className="text-sm text-[var(--ink-soft)] py-6 text-center">ไม่มีงานเลยกำหนด ทุกอย่างตามแผน 🎉</p>
        )}
        {visible.map((t) => {
          const assignee = getUser(t.assigneeIds[0] ?? "");
          const days = Math.abs(daysUntil(t.dueDate));
          const angryCount = t.reactions.filter((r) => r.stickerId === "angry").length;
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
                <AvatarFallback className="text-[10px] bg-[var(--bg-soft)] text-[var(--ink)]">{assignee?.avatar}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium truncate min-w-0">{t.title}</span>
                  <span className="text-xs text-[var(--chart-red)] font-medium shrink-0 whitespace-nowrap">
                    เกินกำหนด {days} วัน
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <Badge variant="outline" className={cn("text-[10px]", statusMeta[t.status].badgeClass)}>
                    {statusMeta[t.status].label}
                  </Badge>
                  <span className="text-xs text-[var(--ink-soft)] truncate">
                    {assignee?.name} · {formatShortDate(t.dueDate)}
                    {angryCount > 0 && <span className="text-[var(--chart-red)]"> · ตักเตือนแล้ว {angryCount} ครั้ง</span>}
                  </span>
                  {t.taskMode === "group" &&
                    (() => {
                      const doneCount = t.completedAssigneeIds?.length ?? 0;
                      if (doneCount === 0 || doneCount >= t.assigneeIds.length) return null;
                      return (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button onClick={(e) => e.stopPropagation()} className="text-[var(--brand-green-dark)]" aria-label="ดูรายละเอียดผู้ที่เสร็จ/ยังไม่เสร็จ">
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            }
                          />
                          <TooltipContent className="text-xs">
                            <p className="font-medium">{doneCount}/{t.assigneeIds.length} คนเสร็จแล้ว</p>
                            {t.assigneeIds.map((uid) => (
                              <p key={uid} className={cn((t.completedAssigneeIds ?? []).includes(uid) ? "text-[var(--chart-green)]" : "opacity-80")}>
                                {(t.completedAssigneeIds ?? []).includes(uid) ? "✓" : "○"} {getUser(uid)?.name}
                              </p>
                            ))}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })()}
                </div>
              </div>
              {canManage(viewingAsUserId) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-red-200 text-[var(--chart-red)] hover:bg-red-50 h-7 px-2 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    flagAngry(t.id, t.title, assignee?.name ?? "ผู้รับผิดชอบ");
                  }}
                >
                  😡
                </Button>
              )}
            </div>
          );
        })}
        <div className="mt-auto pt-2">
          <ShowMoreToggle expanded={expanded} remaining={remaining} onToggle={toggle} />
        </div>
      </CardContent>

      <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
      <StickerConfirmDialog
        open={!!pendingSticker}
        onOpenChange={(open) => !open && setPendingSticker(null)}
        sticker={angrySticker ?? null}
        recipientName={pendingSticker?.recipientName ?? ""}
        taskTitle={pendingSticker?.title ?? ""}
        onConfirm={confirmSticker}
      />
    </Card>
  );
}
