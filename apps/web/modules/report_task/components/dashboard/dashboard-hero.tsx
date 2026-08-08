"use client";

import { useMemo } from "react";
import { getUser } from "@/modules/report_task/data/mock";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { formatDate } from "@/modules/report_task/lib/format";
import { todayIso } from "@/modules/report_task/lib/now";

export function DashboardHero() {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const viewingAsUser = getUser(viewingAsUserId)!;
  const tasks = useTaskStore((s) => s.tasks);
  const dueToday = useMemo(
    () =>
      tasks.filter(
        (t) => t.assigneeIds.includes(viewingAsUserId) && t.status !== "done" && t.dueDate.slice(0, 10) === todayIso()
      ).length,
    [tasks, viewingAsUserId]
  );

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[28px] leading-tight font-semibold tracking-tight">สวัสดี, {viewingAsUser.name.split(" ")[0]} 👋</h2>
        <p className="text-sm text-[var(--ink-soft)] mt-1.5">
          {formatDate(todayIso(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          {dueToday > 0 && (
            <>
              {" "}· วันนี้คุณมีงานครบกำหนด <span className="font-medium text-[var(--ink)]">{dueToday} งาน</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
