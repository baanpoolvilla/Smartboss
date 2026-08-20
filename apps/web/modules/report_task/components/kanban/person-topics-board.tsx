"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, FolderKanban, SearchX, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { TaskCard } from "./task-card";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useProjectTopicStore } from "@/modules/report_task/store/project-topic-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { getUser } from "@/modules/report_task/lib/directory";
import { dueUrgency, sortTasksForDisplay } from "@/modules/report_task/lib/task-flags";
import { statusMeta } from "@/modules/report_task/lib/task-meta";
import { chartColors, statusColors as statusAccent } from "@/modules/report_task/lib/chart-colors";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";

const UNSORTED_KEY = "__none__";

// Same 4-way split as the main board's "จัดกลุ่มตามสถานะ" columns (see
// kanban-board.tsx) — todo/in_progress/done plus a derived "เลยกำหนด"
// bucket pulled out of whichever of the first two it came from, so every
// task lands in exactly one bucket.
const statusBuckets = [
  { key: "todo" as const, label: statusMeta.todo.label, color: chartColors.gray },
  { key: "in_progress" as const, label: statusMeta.in_progress.label, color: statusAccent.in_progress },
  { key: "overdue" as const, label: "เลยกำหนด", color: chartColors.red },
  { key: "done" as const, label: statusMeta.done.label, color: statusAccent.done },
];

function bucketOf(t: Task): (typeof statusBuckets)[number]["key"] {
  if (t.status !== "done" && dueUrgency(t) === "overdue") return "overdue";
  return t.status;
}

/**
 * Full-screen replacement for the board (not a popup) — reached by clicking
 * a person's column header while the board is grouped by "ผู้รับผิดชอบ" (see
 * `?person=` in kanban-board.tsx). Every task that person is on, across the
 * whole board (not just whatever was filtered on the way in), laid out as
 * one column per project topic — same column/card look as the main board,
 * including a real (non-draggable) TaskCard per task — plus an "ไม่มีหัวข้อ"
 * column for tasks with none. Each column's header bar shows the same 4-way
 * status split as the main board's status view, merged into one bar instead
 * of one column each.
 */
export function PersonTopicsBoard({
  personId,
  onBack,
  onOpenTask,
}: {
  personId: string;
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const allTasks = useTaskStore((s) => s.tasks);
  const topics = useProjectTopicStore((s) => s.topics);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const person = getUser(personId);

  const columns = useMemo(() => {
    const mine = allTasks
      .filter((t) => t.assigneeIds.includes(personId))
      .filter((t) => canSeeTask(t, viewingAsUserId));

    const byTopic = new Map<string, Task[]>();
    for (const t of mine) {
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
      ? [...named, { id: UNSORTED_KEY, name: "ไม่มีหัวข้อ", tasks: sortTasksForDisplay(unsorted) }]
      : named;
  }, [personId, allTasks, topics, viewingAsUserId]);

  // Narrows which topic columns render — separate from the main board's
  // filters (removed from this page entirely, see tasks/page.tsx) since this
  // one only makes sense once you're already looking at one person's spread
  // across projects.
  const [topicFilter, setTopicFilter] = useState<string>("all");
  // A different person's topic list can (and usually does) not include
  // whatever topic was picked for the last one — reset during render (not
  // an effect, per React's guidance for resetting state on a prop change)
  // rather than silently carrying a filter that no longer matches anything.
  const [lastPersonId, setLastPersonId] = useState(personId);
  if (personId !== lastPersonId) {
    setLastPersonId(personId);
    setTopicFilter("all");
  }
  const visibleColumns = topicFilter === "all" ? columns : columns.filter((c) => c.id === topicFilter);
  const total = visibleColumns.reduce((n, c) => n + c.tasks.length, 0);

  // One person can easily be on more projects than fit on screen — same
  // scroll-arrow + click-drag-to-pan treatment as the main board's assignee
  // view (kanban-board.tsx), unconditional here since every visit to this
  // page is already "one person, potentially many project columns."
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
          <AvatarFallback className="text-[10px]">{person?.avatar}</AvatarFallback>
        </Avatar>
        <h2 className="text-sm font-semibold truncate min-w-0 shrink">งานของ {person?.name ?? "—"} แยกตามหัวข้อโปรเจค</h2>

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
        <>
          <div className="relative flex-1">
            {canScrollLeft && (
              <>
                <div className="pointer-events-none absolute top-0 left-0 z-10 h-24 w-10 bg-gradient-to-r from-[var(--bg)] to-transparent" />
                <button
                  onClick={() => scrollBoard(-1)}
                  aria-label="เลื่อนไปทางซ้าย"
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
                  aria-label="เลื่อนไปทางขวา"
                  className="absolute right-1 top-10 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--ink-soft)] shadow-md hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
            <div
              ref={scrollerRef}
              onPointerDown={handlePanPointerDown}
              onPointerMove={handlePanPointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              className={cn(
                "flex gap-4 overflow-x-auto pb-4 -mx-1 px-1",
                isPanning ? "cursor-grabbing select-none" : "cursor-grab"
              )}
            >
            {visibleColumns.map((column) => {
              const counts = statusBuckets.map((b) => ({
                ...b,
                count: column.tasks.filter((t) => bucketOf(t) === b.key).length,
              }));
              return (
                <div key={column.id} className="flex flex-col flex-1 basis-[300px] min-w-[280px] max-w-[400px] shrink-0">
                  <div className="rounded-xl bg-white border border-[var(--line)] shadow-[0_1px_2px_rgba(16,24,40,0.04)] px-3.5 py-3 mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 bg-[var(--accent)] text-[var(--brand-green-dark)]">
                        <FolderKanban className="h-4 w-4" />
                      </span>
                      <h3 className="text-sm font-semibold truncate tracking-tight">{column.name}</h3>
                      <span className="ml-auto text-[11px] font-semibold rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center tabular-nums shrink-0 bg-[var(--accent)] text-[var(--brand-green-dark)]">
                        {column.tasks.length}
                      </span>
                    </div>

                    {/* 4-way status split, merged into one bar (see statusBuckets) — hover a
                        segment for its label/count, legend row underneath spells it out. */}
                    <div className="mt-2.5">
                      <div className="h-1.5 rounded-full bg-[var(--bg-soft)] overflow-hidden flex">
                        {counts.map((b) =>
                          b.count > 0 ? (
                            <div
                              key={b.key}
                              className="h-full"
                              style={{ width: `${(b.count / column.tasks.length) * 100}%`, backgroundColor: b.color }}
                              title={`${b.label} ${b.count}`}
                            />
                          ) : null
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {counts
                          .filter((b) => b.count > 0)
                          .map((b) => (
                            <span key={b.key} className="flex items-center gap-1 text-[10px] text-[var(--ink-soft)]">
                              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                              {b.label} {b.count}
                            </span>
                          ))}
                      </div>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "flex-1 flex flex-col gap-3 p-2.5 rounded-xl min-h-[200px] bg-[var(--bg-soft)]/50"
                    )}
                  >
                    {column.tasks.map((t) => (
                      <TaskCard key={t.id} task={t} onOpen={onOpenTask} />
                    ))}
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
