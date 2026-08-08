"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCodes,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { usePenaltySettingsStore } from "@/modules/report_task/store/penalty-settings-store";
import { canEditRecord, canSeeTask, canDockPenalty } from "@/modules/report_task/lib/permissions";
import { getUser, getDepartment, users } from "@/modules/report_task/data/mock";
import { statusMeta, priorityMeta, priorityColorHex, taskStatusOrder, taskPriorityOrder, statusIcon } from "@/modules/report_task/lib/task-meta";
import { matchesTaskFilters } from "@/modules/report_task/lib/task-filter";
import { useTaskSheetParam } from "@/modules/report_task/hooks/use-task-sheet-param";
import { statusColors, chartColors } from "@/modules/report_task/lib/chart-colors";
import { KanbanColumn, type BoardColumn } from "./kanban-column";
import { TaskCardOverlay } from "./task-card";
import { TaskDetailSheet } from "./task-detail-sheet";
import type { Task, TaskPriority, TaskStatus } from "@/modules/report_task/types";
import { toast } from "sonner";
import { useTaskBoardIntentStore } from "@/modules/report_task/store/task-board-intent-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/modules/report_task/components/ui/dropdown-menu";
import { Group, CircleDot, Flag, User, Info, SearchX, CheckCircle2, ChevronDown, AlarmClockOff, X, ListChecks } from "lucide-react";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { cn } from "@/modules/report_task/lib/utils";

type GroupBy = "status" | "priority" | "assignee";

const groupByLabels: Record<GroupBy, string> = {
  status: "สถานะ",
  priority: "ความสำคัญ",
  assignee: "ผู้รับผิดชอบ",
};

const statusAccent = statusColors;
const priorityAccent = priorityColorHex;

const dragKeyboardCodes: KeyboardCodes = {
  start: ["Space"],
  cancel: ["Escape"],
  end: ["Space"],
};

export function KanbanBoard() {
  const storeTasks = useTaskStore((s) => s.tasks);
  const filters = useTaskStore((s) => s.filters);
  const moveTask = useTaskStore((s) => s.moveTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const setAssignees = useTaskStore((s) => s.setAssignees);
  const setFilters = useTaskStore((s) => s.setFilters);
  const applyPenalty = useTaskStore((s) => s.applyPenalty);
  const defaultPoints = usePenaltySettingsStore((s) => s.defaultPoints);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  // A department head sees the whole board; everyone else only sees tasks
  // they're assigned to or created — a coworker's task no longer appears.
  const allTasks = useMemo(
    () => storeTasks.filter((t) => canSeeTask(t, viewingAsUserId)),
    [storeTasks, viewingAsUserId]
  );

  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  // Multi-select + bulk actions — same capability the table view already
  // has, so switching to the board (the default view) doesn't lose it.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Mirrored into the `?task=` URL param (see the hook) so the browser Back
  // button closes the sheet before leaving the page — falls back to the
  // one-shot navigation intent (dashboard chart click) when there's no
  // `?task=` in the URL yet.
  const { openTaskId, open: setOpenTaskId, close: closeTaskSheet } = useTaskSheetParam(
    useTaskBoardIntentStore.getState().openTaskId
  );

  const pendingDepartmentId = useTaskBoardIntentStore((s) => s.departmentId);
  const pendingScrollToStatus = useTaskBoardIntentStore((s) => s.scrollToStatus);
  const clearIntent = useTaskBoardIntentStore((s) => s.clear);

  useEffect(() => {
    if (pendingDepartmentId) {
      setFilters({ departmentId: pendingDepartmentId });
      // Landing here is a jump from another page (e.g. clicking a bar on the
      // dashboard chart) — the filter dropdown alone is easy to miss amid a
      // busy board, so confirm out loud what just got applied and why.
      const deptName = getDepartment(pendingDepartmentId)?.name;
      if (deptName) toast.success(`กรองบอร์ดงานเฉพาะแผนก${deptName}แล้ว`);
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (pendingScrollToStatus) {
      const el = document.getElementById(`kanban-col-${pendingScrollToStatus}`);
      el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      const highlightClasses = ["ring-2", "ring-[var(--brand-green)]", "ring-offset-2"];
      el?.classList.add(...highlightClasses);
      timeout = setTimeout(() => el?.classList.remove(...highlightClasses), 2000);
    }

    clearIntent();
    return () => {
      if (timeout) clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Only Space picks up/drops a card via keyboard — Enter is left free so
    // a focused card can be opened (see TaskCard's onKeyDown) instead of
    // starting a drag.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: dragKeyboardCodes })
  );

  const filtered = useMemo(
    () => allTasks.filter((t) => matchesTaskFilters(t, filters)),
    [allTasks, filters]
  );

  // Columns are generated from the chosen grouping — Planner's "Group by".
  const columns: BoardColumn[] = useMemo(() => {
    if (groupBy === "status") {
      return taskStatusOrder.map((s) => ({
        id: s,
        label: statusMeta[s].label,
        accent: statusAccent[s],
        icon: statusIcon[s],
        tasks: filtered.filter((t) => t.status === s),
      }));
    }
    if (groupBy === "priority") {
      return taskPriorityOrder.map((p) => ({
        id: p,
        label: priorityMeta[p].label,
        accent: priorityAccent[p],
        tasks: filtered.filter((t) => t.priority === p),
      }));
    }
    // assignee — only people who actually have tasks in view
    return users
      .map((u) => ({
        id: u.id,
        label: u.name,
        accent: chartColors.blue,
        tasks: filtered.filter((t) => t.assigneeIds.includes(u.id)),
      }))
      .filter((c) => c.tasks.length > 0);
  }, [groupBy, filtered]);

  function handleDragStart(e: DragStartEvent) {
    setActiveTask(allTasks.find((t) => t.id === e.active.id) ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveTask(null);
    if (!over) return;

    const task = allTasks.find((t) => t.id === active.id);
    if (!task) return;

    const columnIds = columns.map((c) => c.id);
    const overIsColumn = columnIds.includes(String(over.id));
    const targetColumnId = overIsColumn
      ? String(over.id)
      : (over.data.current?.columnId as string | undefined);
    if (!targetColumnId) return;

    // Dropping into a column means "set this task's grouped attribute to that column".
    if (groupBy === "status") {
      if (task.status === targetColumnId) return;
      moveTask(task.id, targetColumnId as TaskStatus);
      toast.success(`ย้าย "${task.title}" ไปยัง ${statusMeta[targetColumnId as TaskStatus].label} แล้ว`);
    } else if (groupBy === "priority") {
      if (task.priority === targetColumnId) return;
      if (!canEditRecord(task.assignedById, task.departmentIds, viewingAsUserId)) {
        toast.error(`แก้ไขความสำคัญได้เฉพาะผู้สร้างงานหรือหัวหน้าแผนก "${task.title}"`);
        return;
      }
      updateTask(task.id, { priority: targetColumnId as TaskPriority });
      toast.success(`เปลี่ยนความสำคัญ "${task.title}" เป็น ${priorityMeta[targetColumnId as TaskPriority].label}`);
    } else {
      // A task with several assignees shows in each of their columns, so dragging
      // swaps only the column it was dragged FROM for the target — the other
      // assignees stay put instead of being wiped.
      const sourceColumnId = active.data.current?.columnId as string | undefined;
      if (task.assigneeIds.includes(targetColumnId)) return;
      if (!canEditRecord(task.assignedById, task.departmentIds, viewingAsUserId)) {
        toast.error(`แก้ไขผู้รับผิดชอบได้เฉพาะผู้สร้างงานหรือหัวหน้าแผนก "${task.title}"`);
        return;
      }
      const next = sourceColumnId
        ? task.assigneeIds.map((id) => (id === sourceColumnId ? targetColumnId : id))
        : [targetColumnId];
      setAssignees(task.id, next);
      const others = next.length - 1;
      toast.success(
        others > 0
          ? `ย้าย "${task.title}" ให้ ${getUser(targetColumnId)?.name} (ยังมีผู้รับผิดชอบร่วมอีก ${others} คน)`
          : `มอบหมาย "${task.title}" ให้ ${getUser(targetColumnId)?.name}`
      );
    }
  }

  const GroupIcon = groupBy === "status" ? CircleDot : groupBy === "priority" ? Flag : User;
  const sharedCount = useMemo(() => filtered.filter((t) => t.assigneeIds.length > 1).length, [filtered]);

  const selCount = selected.size;
  // "เลือกหลายรายการ" mode — off by default (a card's checkbox only shows on
  // hover then), toggled on from the toolbar so it's a real, discoverable
  // entry point instead of something you have to stumble on by hovering.
  const [selectMode, setSelectMode] = useState(false);
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Checking one card off its hover-revealed checkbox (without going
    // through the toolbar toggle first) is a real way in too — once that's
    // happened, pin every checkbox visible the same way the toolbar toggle
    // would, so finishing the selection doesn't mean re-discovering each
    // card's checkbox by hovering it again one at a time.
    setSelectMode(true);
  }
  function clearSelection() {
    setSelected(new Set());
  }
  function toggleSelectMode() {
    setSelectMode((v) => {
      if (v) clearSelection();
      return !v;
    });
  }
  function bulkStatus(s: TaskStatus) {
    selected.forEach((id) => moveTask(id, s));
    toast.success(`เปลี่ยน ${selCount} งาน เป็น "${statusMeta[s].label}"`);
    clearSelection();
  }
  function bulkPriority(p: TaskPriority) {
    const editable = filtered.filter((t) => selected.has(t.id) && canEditRecord(t.assignedById, t.departmentIds, viewingAsUserId));
    editable.forEach((t) => updateTask(t.id, { priority: p }));
    const skipped = selCount - editable.length;
    toast.success(
      skipped > 0
        ? `ตั้งความสำคัญ ${editable.length} งาน เป็น "${priorityMeta[p].label}" (ข้าม ${skipped} งานที่ไม่ใช่ผู้สร้าง)`
        : `ตั้งความสำคัญ ${selCount} งาน เป็น "${priorityMeta[p].label}"`
    );
    clearSelection();
  }
  function bulkDock() {
    const dockable = filtered.filter(
      (t) =>
        selected.has(t.id) &&
        (t.deadlineType ?? "flexible") !== "strict" &&
        canDockPenalty(t.assignedById, t.departmentIds, viewingAsUserId)
    );
    dockable.forEach((t) => applyPenalty(t.id, defaultPoints, viewingAsUserId));
    const skipped = selCount - dockable.length;
    toast.error(
      skipped > 0
        ? `หัก ${defaultPoints} คะแนน กับ ${dockable.length} งาน (ข้าม ${skipped} งานที่ตรงกำหนดหรือไม่มีสิทธิ์หัก)`
        : `หัก ${defaultPoints} คะแนน กับ ${selCount} งาน`
    );
    clearSelection();
  }

  return (
    <>
      {/* Group by (Planner-style) */}
      <div className="flex items-center gap-2">
        <Group className="h-4 w-4 text-[var(--ink-soft)]" />
        <span className="text-xs text-[var(--ink-soft)]">จัดกลุ่มตาม:</span>
        <Select value={groupBy} onValueChange={(v) => v && setGroupBy(v as GroupBy)}>
          <SelectTrigger className="w-[160px] bg-white">
            <SelectValue>
              <span className="flex items-center gap-1.5">
                <GroupIcon className="h-3.5 w-3.5 text-[var(--ink-soft)]" />
                {groupByLabels[groupBy]}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(["status", "priority", "assignee"] as GroupBy[]).map((g) => (
              <SelectItem key={g} value={g}>{groupByLabels[g]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Grouping by person shows a shared task under each assignee, so the
            column counts add up to more than the task total — say so. */}
        {groupBy === "assignee" && sharedCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--ink-soft)]">
            <Info className="h-3 w-3" />
            งานที่มีผู้รับผิดชอบหลายคน ({sharedCount} งาน) จะแสดงในคอลัมน์ของทุกคน
          </span>
        )}
        <button
          data-tour="task-select-mode-toggle"
          onClick={toggleSelectMode}
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 h-8 rounded-lg px-2.5 text-xs font-medium transition-colors",
            selectMode
              ? "bg-[var(--brand-green)] text-[var(--ink)]"
              : "bg-white ring-1 ring-inset ring-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
          )}
        >
          <ListChecks className="h-3.5 w-3.5" />
          เลือกหลายรายการ
        </button>
        <span className="text-xs text-[var(--ink-soft)]">{filtered.length} งาน</span>
      </div>

      {/* Bulk-action bar — appears when cards are selected, same actions as the table view */}
      {selCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--brand-green)] bg-[color-mix(in_srgb,var(--brand-green)_8%,white)] px-3 py-2 text-sm">
          <span className="font-medium">เลือก {selCount} งาน</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button className="inline-flex items-center gap-1 h-8 rounded-lg bg-white ring-1 ring-inset ring-[var(--line)] px-2.5 text-xs font-medium hover:bg-[var(--bg-soft)]">
                    <CheckCircle2 className="h-3.5 w-3.5" /> เปลี่ยนสถานะ <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="w-40">
                {taskStatusOrder.map((s) => {
                  const Icon = statusIcon[s];
                  return (
                    <DropdownMenuItem key={s} onClick={() => bulkStatus(s)}>
                      <Icon className="h-3.5 w-3.5" /> {statusMeta[s].label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button className="inline-flex items-center gap-1 h-8 rounded-lg bg-white ring-1 ring-inset ring-[var(--line)] px-2.5 text-xs font-medium hover:bg-[var(--bg-soft)]">
                    ความสำคัญ <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="w-36">
                {taskPriorityOrder.map((p) => (
                  <DropdownMenuItem key={p} onClick={() => bulkPriority(p)}>
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: priorityMeta[p].accentColor }} />
                    {priorityMeta[p].label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              onClick={bulkDock}
              className="inline-flex items-center gap-1 h-8 rounded-lg bg-red-600 text-white px-2.5 text-xs font-semibold hover:bg-red-700"
            >
              <AlarmClockOff className="h-3.5 w-3.5" /> หักคะแนน −{defaultPoints}
            </button>

            <button
              onClick={clearSelection}
              className="inline-flex items-center gap-1 h-8 rounded-lg text-[var(--ink-soft)] px-2 text-xs hover:bg-white hover:text-[var(--ink)]"
            >
              <X className="h-3.5 w-3.5" /> ล้าง
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="ไม่พบงานตามตัวกรอง"
          description="ลองปรับคำค้นหรือตัวกรอง หรือกดล้างเพื่อดูงานทั้งหมด"
          action={
            <button
              onClick={() =>
                setFilters({ search: "", assigneeId: "all", departmentId: "all", priority: "all", penalty: "all" })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-green)] text-[var(--ink)] text-xs font-semibold px-3 py-2 hover:bg-[var(--brand-green-dark)] hover:text-white transition-colors"
            >
              ล้างตัวกรอง
            </button>
          }
        />
      ) : (
        <DndContext
          id="kanban-board"
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
            {columns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                onOpen={setOpenTaskId}
                selected={selected}
                onToggleSelect={toggleSelect}
                selectMode={selectMode}
              />
            ))}
          </div>
          <DragOverlay>{activeTask ? <TaskCardOverlay task={activeTask} /> : null}</DragOverlay>
        </DndContext>
      )}

      <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && closeTaskSheet()} />
    </>
  );
}
