"use client";

import Link from "next/link";
import { useMemo } from "react";

import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useProjectStore } from "@/modules/report_task/store/project-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task } from "@/modules/report_task/types";
import { StatePill, fmtDay, todayBkk } from "./project-ui";

/** งานโปรเจกต์ที่ยังไม่เสร็จของฉัน (เรียงตามวันส่ง) */
export function useMyOpenProjectTasks(): Task[] {
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const tasks = useTaskStore((s) => s.tasks);
  return useMemo(
    () => tasks.filter((t) => t.project && t.status !== "done" && t.assigneeIds.includes(me)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [tasks, me]
  );
}

const stateOf = (t: Task, today: string) => (t.dueDate.slice(0, 10) < today ? "late" : t.status === "in_progress" ? "doing" : "todo");

/**
 * "งานของฉันในโปรเจกต์" — งานโปรเจกต์ไม่ขึ้นบนบอร์ดงาน (แยกกันตามที่ตกลง 17/10/2569)
 * ที่นี่จึงเป็นที่ที่คนทำงานเห็นงานโปรเจกต์ของตัวเองครบทุกโปรเจกต์ในที่เดียว
 */
export function MyProjectTasks({ onOpen }: { onOpen: (taskId: string) => void }) {
  const mine = useMyOpenProjectTasks();
  const projects = useProjectStore((s) => s.projects);
  const today = todayBkk();
  if (!mine.length) return null;
  const late = mine.filter((t) => t.dueDate.slice(0, 10) < today).length;
  return (
    <section id="my" className="grid gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[16px] font-bold">งานของฉันในโปรเจกต์</h2>
        <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[12px] font-semibold text-[var(--ink-soft)]">{mine.length} งาน</span>
        {late > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[12px] font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">เลยกำหนด {late}</span>}
      </div>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {mine.slice(0, 8).map((t) => {
          const p = projects.find((x) => x.id === t.project!.projectId);
          return (
            <li key={t.id}>
              <button type="button" onClick={() => onOpen(t.id)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--bg-soft)]">
                <span className="min-w-0 flex-[1_1_220px] text-[14px] font-semibold">
                  {t.parentId ? <span className="mr-1 text-[var(--ink-soft)]">↳</span> : null}
                  {t.title}
                  <span className="ml-2 text-[12px] font-normal text-[var(--ink-soft)]">📁 {p ? p.name : "(โปรเจกต์ถูกลบแล้ว)"}</span>
                </span>
                <span className="tabular-nums text-[13px] text-[var(--ink-soft)]">ส่ง {fmtDay(t.dueDate)}</span>
                <StatePill state={stateOf(t, today)} />
              </button>
            </li>
          );
        })}
      </ul>
      {mine.length > 8 && <p className="m-0 text-xs text-[var(--ink-soft)]">และอีก {mine.length - 8} งาน — เปิดในแต่ละโปรเจกต์ด้านล่าง</p>}
    </section>
  );
}

/** แถบบนบอร์ดงาน: บอกว่ามีงานโปรเจกต์รออยู่ (งานโปรเจกต์ไม่ขึ้นบนบอร์ดแล้ว) — ไม่มีงาน = ไม่แสดง */
export function ProjectTasksBanner() {
  const mine = useMyOpenProjectTasks();
  const today = todayBkk();
  if (!mine.length) return null;
  const late = mine.filter((t) => t.dueDate.slice(0, 10) < today).length;
  return (
    <Link href="/report-task/projects#my"
      className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[14px] transition-colors ${late ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" : "border-[var(--line)] bg-[var(--bg)] hover:bg-[var(--bg-soft)]"}`}>
      <span aria-hidden>📁</span>
      <span className="min-w-0 flex-1">
        คุณมีงานในโปรเจกต์ <b>{mine.length} งาน</b>
        {late > 0 && <> · <b>เลยกำหนด {late}</b></>}
        <span className="hidden text-[var(--ink-soft)] sm:inline"> · งานโปรเจกต์อยู่ในหน้าโปรเจกต์ ไม่ขึ้นบนบอร์ดนี้</span>
      </span>
      <span className="shrink-0 font-semibold text-[var(--brand-green-dark)]">ดูงาน ›</span>
    </Link>
  );
}
