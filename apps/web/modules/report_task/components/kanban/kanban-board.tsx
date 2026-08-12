"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { canEditRecord, canSeeTask } from "@/modules/report_task/lib/permissions";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { getUser, getDepartment, users } from "@/modules/report_task/lib/directory";
import { statusMeta, priorityMeta, priorityColorHex, taskPriorityOrder, statusIcon } from "@/modules/report_task/lib/task-meta";
import { matchesTaskFilters } from "@/modules/report_task/lib/task-filter";
import { useTaskSheetParam } from "@/modules/report_task/hooks/use-task-sheet-param";
import { statusColors, chartColors } from "@/modules/report_task/lib/chart-colors";
import { KanbanColumn, type BoardColumn } from "./kanban-column";
import { TaskCardOverlay } from "./task-card";
import { TaskDetailSheet } from "./task-detail-sheet";
import { PersonTopicsDialog } from "./person-topics-dialog";
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
import { Group, CircleDot, Flag, User, Info, SearchX, AlarmClockOff } from "lucide-react";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";

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
  const resetFilters = useTaskStore((s) => s.resetFilters);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  // A department head sees the whole board; everyone else only sees tasks
  // they're assigned to or created — a coworker's task no longer appears.
  const allTasks = useMemo(
    () => storeTasks.filter((t) => canSeeTask(t, viewingAsUserId)),
    [storeTasks, viewingAsUserId]
  );

  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  // Set only when the board is grouped by assignee and someone clicks a
  // person's column header — see PersonTopicsDialog.
  const [personTopicsFor, setPersonTopicsFor] = useState<string | null>(null);
  // Mirrored into the `?task=` URL param (see the hook) so the browser Back
  // button closes the sheet before leaving the page — falls back to the
  // one-shot navigation intent (dashboard chart click) when there's no
  // `?task=` in the URL yet.
  const { openTaskId, open: setOpenTaskId, close: closeTaskSheet } = useTaskSheetParam(
    useTaskBoardIntentStore.getState().openTaskId
  );
  // Separate from `?task=` (which opens the detail dialog) — a notification
  // link should point out which card it's about without forcing the dialog
  // open, so whoever clicked it can look at the board first and decide
  // whether to open it themselves.
  const highlightTaskId = useSearchParams().get("highlight");

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

  // Landing via ?highlight=<id> (a notification, a deep link from elsewhere)
  // scrolls that one card into view and tints it the same soft green
  // ReportCard uses for its own "highlighted" state (see report-card.tsx) —
  // deliberately separate from `?task=`/openTaskId, which opens the detail
  // dialog outright. A notification should just point at the card, not force
  // the dialog open on someone's behalf.
  //
  // A plain classList add has nothing to animate against by default — the
  // inline transition below is what makes the tint fade out instead of
  // snapping off. The cleanup function un-tints unconditionally (not just
  // clearing the timer) — without that, clicking a second notification
  // before the first one's 2.2s ran out left the *previous* card stuck
  // green forever, since only the timeout (never cleanup) removed it.
  useEffect(() => {
    if (!highlightTaskId) return;
    const el = document.getElementById(`task-card-${highlightTaskId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const highlightClasses = ["bg-[var(--accent)]", "border-[var(--brand-green)]/50"];
    // The card's own base classes (bg-white, border-[var(--line)]) sit at the
    // same specificity — swap them out instead of layering the tint on top,
    // same "one or the other" approach report-card.tsx's className ternary
    // already relies on for its own highlighted state.
    const baseClasses = ["bg-white", "border-[var(--line)]"];
    el.style.transitionProperty = "background-color, border-color";
    el.style.transitionDuration = "1200ms";
    el.style.transitionTimingFunction = "ease-out";
    el.classList.remove(...baseClasses);
    el.classList.add(...highlightClasses);
    const timeout = setTimeout(() => {
      el.classList.remove(...highlightClasses);
      el.classList.add(...baseClasses);
    }, 2200);
    return () => {
      clearTimeout(timeout);
      el.classList.remove(...highlightClasses);
      el.classList.add(...baseClasses);
    };
  }, [highlightTaskId]);

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
  // groupBy==="status" splits into 4 mutually-exclusive columns, not 3:
  // "เลยกำหนด" is derived (dueUrgency==="overdue" && status!=="done"), not a
  // real TaskStatus, and pulls from BOTH "todo" and "in_progress" — every
  // non-done overdue task lands here regardless of whether anyone's started
  // it, so the 4 columns always sum to the full filtered total with no task
  // counted twice. Which of the two it came from still matters though (a
  // touched-but-late task reads differently from an untouched one), so
  // KanbanColumn/TaskCard tag each overdue card with its real underlying
  // status instead of losing that distinction.
  const columns: BoardColumn[] = useMemo(() => {
    if (groupBy === "status") {
      const overdueIds = new Set(
        filtered.filter((t) => t.status !== "done" && dueUrgency(t) === "overdue").map((t) => t.id)
      );
      return [
        {
          id: "todo" as const,
          label: statusMeta.todo.label,
          accent: chartColors.gray,
          icon: statusIcon.todo,
          tasks: filtered.filter((t) => t.status === "todo" && !overdueIds.has(t.id)),
        },
        {
          id: "in_progress" as const,
          label: statusMeta.in_progress.label,
          accent: statusAccent.in_progress,
          icon: statusIcon.in_progress,
          tasks: filtered.filter((t) => t.status === "in_progress" && !overdueIds.has(t.id)),
        },
        {
          id: "overdue",
          label: "เลยกำหนด",
          accent: chartColors.red,
          icon: AlarmClockOff,
          tasks: filtered.filter((t) => overdueIds.has(t.id)),
          derived: true,
          emptyMessage: "ไม่มีงานเลยกำหนด 🎉",
        },
        {
          id: "done" as const,
          label: statusMeta.done.label,
          accent: statusAccent.done,
          icon: statusIcon.done,
          tasks: filtered.filter((t) => t.status === "done"),
        },
      ];
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
      // "เลยกำหนด" is derived from the due date, not a real status — it fills
      // itself in and empties itself out as dates pass, so there's nothing
      // to set by dropping a card there (§5).
      if (targetColumnId === "overdue") {
        toast.error("คอลัมน์ \"เลยกำหนด\" คำนวณจากวันครบกำหนดอัตโนมัติ ลากเข้าไม่ได้");
        return;
      }
      // A card sitting in "เลยกำหนด" only has one real drag exit: mark it
      // done. Dragging it to "รอดำเนินการ"/"กำลังทำ" instead wouldn't do
      // anything visible — it's still overdue, so it'd just re-derive right
      // back into "เลยกำหนด" next render. The actual way out of those two is
      // editing the due date (task detail sheet), not a drag.
      if (task.status !== "done" && dueUrgency(task) === "overdue" && targetColumnId !== "done") {
        toast.error("งานนี้เลยกำหนดอยู่ — ลากไปแค่ \"เสร็จสิ้น\" ได้ ถ้าจะย้ายไปคอลัมน์อื่นต้องเลื่อนวันครบกำหนดก่อน");
        return;
      }
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
        <span className="ml-auto text-xs text-[var(--ink-soft)]">{filtered.length} งาน</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="ไม่พบงานตามตัวกรอง"
          description="ลองปรับตัวกรอง หรือกดล้างเพื่อดูงานทั้งหมด"
          action={
            <button
              onClick={resetFilters}
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
                boardTotal={filtered.length}
                onOpen={setOpenTaskId}
                onHeaderClick={groupBy === "assignee" ? () => setPersonTopicsFor(column.id) : undefined}
              />
            ))}
          </div>
          <DragOverlay>{activeTask ? <TaskCardOverlay task={activeTask} /> : null}</DragOverlay>
        </DndContext>
      )}

      <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && closeTaskSheet()} />

      <PersonTopicsDialog
        personId={personTopicsFor}
        onOpenChange={(open) => !open && setPersonTopicsFor(null)}
        onOpenTask={(taskId) => {
          setPersonTopicsFor(null);
          setOpenTaskId(taskId);
        }}
      />
    </>
  );
}
