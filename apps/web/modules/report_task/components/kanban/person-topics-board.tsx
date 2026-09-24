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
import { TopicColumnCard } from "./topic-column-card";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useProjectTopicStore } from "@/modules/report_task/store/project-topic-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { getUser } from "@/modules/report_task/lib/directory";
import { sortTasksForDisplay } from "@/modules/report_task/lib/task-flags";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";

const UNSORTED_KEY = "__none__";

/**
 * Full-screen replacement for the board (not a popup) — reached by clicking
 * a person's column while the board is grouped by "ผู้รับผิดชอบ" (see
 * `?person=` in kanban-board.tsx). Every task that person is on, across the
 * whole board (not just whatever was filtered on the way in), laid out as
 * one column per project topic — same column/card look as the main board,
 * including a real (non-draggable) TaskCard per task — plus an "อื่นๆ"
 * column for tasks with none. Department was dropped from this flow
 * entirely ("กดการ์ดนี้เป็นงานของคนนั้นเลยแบบงานทั้งหมด...ดูง่ายเลย" — the
 * card/header always opens straight to every project mixed together; a
 * `?topic=` param, set only when a specific breakdown row on the card was
 * clicked instead, narrows `topicFilter` down to just that one project on
 * arrival via `initialTopicId`). Each column's header bar shows the same
 * 4-way status split as the main board's status view, merged into one bar
 * instead of one column each.
 */
export function PersonTopicsBoard({
  personId,
  initialTopicId,
  onBack,
  onOpenTask,
}: {
  personId: string;
  /** Seeds `topicFilter` on arrival — set when a specific project-topic
   * breakdown row was clicked (KanbanColumn's `breakdown`), null/undefined
   * for "every project mixed together" (clicking the card/header itself). */
  initialTopicId?: string | null;
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
      ? [...named, { id: UNSORTED_KEY, name: "อื่นๆ", tasks: sortTasksForDisplay(unsorted) }]
      : named;
  }, [personId, allTasks, topics, viewingAsUserId]);

  // Narrows which topic columns render — separate from the main board's
  // filters (removed from this page entirely, see tasks/page.tsx) since this
  // one only makes sense once you're already looking at one person's spread
  // across projects. Seeded from initialTopicId on first render.
  const [topicFilter, setTopicFilter] = useState<string>(initialTopicId ?? "all");
  // A different person, or a fresh initialTopicId (a different breakdown row
  // clicked while already here), can carry a filter that no longer matches
  // what's on screen — reset during render (not an effect, per React's
  // guidance for resetting state on a prop change) rather than silently
  // keeping a stale one.
  const [lastKey, setLastKey] = useState(`${personId}:${initialTopicId ?? "all"}`);
  if (`${personId}:${initialTopicId ?? "all"}` !== lastKey) {
    setLastKey(`${personId}:${initialTopicId ?? "all"}`);
    setTopicFilter(initialTopicId ?? "all");
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
          <AvatarImage src={person?.avatarUrl ?? undefined} alt={person?.name} />
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
          <div className="relative min-h-0 flex-1">
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
                "flex h-full items-stretch gap-4 overflow-x-auto pb-4 -mx-1 px-1",
                isPanning ? "cursor-grabbing select-none" : "cursor-grab"
              )}
            >
            {visibleColumns.map((column) => (
              <TopicColumnCard key={column.id} column={column} onOpenTask={onOpenTask} />
            ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
