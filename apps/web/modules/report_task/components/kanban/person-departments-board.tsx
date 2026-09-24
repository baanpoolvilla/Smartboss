"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { KanbanColumn, type BoardColumn } from "./kanban-column";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useProjectTopicStore } from "@/modules/report_task/store/project-topic-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { getUser, departments } from "@/modules/report_task/lib/directory";
import { sortTasksForDisplay } from "@/modules/report_task/lib/task-flags";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import { taskDepartmentIdsForBoard, OTHER_DEPARTMENT_ID } from "@/modules/report_task/lib/task-department";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * Step between the main board's assignee column and PersonTopicsBoard — เข้า
 * จากคนก่อน แล้วค่อยเลือกว่าจะดูแผนกไหนของคนนั้น ("อยากให้แสดงชื่อคน ข้างล่าง
 * เป็นแผนกที่มีโปรเจคอยู่ กดเข้าไปในแผนกค่อยย้อยเป็นโปรเจค แล้วค่อยย้อยเป็นงาน"
 * — เดิมคลิกชื่อคนแล้วกระโดดตรงไปหัวข้อโปรเจคเลย ข้ามชั้นแผนกไปทั้งที่บอร์ด
 * แบบแผนกเองมีชั้นนี้อยู่แล้ว) หน้าตา/การจัดคอลัมน์เดียวกับ kanban-board.tsx's
 * groupBy==="department" เป๊ะ เพียงกรอง tasks ด้วย assigneeIds.includes(personId)
 * ก่อนนับเข้าแผนกใดๆ — ใช้ KanbanColumn ตัวเดียวกัน (summaryOnly) ไม่ใช่
 * TopicColumnCard เพราะระดับนี้ยังเป็น "แผนก" ไม่ใช่ "หัวข้อโปรเจค" คลิกหัว
 * คอลัมน์แผนกแล้วค่อยไป PersonTopicsBoard (ผ่าน onOpenDepartment จาก
 * kanban-board.tsx ซึ่งตั้ง `?dept=` ต่อบน `?person=` เดิม)
 */
export function PersonDepartmentsBoard({
  personId,
  onBack,
  onOpenDepartment,
}: {
  personId: string;
  onBack: () => void;
  onOpenDepartment: (departmentId: string) => void;
}) {
  const allTasks = useTaskStore((s) => s.tasks);
  const projectTopics = useProjectTopicStore((s) => s.topics);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const person = getUser(personId);

  const mine = useMemo(
    () =>
      allTasks
        .filter((t) => t.assigneeIds.includes(personId))
        .filter((t) => canSeeTask(t, viewingAsUserId)),
    [allTasks, personId, viewingAsUserId]
  );

  const columns: BoardColumn[] = useMemo(() => {
    const realDeptColumns = departments
      .map((d) => {
        const deptTasks = sortTasksForDisplay(
          mine.filter((t) => taskDepartmentIdsForBoard(t, projectTopics).includes(d.id))
        );
        const topicIds = Array.from(new Set(deptTasks.map((t) => t.projectTopicId).filter((id): id is string => !!id)));
        const projectNames = topicIds
          .map((id) => projectTopics.find((pt) => pt.id === id)?.name)
          .filter((name): name is string => !!name);
        return {
          id: d.id,
          label: d.name,
          accent: d.color,
          tasks: deptTasks,
          projectCount: projectNames.length,
          projectNames,
          summaryOnly: true,
        };
      })
      .filter((c) => c.tasks.length > 0);

    const otherTasks = sortTasksForDisplay(
      mine.filter((t) => taskDepartmentIdsForBoard(t, projectTopics).length === 0)
    );
    const otherColumn: BoardColumn[] =
      otherTasks.length > 0
        ? [
            {
              id: OTHER_DEPARTMENT_ID,
              label: "อื่นๆ",
              accent: chartColors.gray,
              tasks: otherTasks,
              projectCount: 0,
              summaryOnly: true,
            },
          ]
        : [];

    return [...realDeptColumns, ...otherColumn];
  }, [mine, projectTopics]);

  const total = mine.length;

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
  }, [columns]);

  function scrollBoard(direction: -1 | 1) {
    scrollerRef.current?.scrollBy({ left: direction * 316, behavior: "smooth" });
  }

  function handlePanPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[id^="kanban-col-"] button, button, a, input, select, textarea, [role="button"]')) return;
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
        <h2 className="text-sm font-semibold truncate min-w-0 shrink">งานของ {person?.name ?? "—"} แยกตามแผนก</h2>
        <span className="ml-auto text-xs text-[var(--ink-soft)] shrink-0">{total} งาน</span>
      </div>

      {columns.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="ไม่มีงานที่มอบหมายอยู่"
          description={`${person?.name ?? "คนนี้"} ยังไม่มีงานที่รับผิดชอบตอนนี้`}
        />
      ) : (
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
            {columns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                boardTotal={total}
                onOpen={() => {}}
                onHeaderClick={() => onOpenDepartment(column.id)}
                headerClickTitle="ดูงานของคนนี้ในแผนกนี้ แยกตามหัวข้อโปรเจค"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
