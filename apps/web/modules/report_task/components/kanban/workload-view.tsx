"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";
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
import { useMaintenanceBoardStore } from "@/modules/report_task/store/maintenance-board-store";
import { MAINTENANCE_KIND } from "./maintenance-card";

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
  // เปิดทั้ง "งาน" และ "ใบงานซ่อม" ในตัวกรอง = แถบ/สถานะเป็นยอดรวมสองแบบ ต้องบอกแยกว่างานกี่ ใบงานกี่
  // เปิดแบบเดียว = รู้อยู่แล้วว่าดูอะไร ไม่ต้องบอก (ผู้ใช้ขอ 20/10/2569)
  const boardKinds = useMaintenanceBoardStore((s) => s.kinds);
  const bothKinds = boardKinds.task && boardKinds.wo;
  const unit = bothKinds ? "รายการ" : boardKinds.wo ? "ใบ" : "งาน";

  const rows = useMemo(() => {
    return usersInScope
      .map((u) => {
        const mine = shownTasks.filter((t) => t.assigneeIds.includes(u.id));
        const mx = shownMx.filter((i) => i.responsibleId === u.id);
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
        return { user: u, total, todo, inProgress, overdue, done, open, wo: mx.length, taskCount: mine.length };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total || b.open - a.open || b.overdue - a.overdue);
  }, [shownTasks, shownMx, usersInScope]);

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
            <div key={r.user.id} className="flex flex-col gap-2.5 px-4 py-3.5 hover:bg-[var(--bg-soft)] transition-colors sm:flex-row sm:items-center sm:gap-3 sm:px-5 sm:py-3">
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
                    {bothKinds && (
                      <p className="mt-2 text-[11px] text-[var(--ink-soft)]">
                        แยกเป็น 📋 งาน {r.taskCount} · {MAINTENANCE_KIND.wo.icon} ใบงานซ่อม {r.wo}
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
                  {bothKinds && (
                    <span
                      className="items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-2 py-0.5 hidden sm:inline-flex"
                      title="ตัวเลขสถานะคืองาน + ใบงานซ่อมรวมกัน"
                    >
                      <span className="font-medium text-[var(--ink)]">📋 งาน {r.taskCount}</span>
                      <span className="text-[var(--line)]">|</span>
                      <span className="font-medium" style={{ color: MAINTENANCE_KIND.wo.color }}>
                        {MAINTENANCE_KIND.wo.icon} ใบงานซ่อม {r.wo}
                      </span>
                    </span>
                  )}
                  {overloaded && <span className="text-[10px] rounded-full bg-amber-50 text-[var(--chart-amber)] px-1.5 py-0.5">งานเยอะ</span>}
                </div>
                {/* มือถือ: แถวสถานะด้านบนเลื่อนซ้ายขวา ตัวแยกงาน/ใบงานซ่อมเลยลงบรรทัดของตัวเอง ไม่ให้ตกขอบจอ */}
                {bothKinds && (
                  <div className="mt-2 flex text-[12.5px] sm:hidden">
                    <span
                      className="items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-2 py-0.5 inline-flex"
                      title="ตัวเลขสถานะคืองาน + ใบงานซ่อมรวมกัน"
                    >
                      <span className="font-medium text-[var(--ink)]">📋 งาน {r.taskCount}</span>
                      <span className="text-[var(--line)]">|</span>
                      <span className="font-medium" style={{ color: MAINTENANCE_KIND.wo.color }}>
                        {MAINTENANCE_KIND.wo.icon} ใบงานซ่อม {r.wo}
                      </span>
                    </span>
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
            </div>
          );
        })}
      </div>

      {(expanded || remaining > 0) && (
        <div className="border-t border-[var(--line)] px-4 py-3 sm:px-5">
          <ShowMoreToggle expanded={expanded} remaining={remaining} onToggle={toggle} />
        </div>
      )}
    </div>
  );
}
