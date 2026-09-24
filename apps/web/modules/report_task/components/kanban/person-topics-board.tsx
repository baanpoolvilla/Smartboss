"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, FolderKanban, SearchX, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { TopicColumnCard, type TopicColumn } from "./topic-column-card";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useProjectTopicStore } from "@/modules/report_task/store/project-topic-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { getUser, getDepartment, departments } from "@/modules/report_task/lib/directory";
import { sortTasksForDisplay } from "@/modules/report_task/lib/task-flags";
import { taskDepartmentIdsForBoard, OTHER_DEPARTMENT_ID } from "@/modules/report_task/lib/task-department";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";

const UNSORTED_KEY = "__none__";

function buildTopicColumns(tasks: Task[], topics: { id: string; name: string }[]): TopicColumn[] {
  const byTopic = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.projectTopicId ?? UNSORTED_KEY;
    const list = byTopic.get(key);
    if (list) list.push(t);
    else byTopic.set(key, [t]);
  }
  const named = topics
    .filter((topic) => byTopic.has(topic.id))
    .map((topic) => ({ id: topic.id, name: topic.name, tasks: sortTasksForDisplay(byTopic.get(topic.id)!) }));
  const unsorted = byTopic.get(UNSORTED_KEY);
  return unsorted
    ? [...named, { id: UNSORTED_KEY, name: "อื่นๆ", tasks: sortTasksForDisplay(unsorted) }]
    : named;
}

/**
 * Full-screen replacement for the board (not a popup) — reached two ways:
 * clicking a person's column card/header (anywhere on it) skips straight
 * here with every department mixed together ("กดการ์ดนี้เป็นงานของคนนั้น
 * เลยแบบงานทั้งหมด...ดูง่ายเลย" — `departmentId` null/omitted); clicking one
 * department row on that same card (KanbanColumn's `breakdown`) narrows it
 * to just that one department instead (`?person=&dept=` in kanban-board.tsx
 * — "ต้องเป็นแผนกด้วยสิ...แสดงแค่ของใครของมันที่ได้รับมอบหมายในแผนกๆนั้นๆ",
 * `departmentId` a real id or OTHER_DEPARTMENT_ID, via taskDepartmentIdsForBoard
 * — same rule the main board's department grouping uses). Either way, laid
 * out as one column per project topic — same column/card look as the main
 * board, including a real (non-draggable) TaskCard per task — plus an
 * "อื่นๆ" column for tasks with no topic; the flat (all-departments) mode
 * additionally tags each column with which department it belongs to (see
 * TopicColumnCard's deptLabel) so a head can see department → project →
 * task in one page without clicking further ("อยากให้ดูง่ายละครบหมดเลยว่า
 * คนนี้กำลังทำงานแผนกอะไรและโปรเจคอะไรในแผนก...ครบจบในหน้าเดียว") — every
 * department's columns share ONE horizontally-scrolling row, not a row per
 * department, so the whole page scrolls in a single direction
 * ("เรียงตามแนวนอน...ทุกแผนก+โปรเจคอยู่ในแถวเดียวกัน เลื่อนหน้าจอไปทางขวา
 * ดูต่อ"). Each column's header bar shows the same 4-way status split as
 * the main board's status view, merged into one bar instead of one column
 * each.
 */
export function PersonTopicsBoard({
  personId,
  departmentId,
  onBack,
  onOpenTask,
}: {
  personId: string;
  /** null/undefined = every department mixed together, one shared row with
   * each column tagged by department (the card-click flat view). */
  departmentId?: string | null;
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const allTasks = useTaskStore((s) => s.tasks);
  const topics = useProjectTopicStore((s) => s.topics);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const person = getUser(personId);
  const isOtherDept = departmentId === OTHER_DEPARTMENT_ID;
  const deptName = departmentId == null ? null : isOtherDept ? "อื่นๆ" : (getDepartment(departmentId)?.name ?? "—");

  const mine = useMemo(
    () =>
      allTasks
        .filter((t) => t.assigneeIds.includes(personId))
        .filter((t) => {
          if (departmentId == null) return true;
          return isOtherDept
            ? taskDepartmentIdsForBoard(t, topics).length === 0
            : taskDepartmentIdsForBoard(t, topics).includes(departmentId);
        })
        .filter((t) => canSeeTask(t, viewingAsUserId)),
    [personId, departmentId, isOtherDept, allTasks, topics, viewingAsUserId]
  );

  const columns = useMemo(() => buildTopicColumns(mine, topics), [mine, topics]);

  // Flat mode only — this person's departments, each with its own slice of
  // topic columns, so the whole "department → project" picture reads at a
  // glance without an extra click per department. A task with more than one
  // department (taskDepartmentIdsForBoard) legitimately shows up under each
  // one, same tolerance the main board's own department grouping already
  // has (see kanban-board.tsx's sharedDeptCount note).
  const sections = useMemo(() => {
    if (departmentId != null) return null;
    const real = departments
      .map((d) => {
        const deptTasks = mine.filter((t) => taskDepartmentIdsForBoard(t, topics).includes(d.id));
        return { id: d.id, name: d.name, color: d.color, tasks: deptTasks, columns: buildTopicColumns(deptTasks, topics) };
      })
      .filter((s) => s.tasks.length > 0);
    const otherTasks = mine.filter((t) => taskDepartmentIdsForBoard(t, topics).length === 0);
    const other =
      otherTasks.length > 0
        ? [{ id: OTHER_DEPARTMENT_ID, name: "อื่นๆ", color: chartColors.gray, tasks: otherTasks, columns: buildTopicColumns(otherTasks, topics) }]
        : [];
    return [...real, ...other];
  }, [departmentId, mine, topics]);

  // Narrows which topic columns render — separate from the main board's
  // filters (removed from this page entirely, see tasks/page.tsx) since this
  // one only makes sense once you're already looking at one person's spread
  // across projects.
  const [topicFilter, setTopicFilter] = useState<string>("all");
  // A different person/department pair can (and usually does) not include
  // whatever topic was picked for the last one — reset during render (not
  // an effect, per React's guidance for resetting state on a prop change)
  // rather than silently carrying a filter that no longer matches anything.
  const [lastKey, setLastKey] = useState(`${personId}:${departmentId}`);
  if (`${personId}:${departmentId}` !== lastKey) {
    setLastKey(`${personId}:${departmentId}`);
    setTopicFilter("all");
  }
  // Flat (all-departments) mode: every department's columns tagged with
  // that department's name/color and laid out in ONE shared row — not one
  // row per department — so the whole thing scrolls in a single direction
  // ("เรียงตามแนวนอน...ทุกแผนก+โปรเจคอยู่ในแถวเดียวกัน เลื่อนหน้าจอไปทาง
  // ขวาดูต่อ" — a stacked-by-department layout read as going different
  // directions at once). The department tag on each card (see
  // TopicColumnCard's deptLabel) is what keeps "which department is this"
  // legible without a section header of its own. Single-department mode
  // needs no tag at all — the page title already says which one.
  const flatColumns = useMemo(
    () =>
      sections
        ? sections.flatMap((s) => s.columns.map((c) => ({ ...c, deptLabel: s.name, deptColor: s.color })))
        : columns.map((c) => ({ ...c, deptLabel: undefined as string | undefined, deptColor: undefined as string | undefined })),
    [sections, columns]
  );
  const visibleColumns = topicFilter === "all" ? flatColumns : flatColumns.filter((c) => c.id === topicFilter);
  // Deduped total (not flatColumns' sum) — a task shared across departments
  // shows up as more than one card above, but should still only count once
  // here (same "N งาน" the header always meant).
  const total = (topicFilter === "all" ? columns : columns.filter((c) => c.id === topicFilter)).reduce(
    (n, c) => n + c.tasks.length,
    0
  );

  // One person can easily be on more projects than fit on screen — same
  // scroll-arrow + click-drag-to-pan treatment as the main board's assignee
  // view (kanban-board.tsx), unconditional here since every visit to this
  // page is already "one person, potentially many project columns" and
  // (in flat mode) potentially several departments' worth in the same row.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const panRef = useRef<{ startX: number; startScrollLeft: number; pointerId: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

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
  }, [visibleColumns]);

  function scrollBoard(direction: -1 | 1) {
    scrollerRef.current?.scrollBy({ left: direction * 316, behavior: "smooth" });
  }

  function handlePanPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center flex-wrap gap-x-3 gap-y-2 pb-4">
        <button
          type="button"
          onClick={onBack}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] transition-colors shrink-0"
          aria-label="กลับไปบอร์ด"
          title="กลับไปบอร์ด"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </button>
        <Avatar className="h-7 w-7 shrink-0">
          <AvatarImage src={person?.avatarUrl ?? undefined} alt={person?.name} />
          <AvatarFallback className="text-[10px]">{person?.avatar}</AvatarFallback>
        </Avatar>
        <h2 className="text-sm font-semibold truncate min-w-0 shrink">
          งานของ {person?.name ?? "—"} {deptName ? `แผนก${deptName} ` : ""}แยกตามหัวข้อโปรเจค
        </h2>

        {columns.length > 1 && (
          <Select value={topicFilter} onValueChange={(v) => v && setTopicFilter(v)}>
            <SelectTrigger className={filterFieldTriggerClass(topicFilter !== "all", "min-w-[150px] ml-2 shrink-0")}>
              <FolderKanban className="h-3.5 w-3.5 shrink-0" />
              <SelectValue>{topicFilter === "all" ? "ทุกหัวข้อโปรเจค" : columns.find((c) => c.id === topicFilter)?.name ?? "ทุกหัวข้อโปรเจค"}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value="all">ทุกหัวข้อโปรเจค</SelectItem>
              {columns.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name} ({c.tasks.length})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {topicFilter !== "all" && (
          <button
            onClick={() => setTopicFilter("all")}
            className="flex items-center gap-1 text-xs text-[var(--ink-soft)] hover:text-[var(--ink)] shrink-0"
          >
            <X className="h-3.5 w-3.5" /> ล้างตัวกรอง
          </button>
        )}

        <span className="ml-auto text-xs text-[var(--ink-soft)] shrink-0">{total} งาน</span>
      </div>

      {columns.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="ไม่มีงานที่มอบหมายอยู่"
          description={`${person?.name ?? "คนนี้"} ยังไม่มีงานที่รับผิดชอบตอนนี้`}
        />
      ) : total === 0 ? (
        <EmptyState
          icon={SearchX}
          title="ไม่พบงานในหัวข้อนี้"
          description="ลองเลือกหัวข้อโปรเจคอื่น หรือกดล้างตัวกรองเพื่อดูทุกหัวข้อ"
        />
      ) : (
        <div className="relative min-h-0 flex-1">
          {/* <640px: small floating "‹"/"›" hints only, same as the main
              board — the row itself always swipes natively regardless.
              ≥640px keeps the full hover-shown arrow buttons below. */}
          <button
            type="button"
            onClick={() => scrollBoard(-1)}
            aria-label="เลื่อนไปทางซ้าย"
            tabIndex={canScrollLeft ? 0 : -1}
            className={cn(
              "sm:hidden absolute left-1 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[var(--ink-soft)] shadow-[0_4px_14px_rgba(0,0,0,0.18)] transition-opacity duration-300",
              canScrollLeft ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollBoard(1)}
            aria-label="เลื่อนไปทางขวา"
            tabIndex={canScrollRight ? 0 : -1}
            className={cn(
              "sm:hidden absolute right-1 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[var(--ink-soft)] shadow-[0_4px_14px_rgba(0,0,0,0.18)] transition-opacity duration-300",
              canScrollRight ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {canScrollLeft && (
            <div className="hidden sm:block">
              <div className="pointer-events-none absolute top-0 left-0 z-10 h-24 w-10 bg-gradient-to-r from-[var(--bg)] to-transparent" />
              <button
                onClick={() => scrollBoard(-1)}
                aria-label="เลื่อนไปทางซ้าย"
                className="absolute left-1 top-10 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--ink-soft)] shadow-md hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          )}
          {canScrollRight && (
            <div className="hidden sm:block">
              <div className="pointer-events-none absolute top-0 right-0 z-10 h-24 w-10 bg-gradient-to-l from-[var(--bg)] to-transparent" />
              <button
                onClick={() => scrollBoard(1)}
                aria-label="เลื่อนไปทางขวา"
                className="absolute right-1 top-10 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--ink-soft)] shadow-md hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <div
            ref={scrollerRef}
            onPointerDown={handlePanPointerDown}
            onPointerMove={handlePanPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            className={cn(
              "flex h-full items-stretch gap-4 overflow-x-auto pb-4 -mx-1 px-1 snap-x snap-mandatory sm:snap-none",
              isPanning ? "cursor-grabbing select-none" : "cursor-grab"
            )}
          >
          {visibleColumns.map((column) => (
            <TopicColumnCard
              key={`${column.deptLabel ?? ""}:${column.id}`}
              column={column}
              onOpenTask={onOpenTask}
              deptLabel={column.deptLabel}
              deptColor={column.deptColor}
            />
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
