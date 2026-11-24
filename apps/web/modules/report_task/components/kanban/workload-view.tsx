"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { getDepartment, scopedUsers } from "@/modules/report_task/lib/directory";
import { matchesTaskFilters } from "@/modules/report_task/lib/task-filter";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { cn } from "@/modules/report_task/lib/utils";
import { useShowMore } from "@/modules/report_task/hooks/use-show-more";
import { ShowMoreToggle } from "@/modules/report_task/components/shared/show-more-toggle";
import { useBoardMaintenance } from "@/modules/report_task/hooks/use-board-maintenance";
import { useProjectStore } from "@/modules/report_task/store/project-store";
import { useTaskSheetParam } from "@/modules/report_task/hooks/use-task-sheet-param";
import { formatShortDate } from "@/modules/report_task/lib/format";
import type { MaintenanceBoardItem } from "@/modules/report_task/lib/maintenance-board";
import type { Task } from "@/modules/report_task/types";
import { MAINTENANCE_KIND } from "./maintenance-card";
import { TaskDetailSheet } from "./task-detail-sheet";

/** ประเภทในภาระงานรายคน — งานทั่วไป / งานโปรเจกต์ / ใบงานซ่อม (ผู้ใช้ 24/11/2569 ให้เห็นครบทั้งสามในรายคน) */
const KIND_META = {
  task: { icon: "📋", label: "งาน" },
  project: { icon: "📁", label: "โปรเจกต์" },
  wo: { icon: MAINTENANCE_KIND.wo.icon, label: "ใบงานซ่อม" },
} as const;
type WorkKind = keyof typeof KIND_META;

/** แถวเดียวในรายการงานของคนนั้น — งาน/โปรเจกต์เปิดหน้าต่างงาน · ใบงานซ่อมไปหน้าแจ้งซ่อมแบบการ์ดบนบอร์ด */
interface WorkItem {
  key: string;
  kind: WorkKind;
  title: string;
  /** ชื่อโปรเจกต์ / รหัสใบงาน */
  sub: string | null;
  due: string | null;
  overdue: boolean;
  status: "todo" | "in_progress";
  open: () => void;
}

function sortItems(a: WorkItem, b: WorkItem) {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (!a.due || !b.due) return a.due ? -1 : b.due ? 1 : 0;
  return a.due.localeCompare(b.due);
}

/** One legend/breakdown row shared between the bar's click-to-open popover and its color key. */
function BarBreakdownRow({ color, label, count, total }: { color: string; label: string; count: number; total: number }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="flex items-center gap-1.5 text-[var(--ink-soft)]">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="font-medium tabular-nums">{count} งาน · {pct}%</span>
    </div>
  );
}

/** "📋 งาน 3 | 📁 โปรเจกต์ 1 | 🔧 ใบงานซ่อม 2" — แสดงเฉพาะประเภทที่มีอยู่ในหน้านี้ */
function KindSplit({ counts, present }: { counts: Record<WorkKind, number>; present: Record<WorkKind, boolean> }) {
  const kinds = (Object.keys(KIND_META) as WorkKind[]).filter((k) => present[k]);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-2 py-0.5"
      title="ตัวเลขสถานะคืองาน + งานโปรเจกต์ + ใบงานซ่อมรวมกัน"
    >
      {kinds.map((k, i) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-[var(--line)]">|</span>}
          <span className="font-medium" style={{ color: k === "wo" ? MAINTENANCE_KIND.wo.color : "var(--ink)" }}>
            {KIND_META[k].icon} {KIND_META[k].label} {counts[k]}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Workload view (Asana/ClickUp-style): each person's open load at a glance, with
 * overdue highlighted — so it's obvious who's overloaded or slipping. Read-only,
 * respects the shared filter bar. Volume only (no score) — see the Reports page
 * for performance scoring; this view is purely "how much is on their plate."
 *
 * ใบงานซ่อม (ชุดเดียวกับบอร์ด/ตาราง — useBoardMaintenance) นับรวมในแถบของ "ผู้รับผิดชอบ" ของใบนั้น
 * — รอดำเนินการ = รอดำเนินการ · กำลังซ่อม = กำลังทำ
 */
export function WorkloadView() {
  const tasks = useVisibleTasks();
  const filters = useTaskStore((s) => s.filters);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);

  // Same scope as everywhere else in the board: owner sees the whole
  // company, a department head sees only the department(s) they head — a
  // head should never see other departments' people/workload here just
  // because they can open this tab (see lib/directory.ts's scopedUsers).
  //
  // scopedUsers reads `users`/`departments` through a plain JS Proxy over
  // these two stores, not a reactive selector — subscribing here is what
  // makes this recompute once the real employee/department list lands async
  // right after mount, instead of getting stuck on the placeholder-record
  // first render forever (same fix as task-filters.tsx/dashboard-filters.tsx).
  const employeesForScope = useEmployeeStore((s) => s.employees);
  const departmentsForScope = useDepartmentStore((s) => s.departments);
  const usersInScope = useMemo(
    () => scopedUsers(viewingAsUserId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- employeesForScope/departmentsForScope are read internally by scopedUsers via the module-level proxy, not directly here; dropping them reintroduces the staleness bug.
    [viewingAsUserId, employeesForScope, departmentsForScope]
  );

  // ภาระงานนับรวมงานโปรเจกต์เสมอ (งานโปรเจกต์ก็คืองานของคนนั้น) — ค่าเริ่มต้นของบอร์ดซ่อนงานโปรเจกต์
  // ถ้าใช้ตามตัวกรอง หัวหน้าจะเห็นภาระน้อยกว่าจริง · เลือกโปรเจกต์ใดโปรเจกต์หนึ่ง = ดูเฉพาะโปรเจกต์นั้นได้ตามเดิม
  const filtered = useMemo(
    () => tasks.filter((t) => matchesTaskFilters(t, filters.projectId === "none" ? { ...filters, projectId: "all" } : filters)),
    [tasks, filters]
  );
  const { shownTasks, shownMx } = useBoardMaintenance(filtered, filters);

  const rows = useMemo(() => {
    return usersInScope
      .map((u) => {
        const mine = shownTasks.filter((t) => t.assigneeIds.includes(u.id));
        // ใบกลุ่ม: สมาชิกทุกคนมีใบนี้อยู่ในมือ ไม่ใช่แค่คนรับผิดชอบหลัก
        const mx = shownMx.filter((i) => i.responsibleId === u.id || (i.groupMemberIds ?? []).includes(u.id));
        // 4 กลุ่มไม่ซ้อนกัน (รวมกันได้เท่า total พอดี) — ที่เลยกำหนดไปอยู่ "เลยกำหนด" อย่างเดียว ไม่นับซ้ำใน
        // รอดำเนินการ/กำลังทำ (เดิมงานรอดำเนินการที่เลยกำหนดถูกนับสองที่ แถบเกิน 100%)
        const taskOverdue = (t: (typeof mine)[number]) => dueUrgency(t) === "overdue";
        const todo =
          mine.filter((t) => t.status === "todo" && !taskOverdue(t)).length +
          mx.filter((i) => (i.column === "todo" || i.column === "review") && !i.overdue).length;
        const inProgress =
          mine.filter((t) => t.status === "in_progress" && !taskOverdue(t)).length +
          mx.filter((i) => i.column === "in_progress" && !i.overdue).length;
        const overdue = mine.filter(taskOverdue).length + mx.filter((i) => i.overdue).length;
        const done = mine.filter((t) => t.status === "done").length + mx.filter((i) => i.column === "done").length;
        const total = mine.length + mx.length;
        const open = total - done;
        const projectCount = mine.filter((t) => !!t.project).length;
        return {
          user: u,
          total,
          todo,
          inProgress,
          overdue,
          done,
          open,
          wo: mx.length,
          taskCount: mine.length - projectCount,
          projectCount,
          openTasks: mine.filter((t) => t.status !== "done"),
          openMx: mx.filter((i) => i.column !== "done"),
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total || b.open - a.open || b.overdue - a.overdue);
  }, [shownTasks, shownMx, usersInScope]);

  // หน่วย/ป้ายแยกประเภท — เห็นมากกว่าหนึ่งประเภท = บอกแยกว่าแต่ละแบบกี่รายการ
  const kindsPresent = useMemo(() => {
    const k = { task: false, project: false, wo: false };
    for (const r of rows) {
      if (r.taskCount) k.task = true;
      if (r.projectCount) k.project = true;
      if (r.wo) k.wo = true;
    }
    return k;
  }, [rows]);
  const mixed = [kindsPresent.task, kindsPresent.project, kindsPresent.wo].filter(Boolean).length > 1;
  const unit = mixed ? "รายการ" : kindsPresent.wo ? "ใบ" : "งาน";

  const router = useRouter();
  const { openTaskId, open: openTask, close: closeTaskSheet } = useTaskSheetParam();
  const projects = useProjectStore((s) => s.projects);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const itemsOf = (r: (typeof rows)[number]): WorkItem[] => {
    const fromTask = (t: Task): WorkItem => {
      const p = t.project ? projects.find((x) => x.id === t.project!.projectId) : undefined;
      return {
        key: `t-${t.id}`,
        kind: t.project ? "project" : "task",
        title: t.title,
        sub: t.project ? (p?.name ?? "โปรเจกต์") : null,
        due: t.dueDate || null,
        overdue: dueUrgency(t) === "overdue",
        status: t.status === "in_progress" ? "in_progress" : "todo",
        open: () => openTask(t.id),
      };
    };
    const fromMx = (i: MaintenanceBoardItem): WorkItem => ({
      key: `w-${i.id}`,
      kind: "wo",
      title: i.title,
      sub: [i.code, i.place].filter(Boolean).join(" · ") || null,
      due: i.dueDate,
      overdue: i.overdue,
      status: i.column === "in_progress" ? "in_progress" : "todo",
      open: () => router.push(`${i.href}?from=tasks`),
    });
    return [...r.openTasks.map(fromTask), ...r.openMx.map(fromMx)].sort(sortItems);
  };
  const counts = (r: (typeof rows)[number]): Record<WorkKind, number> => ({ task: r.taskCount, project: r.projectCount, wo: r.wo });

  const { visible: visibleRows, remaining, expanded, toggle } = useShowMore(rows, 10);

  if (rows.length === 0) {
    return <EmptyState icon={Users} title="ไม่พบภาระงานตามตัวกรอง" description="ลองปรับหรือล้างตัวกรองด้านบน" />;
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white overflow-hidden shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="px-4 py-3.5 border-b sm:px-5 border-[var(--line)]">
        <h3 className="font-semibold text-sm">ภาระงานรายคน</h3>
        <p className="text-xs text-[var(--ink-soft)] mt-0.5">เรียงตามจำนวนงานทั้งหมดมากไปน้อย · แถบแดง = เลยกำหนด</p>
      </div>

      <div className="divide-y divide-[var(--line)]">
        {visibleRows.map((r) => {
          // Full width = every task this person has, not just the still-open
          // ones — a bar that only ever shows "open" work can never visibly
          // reach "done", which undersells how much has actually shipped.
          const seg = (n: number) => (r.total ? (n / r.total) * 100 : 0);
          const inProgressNotOverdue = r.inProgress;
          const overloaded = r.open >= 6;
          return (
            // <640px: stacks into 2 lines (avatar+name+total, then the bar +
            // legend) instead of squeezing a fixed w-40 name column, the bar,
            // and the total badge all onto one row. ≥640px is the original
            // single row — `sm:contents` makes the avatar+name wrapper (and
            // the mobile-only total badge inside it) disappear from layout
            // there, so its children fall back into the row exactly as
            // before instead of nesting an extra box.
            <div key={r.user.id}>
            <div className="flex flex-col gap-2.5 px-4 py-3.5 hover:bg-[var(--bg-soft)] transition-colors sm:flex-row sm:items-center sm:gap-3 sm:px-5 sm:py-3">
              <div className="flex items-center gap-3 sm:contents">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage src={r.user.avatarUrl ?? undefined} alt={r.user.name} />
                  <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{r.user.avatar}</AvatarFallback>
                </Avatar>

                <div className="w-40 shrink-0 min-w-0">
                  <p className="text-[15px] font-medium truncate sm:text-sm">{r.user.name}</p>
                  <p className="text-[11px] text-[var(--ink-soft)] truncate">{getDepartment(r.user.departmentId)?.name}</p>
                </div>

                {/* Mobile-only — same total badge as the desktop one at the
                    end of the row (below), just pulled up onto line 1 here
                    since mobile's line order is avatar/name/total, then bar. */}
                <span
                  className="ml-auto shrink-0 text-xs font-semibold tabular-nums rounded-md ring-1 ring-inset ring-[var(--line)] bg-[var(--bg-soft)] text-[var(--ink)] px-2 py-1 sm:hidden"
                  title="งานทั้งหมดของคนนี้"
                >
                  {r.total} {unit}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                {/* Click (not just hover) opens the full breakdown — % of
                    this person's total, not just a raw count — since hover
                    alone doesn't work on touch and a native title tooltip
                    can't show more than one line at a time. */}
                <Popover>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        className="block w-full cursor-pointer"
                        aria-label={`ดูสัดส่วนงานของ ${r.user.name}`}
                      >
                        <div className="h-2.5 rounded-full bg-[var(--bg-soft)] overflow-hidden flex">
                          {r.todo > 0 && <div className="h-full" style={{ width: `${seg(r.todo)}%`, backgroundColor: "#94a3b8" }} />}
                          {inProgressNotOverdue > 0 && (
                            <div className="h-full" style={{ width: `${seg(inProgressNotOverdue)}%`, backgroundColor: "var(--chart-amber)" }} />
                          )}
                          {r.overdue > 0 && <div className="h-full" style={{ width: `${seg(r.overdue)}%`, backgroundColor: "var(--chart-red)" }} />}
                          {r.done > 0 && <div className="h-full" style={{ width: `${seg(r.done)}%`, backgroundColor: "var(--chart-green)" }} />}
                        </div>
                      </button>
                    }
                  />
                  <PopoverContent align="start" className="w-56">
                    <p className="text-xs font-semibold mb-0.5">งานของ {r.user.name}</p>
                    <div className="space-y-1.5">
                      <BarBreakdownRow color="#94a3b8" label="รอดำเนินการ" count={r.todo} total={r.total} />
                      <BarBreakdownRow color="var(--chart-amber)" label="กำลังทำ" count={inProgressNotOverdue} total={r.total} />
                      <BarBreakdownRow color="var(--chart-red)" label="เลยกำหนด" count={r.overdue} total={r.total} />
                      <BarBreakdownRow color="var(--chart-green)" label="เสร็จ" count={r.done} total={r.total} />
                    </div>
                    {mixed && (
                      <p className="mt-2 text-[11px] text-[var(--ink-soft)]">
                        แยกเป็น{" "}
                        {(Object.keys(KIND_META) as WorkKind[])
                          .filter((k) => kindsPresent[k])
                          .map((k) => `${KIND_META[k].icon} ${KIND_META[k].label} ${counts(r)[k]}`)
                          .join(" · ")}
                      </p>
                    )}
                    <div className="mt-2 pt-2 border-t border-[var(--line)] flex items-center justify-between text-xs font-medium">
                      <span className="text-[var(--ink-soft)]">รวมทั้งหมด</span>
                      <span>{r.total} {unit}</span>
                    </div>
                  </PopoverContent>
                </Popover>
                {/* Same 4 categories, same colored dots, as the click-to-open
                    breakdown popover above — this row used to only show 3
                    (no "รอดำเนินการ"), reading as a different, incomplete
                    summary of the exact same bar sitting right above it. */}
                {/* มือถือ: ตัวใหญ่ขึ้น (12.5px) และตัดขึ้นบรรทัดใหม่แทนเลื่อนซ้ายขวา — เดิมแถวเดียวเลื่อนได้
                    ตัวเลขท้าย ๆ ตกขอบจอ ต้องปัดถึงเห็น (ผู้ใช้ขอ 20/10/2569 "ปรับขนาดในมือถือให้เหมาะสม")
                    ≥640px เหมือนเดิม */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-[12.5px] text-[var(--ink-soft)] sm:gap-x-2.5 sm:mt-1.5 sm:text-[11px]">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full shrink-0 sm:h-1.5 sm:w-1.5" style={{ backgroundColor: "#94a3b8" }} />
                    รอดำเนินการ {r.todo}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full shrink-0 sm:h-1.5 sm:w-1.5" style={{ backgroundColor: "var(--chart-amber)" }} />
                    กำลังทำ {inProgressNotOverdue}
                  </span>
                  <span className={cn("flex items-center gap-1", r.overdue > 0 && "text-[var(--chart-red)] font-medium")}>
                    <span className="h-2 w-2 rounded-full shrink-0 sm:h-1.5 sm:w-1.5" style={{ backgroundColor: "var(--chart-red)" }} />
                    เลยกำหนด {r.overdue}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full shrink-0 sm:h-1.5 sm:w-1.5" style={{ backgroundColor: "var(--chart-green)" }} />
                    เสร็จ {r.done}
                  </span>
                  {mixed && (
                    <span className="hidden sm:inline-flex">
                      <KindSplit counts={counts(r)} present={kindsPresent} />
                    </span>
                  )}
                  {overloaded && <span className="text-[10px] rounded-full bg-amber-50 text-[var(--chart-amber)] px-1.5 py-0.5">งานเยอะ</span>}
                </div>
                {/* มือถือ: แถวสถานะด้านบนเลื่อนซ้ายขวา ตัวแยกงาน/ใบงานซ่อมเลยลงบรรทัดของตัวเอง ไม่ให้ตกขอบจอ */}
                {mixed && (
                  <div className="mt-2 flex text-[12.5px] sm:hidden">
                    <KindSplit counts={counts(r)} present={kindsPresent} />
                  </div>
                )}
              </div>

              {/* Total task count — replaces the old score badge here, since
                  this view is about workload volume, not performance
                  (score/rating still lives on the Reports page). Hidden on
                  mobile since the copy above (line 1) already shows it. */}
              <span
                className="hidden shrink-0 text-xs font-semibold tabular-nums rounded-md ring-1 ring-inset ring-[var(--line)] bg-[var(--bg-soft)] text-[var(--ink)] px-2 py-1 sm:inline-block"
                title="งานทั้งหมดของคนนี้"
              >
                {r.total} {unit}
              </span>

              {/* กดดูรายการที่ยังค้างของคนนี้ — งาน / งานโปรเจกต์ / ใบงานซ่อม ในลิสต์เดียว เลยกำหนดขึ้นก่อน */}
              <button
                type="button"
                onClick={() => setExpandedId((id) => (id === r.user.id ? null : r.user.id))}
                aria-expanded={expandedId === r.user.id}
                className="inline-flex shrink-0 items-center justify-center gap-1 self-start rounded-md px-2 py-1 text-xs font-medium text-[var(--ink-soft)] ring-1 ring-inset ring-[var(--line)] hover:bg-white hover:text-[var(--ink)] sm:self-auto"
              >
                ดูรายการ {r.open}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expandedId === r.user.id && "rotate-180")} />
              </button>
            </div>
            {expandedId === r.user.id && <PersonItemList items={itemsOf(r)} doneCount={r.done} />}
            </div>
          );
        })}
      </div>

      {(expanded || remaining > 0) && (
        <div className="border-t border-[var(--line)] px-4 py-3 sm:px-5">
          <ShowMoreToggle expanded={expanded} remaining={remaining} onToggle={toggle} />
        </div>
      )}
      <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && closeTaskSheet()} />
    </div>
  );
}

/** รายการที่ยังค้างของคนหนึ่ง (ไม่รวมที่เสร็จแล้ว) — แยกประเภทด้วยไอคอน กดแล้วเปิดงาน/ใบงานนั้น */
function PersonItemList({ items, doneCount }: { items: WorkItem[]; doneCount: number }) {
  const { visible, remaining, expanded, toggle } = useShowMore(items, 8);
  return (
    <div className="border-t border-[var(--line)] bg-[var(--bg-soft)] px-4 py-2.5 sm:px-5 sm:pl-[68px]">
      {items.length === 0 ? (
        <p className="py-1 text-xs text-[var(--ink-soft)]">ไม่มีงานค้าง · เสร็จแล้ว {doneCount} รายการ</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visible.map((it) => (
            <li key={it.key}>
              <button
                type="button"
                onClick={it.open}
                className="flex w-full items-center gap-2.5 rounded-lg bg-white px-3 py-2 text-left ring-1 ring-inset ring-[var(--line)] hover:ring-[var(--brand-navy)]/30"
              >
                <span className="shrink-0 text-sm" title={KIND_META[it.kind].label} aria-label={KIND_META[it.kind].label}>
                  {KIND_META[it.kind].icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--ink)]">{it.title}</span>
                  {it.sub && <span className="block truncate text-[11px] text-[var(--ink-soft)]">{it.sub}</span>}
                </span>
                <span className="hidden shrink-0 text-[11px] text-[var(--ink-soft)] sm:inline">
                  {it.status === "in_progress" ? "กำลังทำ" : "รอดำเนินการ"}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-right text-[11px] tabular-nums sm:w-[104px]",
                    it.overdue ? "font-semibold text-[var(--chart-red)]" : "text-[var(--ink-soft)]"
                  )}
                >
                  {it.due ? `${it.overdue ? "เลยกำหนด " : "ส่ง "}${formatShortDate(it.due)}` : "ไม่มีกำหนด"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(expanded || remaining > 0) && (
        <div className="pt-1.5">
          <ShowMoreToggle expanded={expanded} remaining={remaining} onToggle={toggle} />
        </div>
      )}
    </div>
  );
}
