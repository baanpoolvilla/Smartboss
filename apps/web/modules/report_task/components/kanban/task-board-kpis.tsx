"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/modules/report_task/components/ui/card";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { useTaskStore, type QuickView } from "@/modules/report_task/store/task-store";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";
import { ListTodo, PlayCircle, CheckCircle2, Flag } from "lucide-react";

/**
 * Quick at-a-glance stats for the board currently open — scoped to whatever
 * `tasks` the caller passes in (already run through `matchesTaskFilters`
 * minus `quickView`, so the 4 numbers track every *other* active filter but
 * don't collapse onto each other once one card is clicked — see task-store's
 * `QuickView` doc comment). Each card doubles as a one-click drill-down
 * filter for the board underneath (toggle off by clicking it again).
 */
export function TaskBoardKpis({ tasks }: { tasks: Task[] }) {
  const quickView = useTaskStore((s) => s.filters.quickView);
  const setFilters = useTaskStore((s) => s.setFilters);

  const stats = useMemo(
    () => ({
      total: tasks.length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      overdue: tasks.filter((t) => dueUrgency(t) === "overdue" && t.status !== "done").length,
      doneAll: tasks.filter((t) => t.status === "done").length,
    }),
    [tasks]
  );

  function toggle(key: QuickView) {
    setFilters({ quickView: quickView === key ? "all" : key });
  }

  const cards: { key: QuickView; label: string; value: number; icon: typeof ListTodo; iconClass: string }[] = [
    { key: "all", label: "งานทั้งหมด", value: stats.total, icon: ListTodo, iconClass: "bg-slate-50 text-[var(--chart-gray)]" },
    { key: "inProgress", label: "กำลังทำ", value: stats.inProgress, icon: PlayCircle, iconClass: "bg-amber-50 text-[var(--chart-amber)]" },
    { key: "overdue", label: "เลยกำหนด", value: stats.overdue, icon: Flag, iconClass: "bg-red-50 text-[var(--chart-red)]" },
    { key: "done", label: "สำเร็จทั้งหมด", value: stats.doneAll, icon: CheckCircle2, iconClass: "bg-green-50 text-[var(--chart-green)]" },
  ];

  return (
    // แผ่นเดียว ไม่ใช่การ์ดแยก 4 ใบ — ประหยัดพื้นที่แนวตั้งกว่ามาก โดยเฉพาะจอมือถือ
    // ที่ 4 การ์ดแยกกันกินพื้นที่เกินจำเป็น เส้นแบ่งระหว่างช่องใช้ลูกเล่น
    // gap-px + พื้นหลังสีเส้น (--line) แทนการเซ็ต border ทีละด้าน เพราะต้อง
    // ทำงานถูกทั้ง 2 คอลัมน์ (มือถือ) และ 4 คอลัมน์ (จอกว้าง) โดยไม่ต้องคำนวณ
    // ว่าช่องไหนอยู่ขอบขวา/ขอบล่างเอง
    <Card className="border-[var(--line)] shadow-sm">
      <CardContent className="grid grid-cols-2 gap-px overflow-hidden rounded-[calc(var(--radius)-1px)] bg-[var(--line)] p-0 sm:grid-cols-4">
        {cards.map((c) => {
          // "งานทั้งหมด" is the resting/no-filter state — quickView defaults to
          // "all", so highlighting it here would make it look permanently
          // "selected" even when nothing's actually drilled down.
          const active = c.key !== "all" && quickView === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(c.key)}
              className={cn(
                "flex items-center gap-2 bg-[var(--bg)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-soft)]",
                active && "bg-[var(--accent)]"
              )}
            >
              <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", c.iconClass)}>
                <c.icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 leading-tight">
                <p className="text-[15px] font-semibold tabular-nums leading-none">{c.value}</p>
                <p className="mt-1 truncate text-[10.5px] text-[var(--ink-soft)]">{c.label}</p>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
