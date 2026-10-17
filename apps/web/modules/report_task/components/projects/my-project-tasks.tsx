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
  // แยกกลุ่มตามโปรเจกต์ (เรียงตามงานที่ต้องส่งเร็วสุดของแต่ละโปรเจกต์) — อ่านง่ายกว่ารายการยาวรวมกัน
  const groups = new Map<string, Task[]>();
  for (const t of mine) groups.set(t.project!.projectId, [...(groups.get(t.project!.projectId) ?? []), t]);
  return (
    <section id="my" className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[16px] font-bold">งานของฉันในโปรเจกต์</h2>
        <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[12px] font-semibold text-[var(--ink-soft)]">{mine.length} งาน</span>
        {late > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[12px] font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">เลยกำหนด {late}</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[...groups].map(([pid, list]) => {
          const p = projects.find((x) => x.id === pid);
          const lateN = list.filter((t) => t.dueDate.slice(0, 10) < today).length;
          return (
            <div key={pid} className="grid content-start gap-1 rounded-xl border border-[var(--line)] p-2.5">
              <div className="flex items-center gap-2 px-1">
                <span aria-hidden>📁</span>
                {p ? (
                  <Link href={`/report-task/projects/${p.id}?mine=1`} className="min-w-0 flex-1 truncate text-[14.5px] font-bold hover:underline">{p.name}</Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold text-[var(--ink-soft)]">(โปรเจกต์ถูกลบแล้ว)</span>
                )}
                <span className="shrink-0 text-[12px] text-[var(--ink-soft)]">{list.length} งาน{lateN ? <b className="text-red-600"> · เลย {lateN}</b> : ""}</span>
              </div>
              <ul className="m-0 grid list-none gap-0.5 p-0">
                {list.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onOpen(t.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--bg-soft)]">
                      <span className="min-w-0 flex-1 truncate text-[14px]">
                        {t.parentId ? <span className="mr-1 text-[var(--ink-soft)]">↳</span> : null}
                        {t.title}
                      </span>
                      <span className="shrink-0 tabular-nums text-[12.5px] text-[var(--ink-soft)]">{fmtDay(t.dueDate)}</span>
                      <StatePill state={stateOf(t, today)} />
                    </button>
                  </li>
                ))}
              </ul>
              {list.length > 5 && p && (
                <Link href={`/report-task/projects/${p.id}?mine=1`} className="px-2 text-[12.5px] font-semibold text-[var(--brand-green-dark)] hover:underline">
                  ดูอีก {list.length - 5} งานในโปรเจกต์ ›
                </Link>
              )}
            </div>
          );
        })}
      </div>
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
