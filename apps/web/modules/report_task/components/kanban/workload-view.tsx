"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { getDepartment, scopedUsers } from "@/modules/report_task/lib/directory";
import { matchesTaskFilters } from "@/modules/report_task/lib/task-filter";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";

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
 */
export function WorkloadView() {
  const tasks = useVisibleTasks();
  const filters = useTaskStore((s) => s.filters);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);

  // Same scope as everywhere else in the board: owner sees the whole
  // company, a department head sees only the department(s) they head — a
  // head should never see other departments' people/workload here just
  // because they can open this tab (see lib/directory.ts's scopedUsers).
  const usersInScope = useMemo(() => scopedUsers(viewingAsUserId), [viewingAsUserId]);

  const rows = useMemo(() => {
    const filtered = tasks.filter((t) => matchesTaskFilters(t, filters));
    return usersInScope
      .map((u) => {
        const mine = filtered.filter((t) => t.assigneeIds.includes(u.id));
        const todo = mine.filter((t) => t.status === "todo").length;
        const inProgress = mine.filter((t) => t.status === "in_progress").length;
        const overdue = mine.filter((t) => dueUrgency(t) === "overdue").length;
        const done = mine.filter((t) => t.status === "done").length;
        const open = mine.length - done;
        return { user: u, total: mine.length, todo, inProgress, overdue, done, open };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.open - a.open || b.overdue - a.overdue);
  }, [tasks, filters, usersInScope]);

  if (rows.length === 0) {
    return <EmptyState icon={Users} title="ไม่พบภาระงานตามตัวกรอง" description="ลองปรับหรือล้างตัวกรองด้านบน" />;
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white overflow-hidden shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="px-5 py-3.5 border-b border-[var(--line)]">
        <h3 className="font-semibold text-sm">ภาระงานรายคน</h3>
        <p className="text-xs text-[var(--ink-soft)] mt-0.5">เรียงตามงานที่ยังเปิดอยู่ · แถบแดง = เลยกำหนด</p>
      </div>

      <div className="divide-y divide-[var(--line)]">
        {rows.map((r) => {
          // Full width = every task this person has, not just the still-open
          // ones — a bar that only ever shows "open" work can never visibly
          // reach "done", which undersells how much has actually shipped.
          const seg = (n: number) => (r.total ? (n / r.total) * 100 : 0);
          const inProgressNotOverdue = r.inProgress - r.overdue > 0 ? r.inProgress - r.overdue : 0;
          const overloaded = r.open >= 6;
          return (
            <div key={r.user.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--bg-soft)] transition-colors">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{r.user.avatar}</AvatarFallback>
              </Avatar>

              <div className="w-40 shrink-0 min-w-0">
                <p className="text-sm font-medium truncate">{r.user.name}</p>
                <p className="text-[11px] text-[var(--ink-soft)] truncate">{getDepartment(r.user.departmentId)?.name}</p>
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
                    <div className="mt-2 pt-2 border-t border-[var(--line)] flex items-center justify-between text-xs font-medium">
                      <span className="text-[var(--ink-soft)]">รวมทั้งหมด</span>
                      <span>{r.total} งาน</span>
                    </div>
                  </PopoverContent>
                </Popover>
                <div className="flex items-center gap-2.5 mt-1.5 text-[11px] text-[var(--ink-soft)] flex-wrap">
                  <span>กำลังทำ {inProgressNotOverdue}</span>
                  {r.overdue > 0 && <span className="text-[var(--chart-red)] font-medium">เลยกำหนด {r.overdue}</span>}
                  <span>เสร็จ {r.done}</span>
                  {overloaded && <span className="text-[10px] rounded-full bg-amber-50 text-[var(--chart-amber)] px-1.5 py-0.5">งานเยอะ</span>}
                </div>
              </div>

              {/* Total task count — replaces the old score badge here, since
                  this view is about workload volume, not performance
                  (score/rating still lives on the Reports page). */}
              <span
                className="shrink-0 text-xs font-semibold tabular-nums rounded-md ring-1 ring-inset ring-[var(--line)] bg-[var(--bg-soft)] text-[var(--ink)] px-2 py-1"
                title="งานทั้งหมดของคนนี้"
              >
                {r.total} งาน
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
