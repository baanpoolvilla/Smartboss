"use client";

import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  type ColumnDef,
  type Row,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/modules/report_task/components/ui/table";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/modules/report_task/components/ui/dropdown-menu";
import { useIsMobile } from "@/modules/report_task/hooks/use-is-mobile";
import { useShowMore } from "@/modules/report_task/hooks/use-show-more";
import { ShowMoreToggle } from "@/modules/report_task/components/shared/show-more-toggle";
import { DueDateBadge } from "@/modules/report_task/components/shared/due-date-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Button } from "@/modules/report_task/components/ui/button";
import { getUser } from "@/modules/report_task/lib/directory";
import { statusMeta, priorityMeta, statusIcon, taskStatusOrder, taskPriorityOrder } from "@/modules/report_task/lib/task-meta";
import { formatShortDate } from "@/modules/report_task/lib/format";
import { dueUrgency, reactionCounts, sortTasksForDisplay } from "@/modules/report_task/lib/task-flags";
import { isTaskFullyDone, remainingChecklistCount } from "@/modules/report_task/lib/task-completion";
import { canEditRecord } from "@/modules/report_task/lib/permissions";
import { cn } from "@/modules/report_task/lib/utils";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { ArrowDown, ArrowUp, ArrowUpDown, MessageSquare, Paperclip, ListTodo, ChevronDown, X, CheckCircle2, SearchX, Info, SlidersHorizontal } from "lucide-react";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import type { Task, TaskStatus, TaskPriority } from "@/modules/report_task/types";
import { toast } from "sonner";

type GroupBy = "none" | "status" | "priority";

const groupByLabels: Record<GroupBy, string> = {
  none: "ไม่จัดกลุ่ม",
  status: "จัดกลุ่ม: สถานะ",
  priority: "จัดกลุ่ม: ความสำคัญ",
};

interface GridRowProps {
  row: Row<Task>;
  groupHeader: React.ReactNode;
  isSelected: boolean;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
}

/**
 * One table row, memoized on the underlying task object rather than the
 * TanStack `Row` wrapper (which is recreated whenever the table's `data`
 * array gets a new reference, i.e. on every store mutation anywhere in the
 * app). Editing one task no longer re-renders every other visible row.
 */
const GridRow = memo(
  function GridRow({ row, groupHeader, isSelected, onOpen, onToggleSelect }: GridRowProps) {
    const rowId = row.original.id;
    return (
      <React.Fragment>
        {groupHeader}
        <TableRow
          className={cn(
            "group cursor-pointer border-b border-[var(--line)]/70 transition-colors",
            isSelected ? "bg-[color-mix(in_srgb,var(--brand-green)_8%,white)]" : "hover:bg-[var(--accent)]/40"
          )}
          onClick={() => onOpen(rowId)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen(rowId);
            }
          }}
        >
          <TableCell
            className={cn(
              "pl-4 pr-0 w-10 sticky left-0 z-10",
              isSelected ? "bg-[color-mix(in_srgb,var(--brand-green)_8%,white)]" : "bg-white"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(rowId);
            }}
          >
            <Checkbox checked={isSelected} aria-label="เลือกงานนี้" />
          </TableCell>
          {row.getVisibleCells().map((cell) => (
            <TableCell
              key={cell.id}
              className={cn(
                "px-4 py-3 whitespace-nowrap",
                // Matches the sticky title header above — same column stays
                // frozen at the same left offset (40px, the checkbox
                // column's own width) as the row scrolls horizontally.
                cell.column.id === "title" &&
                  cn("sticky left-10 z-10", isSelected ? "bg-[color-mix(in_srgb,var(--brand-green)_8%,white)]" : "bg-white")
              )}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          ))}
        </TableRow>
      </React.Fragment>
    );
  },
  (prev, next) =>
    prev.row.original === next.row.original &&
    prev.groupHeader === next.groupHeader &&
    prev.isSelected === next.isSelected &&
    prev.onOpen === next.onOpen &&
    prev.onToggleSelect === next.onToggleSelect
);

/**
 * Grid (table) view of the same task data behind the Kanban board — the
 * "Planner Grid / ClickUp List" view: sortable, groupable, with a checklist
 * progress column and a summary footer for scanning many tasks at once.
 */
export function TaskGrid({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  // Empty — no single column is "actively sorted" by default, so the table
  // keeps `defaultOrderedTasks`'s own combined order (priority, then due
  // date within it) below instead of TanStack re-sorting by one lone column.
  // Clicking a column header still overrides this with a plain single-column
  // sort, same as before.
  const [sorting, setSorting] = useState<SortingState>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const isMobile = useIsMobile();
  // <640px only — the 9-column table collapses into a compact list instead
  // (see the render below); these control that list, not the desktop table.
  const [mobileFields, setMobileFields] = useState({ status: true, priority: true, due: true });
  const MOBILE_PAGE_SIZE = 15;
  const [mobileShowCount, setMobileShowCount] = useState(MOBILE_PAGE_SIZE);
  const stickers = useStickerStore((s) => s.stickers);
  const moveTask = useTaskStore((s) => s.moveTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const resetFilters = useTaskStore((s) => s.resetFilters);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);

  // Selection is a local set of ids, not derived from `tasks` — prune it
  // whenever the visible task list changes (filter/identity switch) so a
  // bulk action can't silently act on a task the user can no longer see.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visibleIds = new Set(tasks.map((t) => t.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [tasks]);

  const summary = useMemo(() => {
    const done = tasks.filter((t) => t.status === "done").length;
    const overdue = tasks.filter((t) => dueUrgency(t) === "overdue").length;
    const docked = tasks.filter((t) => t.penalty).length;
    return { total: tasks.length, done, overdue, docked };
  }, [tasks]);

  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        accessorKey: "title",
        header: "ชื่องาน",
        cell: ({ row }) => (
          <div className="max-w-[280px]">
            <p
              className={cn(
                "font-medium truncate",
                row.original.status === "done" && "line-through text-[var(--ink-soft)]"
              )}
            >
              {row.original.title}
            </p>
          </div>
        ),
      },
      {
        id: "assignee",
        header: "ผู้รับผิดชอบ",
        accessorFn: (t) => t.assigneeIds.length,
        cell: ({ row }) => {
          const t = row.original;
          const assignees = t.assigneeIds.map(getUser).filter(Boolean);
          if (assignees.length === 0) return <span className="text-xs text-[var(--ink-soft)]">—</span>;
          // Same "hover for the full list" pattern as the board card
          // (task-card.tsx) — capping the visible stack at 3 avatars is fine
          // as long as the rest aren't just lost behind a static "+N" badge.
          const fullList =
            assignees.length > 1
              ? `ผู้รับผิดชอบร่วม ${assignees.length} คน: ${assignees
                  .map((a) => {
                    const tags = [
                      t.mainAssigneeId === a!.id && "หัวหน้า",
                      (t.completedAssigneeIds ?? []).includes(a!.id) && "เสร็จแล้ว",
                    ].filter(Boolean);
                    return tags.length > 0 ? `${a!.name} (${tags.join(", ")})` : a!.name;
                  })
                  .join(", ")}`
              : assignees[0]?.name;
          return (
            <div className="flex items-center -space-x-1.5" title={fullList}>
              {assignees.slice(0, 3).map((a) => (
                <Avatar key={a!.id} className="h-6 w-6 ring-2 ring-white">
                  <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                    {a!.avatar}
                  </AvatarFallback>
                </Avatar>
              ))}
              {assignees.length > 3 && (
                <span className="h-6 w-6 rounded-full ring-2 ring-white bg-[var(--bg-soft)] text-[9px] text-[var(--ink-soft)] flex items-center justify-center">
                  +{assignees.length - 3}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "progress",
        header: "ความคืบหน้า",
        // Fraction of checklist items done — real "how much of the work is
        // finished," same formula for individual and group tasks. Used to
        // switch to a people-done fraction for groups (coarser: only 0/1 per
        // person, no in-between) out of worry it'd disagree with "สถานะ" —
        // that gap is closed now that moveTask refuses "เสร็จสิ้น" until the
        // checklist is actually complete (see task-completion.ts), so the two
        // can no longer disagree and checklist-based progress is strictly
        // more informative. Per-person completion is still surfaced, just as
        // a hover detail rather than the headline number (see cell below).
        accessorFn: (t) => (t.checklist.length ? t.checklist.filter((c) => c.done).length / t.checklist.length : -1),
        cell: ({ row }) => {
          const t = row.original;
          const isGroup = t.assigneeIds.length > 1;
          const total = t.checklist.length;
          if (total === 0) return <span className="text-xs text-[var(--line)]">—</span>;
          const done = t.checklist.filter((c) => c.done).length;
          const pct = Math.round((done / total) * 100);
          const complete = done === total;
          const peopleDone = t.completedAssigneeIds?.length ?? 0;
          return (
            <div className="flex items-center gap-2 min-w-[112px]">
              <div className="h-1.5 flex-1 rounded-full bg-[var(--bg-soft)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: complete ? "var(--chart-green)" : "var(--chart-amber)" }}
                />
              </div>
              <span
                className="flex items-center gap-0.5 text-[11px] tabular-nums text-[var(--ink-soft)] shrink-0"
                title={
                  isGroup
                    ? `${done}/${total} รายการ checklist เสร็จแล้ว · ${peopleDone}/${t.assigneeIds.length} คนเสร็จแล้ว`
                    : `${done}/${total} รายการ checklist เสร็จแล้ว`
                }
              >
                <ListTodo className="h-3 w-3" />
                {done}/{total}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "startDate",
        header: "เริ่ม",
        cell: ({ getValue }) => <span className="text-xs text-[var(--ink-soft)] whitespace-nowrap">{formatShortDate(getValue<string>())}</span>,
      },
      {
        accessorKey: "dueDate",
        header: "กำหนดส่ง",
        cell: ({ row }) => <DueDateBadge task={row.original} />,
      },
      {
        accessorKey: "status",
        header: "สถานะ",
        cell: ({ row }) => {
          const t = row.original;
          const s = t.status;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-1.5 h-6 text-[10px] font-medium whitespace-nowrap transition-shadow hover:shadow-sm",
                      statusMeta[s].badgeClass
                    )}
                    title="เปลี่ยนสถานะ"
                  >
                    {statusMeta[s].label}
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                }
              />
              <DropdownMenuContent align="start" className="w-40" onClick={(e) => e.stopPropagation()}>
                {taskStatusOrder.map((opt) => {
                  const OptIcon = statusIcon[opt];
                  return (
                    <DropdownMenuItem
                      key={opt}
                      onClick={() => {
                        if (opt === s) return;
                        if (opt === "done" && !isTaskFullyDone(t.assigneeIds, t.checklist)) {
                          toast.error(`"${t.title}" ยังติ๊ก checklist ไม่ครบ ${remainingChecklistCount(t.checklist)} ข้อ — ทำให้ครบก่อนถึงจะปิดงานได้`);
                          return;
                        }
                        moveTask(t.id, opt);
                      }}
                    >
                      <OptIcon className={cn("h-3.5 w-3.5", opt === s && "text-[var(--brand-green)]")} />
                      {statusMeta[opt].label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
      {
        accessorKey: "priority",
        header: "ความสำคัญ",
        cell: ({ row }) => {
          const t = row.original;
          const p = t.priority;
          const canEdit = canEditRecord(t.assignedById, t.departmentIds, viewingAsUserId);
          if (!canEdit) {
            return (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-1.5 h-6 text-[10px] font-medium whitespace-nowrap",
                  priorityMeta[p].badgeClass
                )}
                title="แก้ไขได้เฉพาะผู้สร้างงาน"
              >
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: priorityMeta[p].accentColor }} />
                {priorityMeta[p].label}
              </span>
            );
          }
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-1.5 h-6 text-[10px] font-medium whitespace-nowrap transition-shadow hover:shadow-sm",
                      priorityMeta[p].badgeClass
                    )}
                    title="เปลี่ยนความสำคัญ"
                  >
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: priorityMeta[p].accentColor }} />
                    {priorityMeta[p].label}
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                }
              />
              <DropdownMenuContent align="start" className="w-36" onClick={(e) => e.stopPropagation()}>
                {taskPriorityOrder.map((opt) => (
                  <DropdownMenuItem key={opt} onClick={() => opt !== p && updateTask(t.id, { priority: opt })}>
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: priorityMeta[opt].accentColor }} />
                    {priorityMeta[opt].label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
      {
        id: "reactions",
        header: "สติกเกอร์",
        cell: ({ row }) => {
          const t = row.original;
          const entries = Object.entries(reactionCounts(t));
          if (entries.length === 0 && !t.penalty) {
            return <span className="text-xs text-[var(--line)]">—</span>;
          }
          return (
            <div className="flex flex-wrap items-center gap-1">
              {t.penalty && (
                <span
                  title={`ถูกหัก ${Math.abs(t.penalty.points)} คะแนน (เลยกำหนด)`}
                  className="inline-flex items-center h-5 rounded-md px-1.5 text-[10px] font-semibold text-white bg-red-600 tabular-nums"
                >
                  −{Math.abs(t.penalty.points)}
                </span>
              )}
              {entries.map(([stickerId, count]) => {
                const sticker = stickers.find((s) => s.id === stickerId);
                if (!sticker) return null;
                return (
                  <span
                    key={stickerId}
                    title={`${sticker.label} (${sticker.points > 0 ? `+${sticker.points}` : sticker.points})`}
                    className="inline-flex items-center gap-0.5 h-5 rounded-full bg-[var(--bg-soft)] px-1.5 text-[11px]"
                  >
                    <span>{sticker.emoji}</span>
                    {count > 1 && <span className="text-[var(--ink-soft)] text-[10px]">{count}</span>}
                  </span>
                );
              })}
            </div>
          );
        },
      },
      {
        id: "meta",
        header: "ไฟล์ / คอมเมนต์",
        cell: ({ row }) => {
          const t = row.original;
          if (t.comments.length === 0 && t.attachments.length === 0) {
            return <span className="text-xs text-[var(--line)]">—</span>;
          }
          return (
            <div className="flex items-center gap-2 text-[var(--ink-soft)]">
              {t.comments.length > 0 && (
                <span className="flex items-center gap-0.5 text-[11px]">
                  <MessageSquare className="h-3 w-3" /> {t.comments.length}
                </span>
              )}
              {t.attachments.length > 0 && (
                <span className="flex items-center gap-0.5 text-[11px]">
                  <Paperclip className="h-3 w-3" /> {t.attachments.length}
                </span>
              )}
            </div>
          );
        },
      },
    ],
    [stickers, moveTask, updateTask, viewingAsUserId]
  );

  // Default row order (before any column header is clicked): the same
  // combined priority-then-due-date ordering the Kanban board's cards use
  // (sortTasksForDisplay) — a plain "กำหนดส่ง ascending" default buried
  // ด่วนมาก tasks anywhere their due date happened to fall, instead of near
  // the top regardless of date.
  const defaultOrderedTasks = useMemo(() => sortTasksForDisplay(tasks), [tasks]);

  const table = useReactTable({
    data: defaultOrderedTasks,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const colCount = table.getVisibleFlatColumns().length;

  // Manual grouping: TanStack's grouped/expanded row models loop under this
  // project's React Compiler, so we group the already-sorted rows ourselves —
  // a stable sort by group key keeps each row's in-group order (e.g. due date).
  const groupValue = (r: Row<Task>) => (groupBy === "status" ? r.original.status : r.original.priority);
  const groupOrder = (v: string) =>
    groupBy === "status"
      ? taskStatusOrder.indexOf(v as Task["status"])
      : taskPriorityOrder.indexOf(v as Task["priority"]);
  const groupLabel = (v: string) =>
    groupBy === "status"
      ? statusMeta[v as Task["status"]]?.label ?? v
      : priorityMeta[v as Task["priority"]]?.label ?? v;

  const baseRows = table.getRowModel().rows;
  const rows =
    groupBy === "none"
      ? baseRows
      : [...baseRows].sort((a, b) => groupOrder(groupValue(a)) - groupOrder(groupValue(b)));

  // Manual pagination (not TanStack's getPaginationRowModel) — it would
  // paginate before the manual grouping above runs, splitting a group's rows
  // across pages in whatever order the raw row model happens to produce.
  // "แสดงเพิ่มเติม" (same pattern as the Kanban board's own columns and the
  // Dashboard's capped lists — useShowMore/ShowMoreToggle) instead of a
  // page-1/2/3 pager — fills the page with rows up front, then reveals the
  // rest on demand with a way back ("แสดงน้อยลง"), rather than forcing a
  // click through numbered pages to see more.
  const GRID_PAGE_SIZE = 10;
  const { visible: pagedRows, remaining: gridRemaining, expanded: gridExpanded, toggle: toggleGridExpanded } = useShowMore(rows, GRID_PAGE_SIZE);

  // Multi-select + bulk actions (ClickUp-style).
  const visibleIds = rows.map((r) => r.original.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const selCount = selected.size;

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visibleIds));
  }
  function clearSelection() {
    setSelected(new Set());
  }
  function bulkStatus(s: TaskStatus) {
    if (s === "done") {
      const selectedTasks = tasks.filter((t) => selected.has(t.id));
      const ready = selectedTasks.filter((t) => isTaskFullyDone(t.assigneeIds, t.checklist));
      const skipped = selectedTasks.length - ready.length;
      ready.forEach((t) => moveTask(t.id, s));
      toast[skipped > 0 ? "error" : "success"](
        skipped > 0
          ? `ปิดงานได้ ${ready.length} งาน — ข้าม ${skipped} งานที่ checklist ยังไม่ครบ`
          : `เปลี่ยน ${ready.length} งาน เป็น "${statusMeta[s].label}"`
      );
      clearSelection();
      return;
    }
    selected.forEach((id) => moveTask(id, s));
    toast.success(`เปลี่ยน ${selCount} งาน เป็น "${statusMeta[s].label}"`);
    clearSelection();
  }
  function bulkPriority(p: TaskPriority) {
    const editable = tasks.filter((t) => selected.has(t.id) && canEditRecord(t.assignedById, t.departmentIds, viewingAsUserId));
    editable.forEach((t) => updateTask(t.id, { priority: p }));
    const skipped = selCount - editable.length;
    toast.success(
      skipped > 0
        ? `ตั้งความสำคัญ ${editable.length} งาน เป็น "${priorityMeta[p].label}" (ข้าม ${skipped} งานที่ไม่ใช่ผู้สร้าง)`
        : `ตั้งความสำคัญ ${selCount} งาน เป็น "${priorityMeta[p].label}"`
    );
    clearSelection();
  }
  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar: group-by + summary chips */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={groupBy} onValueChange={(v) => v && setGroupBy(v as GroupBy)}>
          <SelectTrigger className="w-[180px] bg-white h-9">
            <SelectValue>{groupByLabels[groupBy]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(groupByLabels) as GroupBy[]).map((g) => (
              <SelectItem key={g} value={g}>{groupByLabels[g]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Column sort explainer — meaningless on the mobile list (no
            clickable column headers there), desktop table only. */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button type="button" className="hidden sm:inline-flex text-[var(--ink-soft)] hover:text-[var(--ink)]" aria-label="วิธีเรียงลำดับตาราง">
                <Info className="h-3.5 w-3.5" />
              </button>
            }
          />
          <TooltipContent className="max-w-[260px]">
            คลิกที่หัวคอลัมน์ไหนก็ได้เพื่อเรียงตามคอลัมน์นั้น — ลูกศรขึ้น (↑) = น้อยไปมาก, ลูกศรลง (↓) = มากไปน้อย
            คลิกซ้ำที่คอลัมน์เดิมเพื่อสลับทิศทาง คลิกครั้งที่ 3 เพื่อยกเลิกการเรียง
          </TooltipContent>
        </Tooltip>

        <div className="flex items-center gap-2 ml-auto text-[11px]">
          <SummaryChip label="ทั้งหมด" value={summary.total} />
          <SummaryChip label="เสร็จ" value={summary.done} tone="good" />
          <SummaryChip label="เลยกำหนด" value={summary.overdue} tone="bad" />
          {summary.docked > 0 && <SummaryChip label="ถูกหัก" value={summary.docked} tone="bad" />}

          {/* <640px only — the mobile list's line 2 shows สถานะ/ความสำคัญ/
              กำหนดส่ง by default; this toggles which of those actually show,
              since a compact row has less room than a full table column. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="sm:hidden inline-flex items-center gap-1 h-8 rounded-lg bg-white ring-1 ring-inset ring-[var(--line)] px-2.5 text-xs font-medium hover:bg-[var(--bg-soft)]"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" /> ฟิลด์ที่แสดง
                </button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuCheckboxItem
                checked={mobileFields.status}
                onCheckedChange={(v) => setMobileFields((f) => ({ ...f, status: !!v }))}
              >
                สถานะ
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={mobileFields.priority}
                onCheckedChange={(v) => setMobileFields((f) => ({ ...f, priority: !!v }))}
              >
                ความสำคัญ
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={mobileFields.due}
                onCheckedChange={(v) => setMobileFields((f) => ({ ...f, due: !!v }))}
              >
                กำหนดส่ง
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Bulk-action bar — appears when rows are selected */}
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
              onClick={clearSelection}
              className="inline-flex items-center gap-1 h-8 rounded-lg text-[var(--ink-soft)] px-2 text-xs hover:bg-white hover:text-[var(--ink)]"
            >
              <X className="h-3.5 w-3.5" /> ล้าง
            </button>
          </div>
        </div>
      )}

      {/* ≥640px: the real 9-column table, unchanged. <640px renders the
          compact list below instead — a 9-column table squeezed into a phone
          width is unusable even with the sticky title column, so mobile gets
          a genuinely different structure rather than a squeezed-down table. */}
      {!isMobile && (
      <div className="rounded-xl border border-[var(--line)] bg-white overflow-hidden shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="border-b border-[var(--line)] hover:bg-transparent">
                  <TableHead className="h-11 w-10 pl-4 pr-0 sticky left-0 z-20 bg-[var(--bg-soft)]">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="เลือกทั้งหมด" />
                  </TableHead>
                  {hg.headers.map((header) => {
                    const sortDir = header.column.getIsSorted();
                    const sortable = header.column.getCanSort();
                    const headerText = typeof header.column.columnDef.header === "string" ? header.column.columnDef.header : "";
                    const sortTitle = !sortable
                      ? undefined
                      : sortDir === "asc"
                        ? `กำลังเรียงตาม "${headerText}" จากน้อยไปมาก — คลิกเพื่อสลับเป็นมากไปน้อย`
                        : sortDir === "desc"
                          ? `กำลังเรียงตาม "${headerText}" จากมากไปน้อย — คลิกเพื่อยกเลิกการเรียง`
                          : `คลิกเพื่อเรียงตาม "${headerText}"`;
                    return (
                      <TableHead
                        key={header.id}
                        title={sortTitle}
                        className={cn(
                          "h-11 px-4 bg-[var(--bg-soft)]/70 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-soft)] whitespace-nowrap select-none",
                          sortable && "cursor-pointer hover:text-[var(--ink)] transition-colors",
                          // "ชื่องาน" stays frozen in place while the other 8
                          // columns scroll underneath it — the table's 9
                          // columns run wider than the viewport, and without
                          // this, scrolling right to see e.g. priority/status
                          // loses all context for which row you're even on.
                          header.column.id === "title" && "sticky left-10 z-20 bg-[var(--bg-soft)]"
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <span className="flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortable && (
                            <>
                              {sortDir === "asc" && <ArrowUp className="h-3 w-3 text-[var(--brand-green)]" />}
                              {sortDir === "desc" && <ArrowDown className="h-3 w-3 text-[var(--brand-green)]" />}
                              {!sortDir && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                            </>
                          )}
                        </span>
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {pagedRows.map((row, i) => {
                const rowId = row.original.id;

                // Insert a group header row whenever the group value changes
                // — re-shown at the top of a page too (i === 0), so a group
                // that spans a page boundary still reads clearly on page 2.
                let header: React.ReactNode = null;
                if (groupBy !== "none") {
                  const value = groupValue(row);
                  const prevValue = i > 0 ? groupValue(pagedRows[i - 1]!) : undefined;
                  if (value !== prevValue) {
                    const count = rows.filter((r) => groupValue(r) === value).length;
                    header = (
                      <TableRow className="bg-[var(--bg-soft)] hover:bg-[var(--bg-soft)] border-b border-[var(--line)]">
                        <TableCell colSpan={colCount + 1} className="px-4 py-2.5">
                          <span className="flex items-center gap-2 text-sm font-semibold">
                            {groupLabel(value)}
                            <Badge variant="outline" className="text-[11px] text-[var(--ink-soft)] bg-white border-[var(--line)]">
                              {count}
                            </Badge>
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  }
                }

                return (
                  <GridRow
                    key={row.id}
                    row={row}
                    groupHeader={header}
                    isSelected={selected.has(rowId)}
                    onOpen={onOpen}
                    onToggleSelect={toggleOne}
                  />
                );
              })}
              {rows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={colCount + 1} className="p-4">
                    <EmptyState
                      icon={SearchX}
                      title="ไม่พบงานตามตัวกรอง"
                      description="ลองปรับหรือล้างตัวกรองด้านบน"
                      className="border-0"
                      action={
                        <Button variant="outline" size="sm" onClick={resetFilters}>
                          ล้างตัวกรองทั้งหมด
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {(gridExpanded || gridRemaining > 0) && (
          <div className="border-t border-[var(--line)] px-4 py-2.5">
            <ShowMoreToggle expanded={gridExpanded} remaining={gridRemaining} onToggle={toggleGridExpanded} />
          </div>
        )}
      </div>
      )}

      {/* <640px: compact list — line 1 is title + avatar, line 2 is
          สถานะ/ความสำคัญ/กำหนดส่ง (per "ฟิลด์ที่แสดง" above), same tap-to-open
          as the desktop table's rows. No checkboxes/bulk-actions here — those
          stay desktop-only, a phone-width row has no room for them and a
          management bulk-select isn't a phone-first action anyway. */}
      {isMobile && (
        <div className="rounded-xl border border-[var(--line)] bg-white overflow-hidden shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          {rows.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="ไม่พบงานตามตัวกรอง"
              description="ลองปรับหรือล้างตัวกรองด้านบน"
              className="border-0"
              action={
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  ล้างตัวกรองทั้งหมด
                </Button>
              }
            />
          ) : (
            <>
              {rows.slice(0, mobileShowCount).map((row, i) => {
                const t = row.original;
                const assignees = t.assigneeIds.map(getUser).filter(Boolean);
                let groupHeader: React.ReactNode = null;
                if (groupBy !== "none") {
                  const value = groupValue(row);
                  const visibleSlice = rows.slice(0, mobileShowCount);
                  const prevValue = i > 0 ? groupValue(visibleSlice[i - 1]!) : undefined;
                  if (value !== prevValue) {
                    const count = rows.filter((r) => groupValue(r) === value).length;
                    groupHeader = (
                      <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg-soft)] px-4 py-2 text-sm font-semibold">
                        {groupLabel(value)}
                        <Badge variant="outline" className="text-[11px] text-[var(--ink-soft)] bg-white border-[var(--line)]">
                          {count}
                        </Badge>
                      </div>
                    );
                  }
                }
                return (
                  <div key={row.id}>
                    {groupHeader}
                    <button
                      type="button"
                      onClick={() => onOpen(t.id)}
                      className="flex w-full flex-col gap-1 border-b border-[var(--line)] px-4 py-3 text-left last:border-b-0 hover:bg-[var(--bg-soft)]"
                    >
                      <div className="flex items-center gap-2">
                        <p className={cn("min-w-0 flex-1 truncate text-sm font-medium", t.status === "done" && "line-through text-[var(--ink-soft)]")}>
                          {t.title}
                        </p>
                        {assignees.length > 0 && (
                          <div className="flex items-center -space-x-1.5 shrink-0">
                            {assignees.slice(0, 3).map((a) => (
                              <Avatar key={a!.id} className="h-6 w-6 ring-2 ring-white">
                                <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                                  {a!.avatar}
                                </AvatarFallback>
                              </Avatar>
                            ))}
                            {assignees.length > 3 && (
                              <span className="h-6 w-6 rounded-full ring-2 ring-white bg-[var(--bg-soft)] text-[9px] text-[var(--ink-soft)] flex items-center justify-center">
                                +{assignees.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {mobileFields.status && (
                          <span className={cn("inline-flex items-center rounded-md border px-1.5 h-5 text-[10px] font-medium whitespace-nowrap", statusMeta[t.status].badgeClass)}>
                            {statusMeta[t.status].label}
                          </span>
                        )}
                        {mobileFields.priority && (
                          <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 h-5 text-[10px] font-medium whitespace-nowrap", priorityMeta[t.priority].badgeClass)}>
                            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: priorityMeta[t.priority].accentColor }} />
                            {priorityMeta[t.priority].label}
                          </span>
                        )}
                        {mobileFields.due && <DueDateBadge task={t} className="text-[10px]" />}
                      </div>
                    </button>
                  </div>
                );
              })}
              {mobileShowCount < rows.length && (
                <div className="flex justify-center border-t border-[var(--line)] p-3">
                  <button
                    type="button"
                    onClick={() => setMobileShowCount((n) => n + MOBILE_PAGE_SIZE)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3.5 py-1.5 text-xs font-medium text-[var(--ink)] shadow-sm hover:bg-[var(--bg-soft)]"
                  >
                    แสดงเพิ่มเติม {rows.length - mobileShowCount} รายการ
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryChip({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "good" | "bad" }) {
  const valueClass = {
    neutral: "text-[var(--ink)]",
    good: "text-[var(--chart-green)]",
    bad: "text-[var(--chart-red)]",
  }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-inset ring-[var(--line)] px-2.5 py-1.5">
      <span className="text-[var(--ink-soft)]">{label}</span>
      <span className={cn("font-semibold tabular-nums", valueClass)}>{value}</span>
    </span>
  );
}
