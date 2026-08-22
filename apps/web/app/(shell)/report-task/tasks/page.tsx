"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Table2, Users } from "lucide-react";
import { TaskFilters } from "@/modules/report_task/components/kanban/task-filters";
import { TaskBoardKpis } from "@/modules/report_task/components/kanban/task-board-kpis";
import { KanbanBoard, type GroupBy } from "@/modules/report_task/components/kanban/kanban-board";
import { TaskGridView } from "@/modules/report_task/components/kanban/task-grid-view";
import { WorkloadView } from "@/modules/report_task/components/kanban/workload-view";
import { useTaskStore, type PenaltyFilter } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canManage } from "@/modules/report_task/lib/directory";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { matchesTaskFilters } from "@/modules/report_task/lib/task-filter";
import { taskPriorityOrder } from "@/modules/report_task/lib/task-meta";
import type { DatePreset } from "@/modules/report_task/lib/date-filter";
import { cn } from "@/modules/report_task/lib/utils";
import { Skeleton } from "@/modules/report_task/components/ui/skeleton";
import { StickyFilterBar } from "@/modules/report_task/components/shared/sticky-filter-bar";
import type { TaskPriority } from "@/modules/report_task/types";

type TaskView = "board" | "grid" | "workload";

export default function TasksPage() {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <TasksPageContent />
    </Suspense>
  );
}

function TasksPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setView] = useState<TaskView>(() => {
    const v = searchParams.get("view");
    return v === "grid" || v === "workload" ? v : "board";
  });
  // จัดกลุ่มตามอยู่ในแถบตัวกรองด้านบน (TaskFilters) แต่ค่าจริงใช้เฉพาะบอร์ด
  // Kanban เท่านั้น — ยกมาไว้ที่นี่ (แทนที่จะเป็น state ในตัว KanbanBoard เอง)
  // เพราะทั้งสอง component เป็น sibling กัน ต้องมีที่เก็บ state ร่วม
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const tasks = useTaskStore((s) => s.tasks);
  const loaded = useTaskStore((s) => s.loaded);
  const filters = useTaskStore((s) => s.filters);
  const setFilters = useTaskStore((s) => s.setFilters);
  const resetFilters = useTaskStore((s) => s.resetFilters);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const isHead = canManage(viewingAsUserId);

  // Seed filters from the URL once on mount (a shared link or a refresh mid-
  // visit should restore them) — still cleared on the way out, same as
  // before, so the board starts fresh on the *next* visit rather than
  // staying silently filtered until a hard refresh.
  useEffect(() => {
    const dept = searchParams.get("dept");
    const assignee = searchParams.get("assignee");
    const priority = searchParams.get("priority");
    const penalty = searchParams.get("penalty");
    const preset = searchParams.get("preset");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const patch: Partial<typeof filters> = {};
    if (dept) patch.departmentId = dept;
    if (assignee) patch.assigneeId = assignee;
    if (priority && taskPriorityOrder.includes(priority as TaskPriority)) patch.priority = priority as TaskPriority;
    if (penalty && ["overdue", "pending", "docked"].includes(penalty)) patch.penalty = penalty as PenaltyFilter;
    if (preset) patch.preset = preset as DatePreset;
    if (from) patch.customFrom = from;
    if (to) patch.customTo = to;
    if (Object.keys(patch).length > 0) setFilters(patch);
    return resetFilters;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror filters + view into the URL (replace — no history entry per
  // keystroke) so a refresh doesn't silently reset the board and a filtered
  // view can be shared with a teammate via the link.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.departmentId !== "all") params.set("dept", filters.departmentId);
    if (filters.assigneeId !== "all") params.set("assignee", filters.assigneeId);
    if (filters.priority !== "all") params.set("priority", filters.priority);
    if (filters.penalty !== "all") params.set("penalty", filters.penalty);
    if (filters.preset !== "all") {
      params.set("preset", filters.preset);
      if (filters.preset === "custom") {
        if (filters.customFrom) params.set("from", filters.customFrom);
        if (filters.customTo) params.set("to", filters.customTo);
      }
    }
    if (view !== "board") params.set("view", view);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [filters, view, pathname, router]);

  // Workload compares everyone's load side by side — a manager-only view,
  // same as the dashboard's leaderboard/department chart. Bounce off it
  // (adjusted during render, not an effect) if a non-head is on it when
  // they switch identity away from being a head.
  if (!isHead && view === "workload") setView("board");

  // Non-heads only ever see their own tasks (see canSeeTask).
  const visibleTasks = useMemo(() => tasks.filter((t) => canSeeTask(t, viewingAsUserId)), [tasks, viewingAsUserId]);

  // The 4 KPI cards react to every filter EXCEPT their own quick-view drill
  // (see TaskBoardKpis) — otherwise clicking "เลยกำหนด" would collapse all 4
  // numbers down to the same overdue count instead of staying a stable set
  // of options to click between, while the board itself (which reads
  // `filters` straight from the store) still narrows correctly.
  const kpiTasks = useMemo(
    () => visibleTasks.filter((t) => matchesTaskFilters(t, { ...filters, quickView: "all" })),
    [visibleTasks, filters]
  );

  // Feeds the mobile filter sheet's "แสดง N งาน" button — same filters the
  // board itself narrows by (unlike kpiTasks above, which drops the quick-view
  // drill so the 4 KPI numbers stay a stable set of options).
  const filteredTaskCount = useMemo(
    () => visibleTasks.filter((t) => matchesTaskFilters(t, filters)).length,
    [visibleTasks, filters]
  );

  const tabs: { id: TaskView; label: string; icon: typeof LayoutGrid }[] = [
    { id: "board", label: "บอร์ด", icon: LayoutGrid },
    { id: "grid", label: "ตาราง", icon: Table2 },
    ...(isHead ? [{ id: "workload" as const, label: "ภาระงาน", icon: Users }] : []),
  ];

  // Drilled into one person's own topic board (kanban-board.tsx's
  // `?person=`) — a focused single-person view, not "the board" itself, so
  // the tabs/filters/KPI cards up here (which all act on the whole visible
  // task set, not just this person) don't apply and were just unused clutter
  // sitting above it. PersonTopicsBoard has its own back button + header.
  const personBoardId = searchParams.get("person");

  return (
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0 lg:gap-4 pb-6 lg:pb-4">
      {!personBoardId && (
        <StickyFilterBar
          actions={
            // View switcher — same task data: Board (Kanban) ↔ Grid ↔ Workload
            <div className="inline-flex items-center gap-1 rounded-xl bg-[var(--bg-soft)] p-1 max-w-full overflow-x-auto shrink-0">
              {tabs.map((t) => {
                const TabIcon = t.icon;
                const activeTab = view === t.id;
                return (
                  <button
                    key={t.id}
                    data-tour={t.id === "board" ? "task-view-board" : t.id === "grid" ? "task-view-grid" : undefined}
                    onClick={() => setView(t.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                      activeTab ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                    )}
                  >
                    <TabIcon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          }
        >
          <TaskFilters groupBy={view === "board" ? groupBy : undefined} onGroupByChange={setGroupBy} resultCount={filteredTaskCount} />
        </StickyFilterBar>
      )}

      {/* Hidden under "เลยกำหนดเท่านั้น" — every number here would just
          restate the same overdue count (or 0 for "สำเร็จทั้งหมด") once the
          board itself is already narrowed to nothing but overdue tasks, see
          kanban-board.tsx's matching column collapse for the same filter. */}
      {!personBoardId && loaded && view === "board" && filters.penalty !== "overdue" && (
        <div className="mt-1">
          <TaskBoardKpis tasks={kpiTasks} />
        </div>
      )}
      {!loaded ? (
        <BoardSkeleton />
      ) : view === "board" ? (
        // Board (and its person-drill-down) manage their own scroll — the
        // filter bar + KPI tiles above stay put instead of scrolling away
        // with the cards, and only the board's own area (columns
        // horizontally, each column's card list vertically) scrolls. See
        // kanban-board.tsx's own comment on why.
        <div className="flex min-h-0 flex-1 flex-col lg:overflow-hidden">
          <KanbanBoard groupBy={groupBy} />
        </div>
      ) : (
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {view === "grid" && <TaskGridView />}
          {view === "workload" && <WorkloadView />}
        </div>
      )}
    </div>
  );
}

/** Column-shaped placeholder shown while the file-backed task data loads. */
function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden pt-4 lg:pt-6">
      {Array.from({ length: 4 }).map((_, col) => (
        <div key={col} className="flex-1 min-w-[280px] max-w-[400px] flex flex-col gap-2.5">
          <Skeleton className="h-9 w-full rounded-xl" />
          {Array.from({ length: 3 - (col % 2) }).map((_, i) => (
            <div key={i} className="rounded-xl border border-[var(--line)] bg-white p-3.5 space-y-2.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-3/4" />
              <div className="flex items-center justify-between pt-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-6 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
