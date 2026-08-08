"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD, DASHBOARD_LIST_CARD_H, DASHBOARD_LIST_SCROLL } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Button } from "@/modules/report_task/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { getUser, getDepartment, canManage, departments } from "@/modules/report_task/data/mock";
import { overdueTasks } from "@/modules/report_task/lib/reports";
import { formatShortDate, daysUntil } from "@/modules/report_task/lib/format";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { priorityMeta } from "@/modules/report_task/lib/task-meta";
import { cn } from "@/modules/report_task/lib/utils";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";
import { AlertOctagon } from "lucide-react";
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
  // department scope here, which could point at a different department than
  // the "ทุกแผนก" picker up top at the same time. One filter, one source of
  // truth, same as priority/overdue.
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const setDepartmentId = useDashboardFilterStore((s) => s.setDepartmentId);
  const priority = useDashboardFilterStore((s) => s.priority);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const scope = useMemo(() => {
    let all = overdueTasks(tasks);
    const range = presetRange(preset, customFrom, customTo);
    if (range) {
      all = all.filter((t) => {
        const due = new Date(t.dueDate).getTime();
        return due >= range.from.getTime() && due <= range.to.getTime();
      });
    }
    if (priority !== "all") all = all.filter((t) => t.priority === priority);
    if (personId !== "all") return all.filter((t) => t.assigneeIds.includes(personId));
    if (departmentId !== "all") return all.filter((t) => t.departmentIds.includes(departmentId));
    return all;
  }, [tasks, personId, preset, customFrom, customTo, departmentId, priority]);

  const canPickScope = personId === "all";
  const scopeLabel = departmentId === "all" ? "ทั้งองค์กร" : `ทีม${getDepartment(departmentId)?.name}`;

  function flagAngry(taskId: string, title: string) {
    if (!angrySticker) return;
    addReaction(taskId, angrySticker.id, viewingAsUserId);
    showStickerToast(angrySticker, title);
  }

  return (
    <Card className={cn(DASHBOARD_CARD, DASHBOARD_LIST_CARD_H, "border-[var(--chart-red)]/20")}>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <AlertOctagon className="h-4.5 w-4.5 text-[var(--chart-red)]" />
            งานที่ต้องเร่งติดตาม
            {scope.length > 0 && (
              <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
                {scope.length}
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-[var(--ink-soft)] mt-0.5">งานที่เลยกำหนดส่งไปแล้วและยังไม่เสร็จ</p>
        </div>
        {canPickScope ? (
          <Select value={departmentId} onValueChange={(v) => v && setDepartmentId(v)}>
            <SelectTrigger className="w-[150px] h-7 text-[10px] bg-red-50 text-[var(--chart-red)] border-red-200 [&_svg]:text-[var(--chart-red)]">
              <SelectValue>{scopeLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทั้งองค์กร</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>ทีม{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline" className="text-[10px] bg-red-50 text-[var(--chart-red)] border-red-200">{getUser(personId)?.name}</Badge>
        )}
      </CardHeader>
      <CardContent className={DASHBOARD_LIST_SCROLL}>
        {scope.length === 0 && (
          <p className="text-sm text-[var(--ink-soft)] py-6 text-center">ไม่มีงานเลยกำหนด ทุกอย่างเรียบร้อย 🎉</p>
        )}
        {scope.map((t) => {
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
                    เลยกำหนด {days} วัน
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <Badge variant="outline" className={cn("text-[10px]", priorityMeta[t.priority].badgeClass)}>
                    {priorityMeta[t.priority].label}
                  </Badge>
                  <span className="text-xs text-[var(--ink-soft)] truncate">
                    {assignee?.name} · {formatShortDate(t.dueDate)}
                    {angryCount > 0 && <span className="text-[var(--chart-red)]"> · ถูกตักเตือน {angryCount} ครั้ง</span>}
                  </span>
                </div>
              </div>
              {canManage(viewingAsUserId) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-red-200 text-[var(--chart-red)] hover:bg-red-50 h-7 px-2 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    flagAngry(t.id, t.title);
                  }}
                >
                  😡
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>

      <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
    </Card>
  );
}
