"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { dueUrgency, sortTasksForDisplay } from "@/modules/report_task/lib/task-flags";
import { getDepartment, users } from "@/modules/report_task/lib/directory";
import { statusMeta, priorityMeta, priorityColorHex, taskPriorityOrder, statusIcon } from "@/modules/report_task/lib/task-meta";
import { matchesTaskFilters } from "@/modules/report_task/lib/task-filter";
import { useTaskSheetParam } from "@/modules/report_task/hooks/use-task-sheet-param";
import { statusColors, chartColors } from "@/modules/report_task/lib/chart-colors";
import { cn } from "@/modules/report_task/lib/utils";
import { KanbanColumn, type BoardColumn } from "./kanban-column";
import { TaskDetailSheet } from "./task-detail-sheet";
import { PersonTopicsBoard } from "./person-topics-board";
import { toast } from "sonner";
import { useTaskBoardIntentStore } from "@/modules/report_task/store/task-board-intent-store";
import { Info, SearchX, AlarmClockOff, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";

export type GroupBy = "status" | "priority" | "assignee";

export const groupByLabels: Record<GroupBy, string> = {
  status: "สถานะ",
  priority: "ความสำคัญ",
  assignee: "ผู้รับผิดชอบ",
};

const statusAccent = statusColors;
const priorityAccent = priorityColorHex;

export function KanbanBoard({ groupBy }: { groupBy: GroupBy }) {
  const storeTasks = useTaskStore((s) => s.tasks);
  const filters = useTaskStore((s) => s.filters);
  const setFilters = useTaskStore((s) => s.setFilters);
  const resetFilters = useTaskStore((s) => s.resetFilters);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  // A department head sees the whole board; everyone else only sees tasks
  // they're assigned to or created — a coworker's task no longer appears.
  const allTasks = useMemo(
    () => storeTasks.filter((t) => canSeeTask(t, viewingAsUserId)),
    [storeTasks, viewingAsUserId]
  );

  // Mirrored into the `?task=` URL param (see the hook) so the browser Back
  // button closes the sheet before leaving the page — falls back to the
  // one-shot navigation intent (dashboard chart click) when there's no
  // `?task=` in the URL yet.
  const { openTaskId, open: setOpenTaskId, close: closeTaskSheet } = useTaskSheetParam(
    useTaskBoardIntentStore.getState().openTaskId
  );
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Separate from `?task=` (which opens the detail dialog) — a notification
  // link should point out which card it's about without forcing the dialog
  // open, so whoever clicked it can look at the board first and decide
  // whether to open it themselves.
  const highlightTaskId = searchParams.get("highlight");
  // Set only when the board is grouped by assignee and someone clicks a
  // person's column header — swaps the whole board out for PersonTopicsBoard
  // (a real page-feeling nav via `?person=`, not a popup: pushed so the
  // browser Back button returns to the board, same convention as `?task=`).
  const personBoardId = searchParams.get("person");
  function openPersonBoard(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("person", id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }
  function closePersonBoard() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("person");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

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
      // "เลยกำหนดเท่านั้น" already narrows `filtered` down to overdue tasks
      // only — under that filter, "รอดำเนินการ"/"กำลังทำ"/"เสร็จสิ้น" aren't
      // just usually empty here, they're GUARANTEED empty (every task left in
      // `filtered` is, by definition, todo/in_progress AND overdue, so it
      // lands in the "เลยกำหนด" bucket every time). Showing 3 permanently-dead
      // columns next to the one that matters is pure clutter — collapse to a
      // single column instead of rendering columns that can never hold anything.
      if (filters.penalty === "overdue") {
        return [
          {
            id: "overdue",
            label: "เลยกำหนด",
            accent: chartColors.red,
            icon: AlarmClockOff,
            tasks: sortTasksForDisplay(filtered),
            derived: true,
            emptyMessage: "ไม่มีงานเลยกำหนด 🎉",
          },
        ];
      }
      return [
        {
          id: "todo" as const,
          label: statusMeta.todo.label,
          accent: chartColors.gray,
          icon: statusIcon.todo,
          tasks: sortTasksForDisplay(filtered.filter((t) => t.status === "todo" && !overdueIds.has(t.id))),
        },
        {
          id: "in_progress" as const,
          label: statusMeta.in_progress.label,
          accent: statusAccent.in_progress,
          icon: statusIcon.in_progress,
          tasks: sortTasksForDisplay(filtered.filter((t) => t.status === "in_progress" && !overdueIds.has(t.id))),
        },
        {
          id: "overdue",
          label: "เลยกำหนด",
          accent: chartColors.red,
          icon: AlarmClockOff,
          tasks: sortTasksForDisplay(filtered.filter((t) => overdueIds.has(t.id))),
          derived: true,
          emptyMessage: "ไม่มีงานเลยกำหนด 🎉",
        },
        {
          id: "done" as const,
          label: statusMeta.done.label,
          accent: statusAccent.done,
          icon: statusIcon.done,
          tasks: sortTasksForDisplay(filtered.filter((t) => t.status === "done")),
        },
      ];
    }
    if (groupBy === "priority") {
      return taskPriorityOrder.map((p) => ({
        id: p,
        label: priorityMeta[p].label,
        accent: priorityAccent[p],
        tasks: sortTasksForDisplay(filtered.filter((t) => t.priority === p)),
      }));
    }
    // assignee — only people who actually have tasks in view
    return users
      .map((u) => ({
        id: u.id,
        label: u.name,
        accent: chartColors.blue,
        tasks: sortTasksForDisplay(filtered.filter((t) => t.assigneeIds.includes(u.id))),
      }))
      .filter((c) => c.tasks.length > 0);
  }, [groupBy, filtered, filters.penalty]);

  // Columns can run wider than the viewport (grouping by assignee especially
  // — one column per employee) with nothing to hint that more sit off-screen
  // besides the bare scrollbar. Track scroll position so left/right arrow
  // buttons can show up only on the side there's actually more to see.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateScrollState() {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    updateScrollState();
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => updateScrollState();
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
    // Column count/widths change with groupBy and the filtered task list —
    // re-measure whenever either could have changed what's scrollable.
  }, [columns]);

  function scrollBoard(direction: -1 | 1) {
    // One column + its gap (basis-[300px] + gap-4) — a full "next column
    // into view" step rather than an arbitrary pixel jump.
    scrollerRef.current?.scrollBy({ left: direction * 316, behavior: "smooth" });
  }

  // Click-and-drag panning on empty board background — assignee grouping
  // only (that's the view with by far the most columns, one per employee).
  // Status/priority stay scroll-wheel/button-only since they rarely exceed
  // 3-4 columns. Anything that's an actual card or a real control
  // (button/link/header click) is left alone for its own onClick — panning
  // only starts from a pointerdown that lands on genuinely empty background.
  const panRef = useRef<{ startX: number; startScrollLeft: number; pointerId: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  function handlePanPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (groupBy !== "assignee") return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[id^="task-card-"], button, a, input, select, textarea, [role="button"]')) return;
    const el = scrollerRef.current;
    if (!el) return;
    panRef.current = { startX: e.clientX, startScrollLeft: el.scrollLeft, pointerId: e.pointerId };
    el.setPointerCapture(e.pointerId);
    setIsPanning(true);
  }

  function handlePanPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    const el = scrollerRef.current;
    if (!pan || !el || pan.pointerId !== e.pointerId) return;
    el.scrollLeft = pan.startScrollLeft - (e.clientX - pan.startX);
  }

  function endPan(e: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== e.pointerId) return;
    scrollerRef.current?.releasePointerCapture(e.pointerId);
    panRef.current = null;
    setIsPanning(false);
  }

  const sharedCount = useMemo(() => filtered.filter((t) => t.assigneeIds.length > 1).length, [filtered]);

  if (personBoardId) {
    return (
      <>
        <PersonTopicsBoard personId={personBoardId} onBack={closePersonBoard} onOpenTask={setOpenTaskId} />
        <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && closeTaskSheet()} />
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* จัดกลุ่มตามอยู่ในแถบตัวกรองด้านบนแล้ว (TaskFilters) — เหลือแค่บริบท
          ที่ผูกกับตัวเลือกนั้นโดยตรง: หมายเหตุตอนจัดกลุ่มตามคน + ยอดรวม */}
      <div className="flex shrink-0 items-center gap-2 pb-2">
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
        <>
          {/* Buttons anchor to a fixed offset near the column headers (~top
              center of the header card), not a vertical center of the whole
              scroll area — a column can run to dozens of cards tall, and
              centering across that would push the button far from the
              header, off in the middle of someone's card list. */}
          <div className="relative min-h-0 flex-1">
            {canScrollLeft && (
              <>
                <div className="pointer-events-none absolute top-0 left-0 z-10 h-24 w-10 bg-gradient-to-r from-[var(--bg)] to-transparent" />
                <button
                  onClick={() => scrollBoard(-1)}
                  aria-label="เลื่อนบอร์ดไปทางซ้าย"
                  className="absolute left-1 top-10 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--ink-soft)] shadow-md hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </>
            )}
            {canScrollRight && (
              <>
                <div className="pointer-events-none absolute top-0 right-0 z-10 h-24 w-10 bg-gradient-to-l from-[var(--bg)] to-transparent" />
                <button
                  onClick={() => scrollBoard(1)}
                  aria-label="เลื่อนบอร์ดไปทางขวา"
                  className="absolute right-1 top-10 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--ink-soft)] shadow-md hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
            {/* h-full — each column stretches to fill this row's height
                (KanbanColumn's own root has h-full min-h-0) and scrolls its
                OWN card list internally instead of growing the row past the
                viewport; overflow-x is the only scroll this row itself
                needs (too many columns to fit side by side). */}
            <div
              ref={scrollerRef}
              onPointerDown={handlePanPointerDown}
              onPointerMove={handlePanPointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              className={cn(
                "flex h-full items-stretch gap-4 overflow-x-auto pb-1 -mx-1 px-1",
                groupBy === "assignee" && (isPanning ? "cursor-grabbing select-none" : "cursor-grab")
              )}
            >
              {columns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  boardTotal={filtered.length}
                  onOpen={setOpenTaskId}
                  onHeaderClick={groupBy === "assignee" ? () => openPersonBoard(column.id) : undefined}
                  groupedByPriority={groupBy === "priority"}
                  groupedByStatus={groupBy === "status"}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && closeTaskSheet()} />
    </div>
  );
}
