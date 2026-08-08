"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { getDepartment, users } from "@/modules/report_task/data/mock";
import { matchesTaskFilters } from "@/modules/report_task/lib/task-filter";
import { buildUserReports } from "@/modules/report_task/lib/reports";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { cn } from "@/modules/report_task/lib/utils";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";

function scoreClass(score: number) {
  if (score >= 80) return "bg-green-50 text-[var(--brand-green-dark)] ring-green-200";
  if (score >= 60) return "bg-amber-50 text-[var(--chart-amber)] ring-amber-200";
  return "bg-red-50 text-[var(--chart-red)] ring-red-200";
}

/**
 * Workload view (Asana/ClickUp-style): each person's open load at a glance, with
 * overdue highlighted — so it's obvious who's overloaded or slipping. Read-only,
 * respects the shared filter bar, and reuses the same scoring as reports.
 */
export function WorkloadView() {
  const tasks = useTaskStore((s) => s.tasks);
  const filters = useTaskStore((s) => s.filters);
  const stickers = useStickerStore((s) => s.stickers);

  const rows = useMemo(() => {
    const filtered = tasks.filter((t) => matchesTaskFilters(t, filters));
    const reports = buildUserReports(filtered, stickers);
    return users
      .map((u) => {
        const mine = filtered.filter((t) => t.assigneeIds.includes(u.id));
        const todo = mine.filter((t) => t.status === "todo").length;
        const inProgress = mine.filter((t) => t.status === "in_progress").length;
        const overdue = mine.filter((t) => dueUrgency(t) === "overdue").length;
        const done = mine.filter((t) => t.status === "done").length;
        const open = mine.length - done;
        const report = reports.find((r) => r.userId === u.id);
        return { user: u, total: mine.length, todo, inProgress, overdue, done, open, score: report?.score ?? 0 };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.open - a.open || b.overdue - a.overdue);
  }, [tasks, filters, stickers]);

  const maxOpen = Math.max(1, ...rows.map((r) => r.open));

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
          const barW = (r.open / maxOpen) * 100;
          // Within the open bar, split todo / in-progress / overdue.
          const seg = (n: number) => (r.open ? (n / r.open) * 100 : 0);
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
                {/* Todo stays neutral gray here on purpose — "overdue" already owns
                    red in this bar's legend ("แถบแดง = เลยกำหนด"), so a plain
                    not-started segment can't also be red without the two
                    becoming indistinguishable. */}
                <div className="h-2.5 rounded-full bg-[var(--bg-soft)] overflow-hidden flex" style={{ width: `${Math.max(barW, 6)}%`, minWidth: 40 }} title={`เปิดอยู่ ${r.open} งาน`}>
                  <div className="h-full" style={{ width: `${seg(r.todo)}%`, backgroundColor: "#94a3b8" }} />
                  <div className="h-full" style={{ width: `${seg(r.inProgress - r.overdue > 0 ? r.inProgress - r.overdue : 0)}%`, backgroundColor: "var(--chart-amber)" }} />
                  <div className="h-full" style={{ width: `${seg(r.overdue)}%`, backgroundColor: "var(--chart-red)" }} />
                </div>
                <div className="flex items-center gap-2.5 mt-1.5 text-[11px] text-[var(--ink-soft)] flex-wrap">
                  <span className={cn("font-medium", overloaded && "text-[var(--chart-amber)]")}>เปิดอยู่ {r.open}</span>
                  <span>กำลังทำ {r.inProgress}</span>
                  {r.overdue > 0 && <span className="text-[var(--chart-red)] font-medium">เลยกำหนด {r.overdue}</span>}
                  <span>เสร็จ {r.done}</span>
                  {overloaded && <span className="text-[10px] rounded-full bg-amber-50 text-[var(--chart-amber)] px-1.5 py-0.5">งานเยอะ</span>}
                </div>
              </div>

              <span className={cn("shrink-0 text-xs font-semibold tabular-nums rounded-md ring-1 ring-inset px-2 py-1", scoreClass(r.score))} title="คะแนนผลงาน">
                {r.score}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
