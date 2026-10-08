"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { KanbanColumn } from "./kanban-column";
import { buildStatusColumns } from "./status-columns";
import { ProjectPicker } from "./project-picker";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useProjectTopicStore } from "@/modules/report_task/store/project-topic-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { getDepartment } from "@/modules/report_task/lib/directory";
import { taskDepartmentIdsForBoard, OTHER_DEPARTMENT_ID } from "@/modules/report_task/lib/task-department";
import { cn } from "@/modules/report_task/lib/utils";

const UNSORTED_KEY = "__none__";

/**
 * Full-screen replacement for the board (not a popup) — สลับแกนจาก "คนคนหนึ่ง"
 * (PersonTopicsBoard) เป็น "แผนกหนึ่ง" — เข้าถึงโดยคลิกหัวคอลัมน์ตอนบอร์ดจัดกลุ่มตาม
 * "แผนก" (ดู `?dept=` ใน kanban-board.tsx)
 *
 * ตัวบอร์ดแบ่งคอลัมน์ตามสถานะ (รอดำเนินการ / กำลังทำ / รอตรวจสอบ / เสร็จสิ้น) แบบบอร์ดปกติ —
 * เดิมแบ่งตามหัวข้อโปรเจค ซึ่งหลายแผนกเห็นแค่คอลัมน์ "อื่นๆ" อันเดียวรวมทุกสถานะ
 * ("แสดงสถานะแบบปกติเลยว่ารอดำเนินการ กำลังทำ เสร็จ") แผนกเลือกจากบอร์ดข้างนอก (กด ← กลับไปเลือก
 * แผนกอื่น) ข้างในมีแค่ปุ่มโปรเจคปุ่มเดียว (ProjectPicker) — เคยมีดรอปดาวน์แผนกคู่กันบนหัวด้วย ดูรก
 *
 * ใช้ taskDepartmentIdsForBoard แทน t.departmentIds ตรงๆ — ถ้าโปรเจคของงานนั้น
 * แท็กแผนกของตัวเองไว้แล้ว ยึดตามแผนกของโปรเจค ไม่ใช่แผนกของผู้รับผิดชอบแต่ละคน
 * (คนที่ถูกยืมตัวมาช่วยโปรเจคแผนกอื่นจะไม่โผล่ในบอร์ดแผนกตัวเอง) งานที่ยังไม่มี
 * โปรเจค/โปรเจคเก่าที่ยังไม่ได้แท็กแผนก ยังคงกรองด้วย departmentIds เดิม (เป็น
 * array — อยู่ได้หลายแผนกพร้อมกัน) สอดคล้องกับที่บอร์ดหลัก groupBy="department"
 * ทำ (ดู kanban-board.tsx's columns + lib/task-department.ts's doc)
 */
export function DepartmentTopicsBoard({
  departmentId,
  onBack,
  onOpenTask,
}: {
  departmentId: string;
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const allTasks = useTaskStore((s) => s.tasks);
  const topics = useProjectTopicStore((s) => s.topics);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const isOther = departmentId === OTHER_DEPARTMENT_ID;
  const department = isOther ? undefined : getDepartment(departmentId);
  const deptName = isOther ? "อื่นๆ" : (department?.name ?? "—");
  const deptColor = isOther ? "var(--ink-soft)" : (department?.color ?? "var(--ink-soft)");

  const visibleTasks = useMemo(() => allTasks.filter((t) => canSeeTask(t, viewingAsUserId)), [allTasks, viewingAsUserId]);

  // "อื่นๆ" ไม่ใช่แผนกจริง — เป็นที่กองงานที่ไม่มีโปรเจคเลย (ไม่เคยถูกเลือก
  // แผนกให้อย่างจริงจัง ดู taskDepartmentIdsForBoard's doc) จึงกรองด้วยเงื่อนไข
  // คนละแบบกับแผนกจริง (ซึ่งกรองด้วย .includes(departmentId) ตามปกติ)
  const inDept = useMemo(
    () =>
      visibleTasks.filter((t) =>
        isOther ? taskDepartmentIdsForBoard(t, topics).length === 0 : taskDepartmentIdsForBoard(t, topics).includes(departmentId)
      ),
    [visibleTasks, topics, departmentId, isOther]
  );

  // โปรเจคที่แผนกนี้มีงานอยู่ (+ "ไม่มีโปรเจค") — ตัวเลือกของช่องโปรเจคบนหัว
  const projectOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of inDept) {
      const key = t.projectTopicId ?? UNSORTED_KEY;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const named = topics
      .filter((topic) => counts.has(topic.id))
      .map((topic) => ({ id: topic.id, name: topic.name, count: counts.get(topic.id)! }));
    // ลำดับในรายการ (มากไปน้อย, "ไม่มีโปรเจค" ท้ายสุด) ProjectPicker จัดเอง
    return counts.has(UNSORTED_KEY) ? [...named, { id: UNSORTED_KEY, name: "ไม่มีโปรเจค", count: counts.get(UNSORTED_KEY)! }] : named;
  }, [inDept, topics]);

  // เปลี่ยนแผนก (กลับไปบอร์ดแล้วเลือกใหม่) = เริ่มที่ "ทุกโปรเจค" ใหม่
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [lastDeptId, setLastDeptId] = useState(departmentId);
  if (departmentId !== lastDeptId) {
    setLastDeptId(departmentId);
    setTopicFilter("all");
  }
  const shownTasks = useMemo(
    () => (topicFilter === "all" ? inDept : inDept.filter((t) => (t.projectTopicId ?? UNSORTED_KEY) === topicFilter)),
    [inDept, topicFilter]
  );
  const columns = useMemo(() => buildStatusColumns(shownTasks), [shownTasks]);
  const total = shownTasks.length;

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
      <div className="flex items-center gap-2 pb-4">
        <button
          type="button"
          onClick={onBack}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] transition-colors shrink-0"
          aria-label="กลับไปบอร์ด"
          title="กลับไปบอร์ด"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </button>
        <span className="h-7 w-7 rounded-lg shrink-0" style={{ backgroundColor: deptColor }} aria-hidden="true" />
        <h2 className="text-base font-semibold truncate min-w-0">{isOther ? "งานที่ยังไม่มีโปรเจค" : `แผนก${deptName}`}</h2>
        {/* แผนกเดียวมีโปรเจคเดียว (หรือไม่มีเลย) = ไม่มีอะไรให้เลือก ไม่ต้องโชว์ปุ่ม */}
        {projectOptions.length > 1 && (
          <ProjectPicker
            options={projectOptions}
            unsortedId={UNSORTED_KEY}
            total={inDept.length}
            value={topicFilter}
            onChange={setTopicFilter}
          />
        )}

        <span className="ml-auto text-xs text-[var(--ink-soft)] shrink-0">{total} งาน</span>
      </div>

      {inDept.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={isOther ? "ไม่มีงานที่ยังไม่มีโปรเจค" : "ไม่มีงานในแผนกนี้"}
          description={isOther ? "งานทุกอันมีโปรเจคกำหนดแผนกไว้แล้วตอนนี้" : `แผนก${deptName}ยังไม่มีงานอยู่ตอนนี้`}
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
          {/* เหมือนแถวคอลัมน์ของบอร์ดหลัก — มือถือเลื่อนทีละคอลัมน์ (snap) */}
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
            {columns.map((column) => (
              <KanbanColumn key={column.id} column={column} boardTotal={total} onOpen={onOpenTask} groupedByStatus />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
