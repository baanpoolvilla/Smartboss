"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Plus, Table2, Users } from "lucide-react";
import { TaskFilters } from "@/modules/report_task/components/kanban/task-filters";
import { useSetAppBarLeading } from "@/modules/report_task/components/shared/app-bar-leading";
import { KanbanBoard, type GroupBy } from "@/modules/report_task/components/kanban/kanban-board";
import { TaskGridView } from "@/modules/report_task/components/kanban/task-grid-view";
import { WorkloadView } from "@/modules/report_task/components/kanban/workload-view";
import { useTaskStore, type PenaltyFilter } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canManage } from "@/modules/report_task/lib/directory";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { matchesTaskFilters } from "@/modules/report_task/lib/task-filter";
import { cn } from "@/modules/report_task/lib/utils";
import { Skeleton } from "@/modules/report_task/components/ui/skeleton";

type TaskView = "board" | "grid" | "workload";

/**
 * จำตัวกรอง + จัดกลุ่มตาม + แท็บ (บอร์ด/ตาราง/ภาระงาน) ไว้ในเครื่อง แยกตามคน — ออกไปหน้าอื่นแล้วกลับมา
 * ยังเป็นแบบที่เลือกไว้ ("เวลาไปหน้าไหน ๆ ฟิลเตอร์ก็ยังเป็นอันที่เราเลือก") · เดิมล้างทิ้งทุกครั้งที่ออกจากหน้า
 * ลิงก์ที่มีตัวกรองใน URL (แชร์มา/รีเฟรช/กดจากแดชบอร์ด) ชนะค่าที่จำไว้เสมอ
 */
const SAVED_KEY = "sb.tasks.view.v1";
type TaskFiltersState = ReturnType<typeof useTaskStore.getState>["filters"];
interface SavedTaskView {
  filters: Partial<TaskFiltersState>;
  groupBy: GroupBy;
  view: TaskView;
}
function readSaved(userId: string): SavedTaskView | null {
  try {
    const raw = localStorage.getItem(`${SAVED_KEY}:${userId}`);
    return raw ? (JSON.parse(raw) as SavedTaskView) : null;
  } catch {
    return null;
  }
}
function writeSaved(userId: string, value: SavedTaskView) {
  try {
    localStorage.setItem(`${SAVED_KEY}:${userId}`, JSON.stringify(value));
  } catch {
    /* private mode ฯลฯ — แค่ไม่จำ */
  }
}

/** คีย์ใน URL ที่หน้านี้เป็นเจ้าของ (ตัวกรอง + มุมมอง) — คีย์อื่น (task, taskTitle, บอร์ดรายคน/แผนก ฯลฯ) ห้ามแตะ */
const FILTER_URL_KEYS = ["dept", "assignee", "priority", "penalty", "preset", "from", "to", "view", "project"] as const;

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
  // visit should restore them) · ไม่มีตัวกรองใน URL = ใช้ที่จำไว้ในเครื่อง (ดู SAVED_KEY)
  // ไม่ล้างตอนออกจากหน้าแล้ว — ค่าที่เลือกไว้ต้องอยู่ต่อตอนกลับมา
  const [restored, setRestored] = useState(false);
  const [urlHadFilters, setUrlHadFilters] = useState<boolean | null>(null);
  useEffect(() => {
    const dept = searchParams.get("dept");
    const assignee = searchParams.get("assignee");
    const penalty = searchParams.get("penalty");
    const patch: Partial<typeof filters> = {};
    if (dept) patch.departmentId = dept;
    if (assignee) patch.assigneeId = assignee;
    if (penalty && ["overdue", "pending", "docked"].includes(penalty)) patch.penalty = penalty as PenaltyFilter;
    if (Object.keys(patch).length > 0) setFilters(patch);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrlHadFilters(Object.keys(patch).length > 0 || !!searchParams.get("view"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // กู้ค่าที่จำไว้ — รอให้รู้ก่อนว่าเป็นใคร (identity โหลดจากเครื่องช้ากว่าหน้านี้นิดหนึ่ง ไม่งั้นอ่านของอีกคน)
  const [identityReady, setIdentityReady] = useState(() => useIdentityStore.persist.hasHydrated());
  useEffect(() => {
    if (identityReady) return;
    return useIdentityStore.persist.onFinishHydration(() => setIdentityReady(true));
  }, [identityReady]);
  useEffect(() => {
    if (restored || urlHadFilters === null || !identityReady || !viewingAsUserId) return;
    if (!urlHadFilters) {
      const saved = readSaved(viewingAsUserId);
      if (saved) {
        // เริ่มจากค่าเริ่มต้นก่อน แล้วค่อยทับด้วยที่จำไว้ — ช่องที่เพิ่มทีหลัง/ค่าที่เสียไม่ค้าง
        resetFilters();
        if (saved.filters && typeof saved.filters === "object") setFilters(saved.filters);
        // จัดกลุ่มเหลือแค่ สถานะ/ความสำคัญ — ที่จำไว้เป็น "คน" กลับไปสถานะ
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (saved.groupBy === "status" || saved.groupBy === "priority") setGroupBy(saved.groupBy);
        if (saved.view === "grid" || saved.view === "workload") setView(saved.view);
      }
    }
    setRestored(true);
  }, [restored, urlHadFilters, identityReady, viewingAsUserId, resetFilters, setFilters]);

  // จำทุกครั้งที่เปลี่ยน (หลังกู้ค่าเดิมเสร็จแล้วเท่านั้น ไม่งั้นค่าเริ่มต้นทับของที่จำไว้)
  useEffect(() => {
    if (restored) writeSaved(viewingAsUserId, { filters, groupBy, view });
  }, [restored, viewingAsUserId, filters, groupBy, view]);

  // Mirror filters + view into the URL (replace — no history entry per
  // keystroke) so a refresh doesn't silently reset the board and a filtered
  // view can be shared with a teammate via the link.
  //
  // แก้เฉพาะคีย์ของตัวกรอง/มุมมอง — คีย์อื่นใน URL ต้องอยู่ครบ โดยเฉพาะ ?task= (เปิดหน้าต่างงาน
  // จากแจ้งเตือน/ลิงก์) เดิมสร้าง URL ใหม่จากตัวกรองล้วน ๆ ทันทีที่หน้าเปิด ?task= เลยหาย
  // หน้าต่างงานปิด ("กดแจ้งเตือนแล้วเด้งมาหน้าบอร์ด ต้องกดอีกทีถึงขึ้นงาน" — ครั้งที่สองได้เพราะ
  // อยู่บนบอร์ดแล้ว ตัวกรองไม่เปลี่ยน effect นี้ไม่ทำงาน)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const key of FILTER_URL_KEYS) params.delete(key);
    if (filters.departmentId !== "all") params.set("dept", filters.departmentId);
    if (filters.assigneeId !== "all") params.set("assignee", filters.assigneeId);
    if (filters.penalty !== "all") params.set("penalty", filters.penalty);
    // บอร์ดไม่มีงานโปรเจกต์เสมอ (projectId ล็อก "none" ด้านล่าง) — ไม่ต้องใส่ใน URL
    if (view !== "board") params.set("view", view);
    const query = params.toString();
    // ไม่มีอะไรเปลี่ยน = ไม่ต้องเขียนทับ (ไม่ไปกวนการนำทางที่กำลังเกิดขึ้น)
    if (query === window.location.search.replace(/^\?/, "")) return;
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [filters, view, pathname, router]);

  // Workload compares everyone's load side by side — a manager-only view,
  // same as the dashboard's leaderboard/department chart. Bounce off it
  // (adjusted during render, not an effect) if a non-head is on it when
  // they switch identity away from being a head.
  if (!isHead && view === "workload") setView("board");

  // Non-heads only ever see their own tasks (see canSeeTask).
  const visibleTasks = useMemo(() => tasks.filter((t) => canSeeTask(t, viewingAsUserId)), [tasks, viewingAsUserId]);

  // แถวตัวเลข (TaskBoardKpis) เป็นที่เดียวที่ตั้ง/ล้าง quickView ได้ — เอาแถวออกแล้ว ค่าที่ค้างอยู่
  // (ใน store หรือที่จำไว้ในเครื่อง) จะซ่อนงานโดยไม่มีปุ่มให้ล้าง เลยล้างทิ้งเสมอ
  useEffect(() => {
    if (filters.quickView !== "all") setFilters({ quickView: "all" });
  }, [filters.quickView, setFilters]);

  // งานโปรเจกต์อยู่หน้าโปรเจกต์อย่างเดียว ไม่ขึ้นบนบอร์ด ("เอาโปรเจกออกจาก task ไปอยู่ของโปรเจกเอง กันงง")
  // ช่อง "โปรเจกต์" ในตัวกรองเอาออกแล้ว — ลิงก์เก่า ?project= หรือค่าที่จำไว้ในเครื่องก็ไม่ดึงงานโปรเจกต์กลับมา
  // (FILTER_URL_KEYS ยังมี "project" ไว้ลบคีย์เก่าออกจาก URL) · มุมมองภาระงานยังนับงานโปรเจกต์ตามเดิม (workload-view.tsx)
  useEffect(() => {
    if (filters.projectId !== "none") setFilters({ projectId: "none" });
  }, [filters.projectId, setFilters]);

  // ตัวกรองช่วงเวลา (กำหนดส่ง วันนี้/สัปดาห์/เดือน/กำหนดเอง) ตัดทิ้งแล้ว (ผู้ใช้ขอ 18/10/2569) — ลิงก์เก่า ?preset=
  // หรือค่าที่จำไว้ในเครื่องต้องไม่กรองงานแบบมองไม่เห็น (FILTER_URL_KEYS ยังมี preset/from/to ไว้ลบคีย์เก่าออกจาก URL)
  useEffect(() => {
    if (filters.preset !== "all") setFilters({ preset: "all", customFrom: "", customTo: "" });
  }, [filters.preset, setFilters]);
  // ตัวกรองความสำคัญก็ตัดทิ้งแล้ว (ผู้ใช้ขอ 18/10/2569) — ลิงก์เก่า ?priority= / ค่าที่จำไว้ ห้ามกรองแบบมองไม่เห็น
  // (การจัดกลุ่มตามความสำคัญบนบอร์ดเป็นอีกเรื่อง ยังใช้ได้)
  useEffect(() => {
    if (filters.priority !== "all") setFilters({ priority: "all" });
  }, [filters.priority, setFilters]);

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

  /*
   * มือถือ (<640px) — บอร์ดเต็มพื้นที่แบบแชท/รายงาน: ทุกอย่างที่เคยเป็นแถวของตัวเองเหนือการ์ดงาน
   * (ปุ่มสลับมุมมอง · ตัวกรอง · สร้างงานใหม่ · ชิปตัวเลข) ย้ายไปอยู่บนแถบหัว/ปุ่มลอย เหลือใต้แถบหัว
   * แค่แถบแท็บคอลัมน์ของบอร์ด (kanban-board.tsx) แล้วเป็นการ์ดงานทั้งจอ · ≥640px เหมือนเดิมทุกอย่าง
   * หน้าเป็นคนถือสถานะเปิด/ปิดของแผ่นตัวกรองกับหน้าต่างสร้างงาน เพราะปุ่มอยู่บนแถบหัว คนละต้นไม้กับ TaskFilters
   */
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  /*
   * ทุกขนาดจอ (เดิมเฉพาะมือถือ) — แบบหน้ารายงาน: แท็บมุมมอง + ปุ่ม "ตัวกรอง" อยู่บนแถบหัวแทนชื่อหน้า
   * แถวตัวกรองเต็มแถวเดิมเหนือบอร์ดหายไป กดปุ่มตัวกรองแล้วเลือกจากป๊อปอัปตรงนั้น ("เคลีย space ของ task
   * ... อยากได้แบบของ report") · สร้างงานใหม่เป็นปุ่มลอย + มุมขวาล่าง
   */
  const appBarLeading = useMemo(
    () => (
      <div className="flex w-full min-w-0 items-center gap-2 pl-1 sm:pl-2">
        <span className="text-[17px] font-bold text-(--ink) sm:hidden">Tasks</span>
        {!personBoardId && (
          <>
            {/* แท็บที่เลือก = พื้นกรมท่า (สีตัวอักษร Boss ในโลโก้) — สีกลาง ไม่ใช้เขียวเพราะเขียวในเว็บแปลว่า "เสร็จ" · hover = พื้นขาว ลอยขึ้นนิด ขอบ+เงาบาง ไอคอนขยาย */}
            <div className="flex items-center gap-0.5 rounded-[10px] border border-slate-200 bg-slate-100 p-[3px] sm:gap-1 sm:rounded-xl sm:p-1">
              {tabs.map((t) => {
                const TabIcon = t.icon;
                const activeTab = view === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    data-tour={t.id === "board" ? "task-view-board" : t.id === "grid" ? "task-view-grid" : undefined}
                    onClick={() => setView(t.id)}
                    aria-label={`มุมมอง${t.label}`}
                    aria-pressed={activeTab}
                    title={t.label}
                    className={cn(
                      "group flex h-[38px] cursor-pointer w-10 items-center justify-center gap-1.5 rounded-lg transition-all duration-200 active:scale-[0.96] sm:h-auto sm:w-auto sm:px-4 sm:py-[7px] sm:text-[13px] sm:font-semibold",
                      activeTab
                        ? "bg-[var(--brand-navy)] text-white shadow-[0_2px_10px_rgba(27,37,55,0.3)] hover:bg-[#2b3a52]"
                        : "text-slate-600 hover:-translate-y-px hover:bg-white hover:text-[var(--brand-navy)] hover:shadow-[0_2px_8px_rgba(27,37,55,0.12)] hover:ring-1 hover:ring-[var(--brand-navy)]/15"
                    )}
                  >
                    <TabIcon className="h-[18px] w-[18px] transition-transform duration-200 group-hover:scale-110 sm:h-3.5 sm:w-3.5" />
                    <span className="hidden sm:inline">{t.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="ml-auto flex items-center">
              <TaskFilters
                bar
                groupBy={view === "board" ? groupBy : undefined}
                onGroupByChange={setGroupBy}
                resultCount={filteredTaskCount}
                mobile={{
                  sheetOpen: mobileFilterOpen,
                  onSheetOpenChange: setMobileFilterOpen,
                  newTaskOpen,
                  onNewTaskOpenChange: setNewTaskOpen,
                }}
              />
            </div>
          </>
        )}
      </div>
    ),
    // tabs สร้างใหม่ทุกครั้งที่ render แต่ขึ้นกับ isHead อย่างเดียว
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, isHead, personBoardId, groupBy, filteredTaskCount, mobileFilterOpen, newTaskOpen]
  );
  useSetAppBarLeading(appBarLeading);

  return (
    <div className="flex h-full min-h-0 flex-col sm:gap-4 sm:pb-6 lg:pb-4">

      {/* แถวตัวเลข (ทั้งหมด / รอดำเนินการ / กำลังทำ / …) เอาออกแล้ว ("ตรงนี้ไม่เอา") — หัวคอลัมน์บอกจำนวนอยู่แล้ว
          "เลยกำหนด" อยู่ในตัวกรองด่วน */}
      {!loaded ? (
        <BoardSkeleton />
      ) : view === "board" ? (
        // Board (and its person-drill-down) manage their own scroll — the
        // filter bar + KPI tiles above stay put instead of scrolling away
        // with the cards, and only the board's own area (columns
        // horizontally, each column's card list vertically) scrolls. See
        // kanban-board.tsx's own comment on why.
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <KanbanBoard groupBy={groupBy} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-24 sm:p-0">
          {view === "grid" && <TaskGridView />}
          {view === "workload" && <WorkloadView />}
        </div>
      )}

      {/* "สร้างงานใหม่" เป็นปุ่มลอย + ทุกขนาดจอ (มือถือ/แท็บเล็ตลอยเหนือแถบเมนูล่าง · จอใหญ่มุมขวาล่าง) */}
      {!personBoardId && (
        <button
          type="button"
          onClick={() => setNewTaskOpen(true)}
          aria-label="สร้างงานใหม่"
          title="สร้างงานใหม่"
          className="fixed bottom-[82px] right-3.5 z-30 flex h-14 w-14 items-center justify-center rounded-[18px] bg-[var(--brand-green-dark)] text-white shadow-[0_6px_16px_rgba(23,51,47,0.28)] transition-transform hover:brightness-110 active:scale-95 lg:bottom-6 lg:right-6"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}
    </div>
  );
}

/** Column-shaped placeholder shown while the file-backed task data loads. */
function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden px-3 pt-4 sm:px-0 lg:pt-6">
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
