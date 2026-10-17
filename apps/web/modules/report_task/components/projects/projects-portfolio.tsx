"use client";

import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";
import { useTaskSheetParam } from "@/modules/report_task/hooks/use-task-sheet-param";
import { MyProjectTasks } from "./my-project-tasks";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { getUser } from "@/modules/report_task/lib/directory";
import { canCreateProject, canSeeProject, memberRole } from "@/modules/report_task/lib/project-access";
import { dayNum, nextMilestoneOf, progressOf, projectStatusOf, timelineItems } from "@/modules/report_task/lib/project-schedule";
import { cn } from "@/modules/report_task/lib/utils";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useProjectStore } from "@/modules/report_task/store/project-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { CreateProjectDialog } from "./create-project-dialog";
import { PersonDot, ProjectStatusChip, fmtDay, todayBkk } from "./project-ui";
import type { Project, ProjectStatus } from "@/modules/report_task/types";
import type { TimelineItem } from "@/modules/report_task/lib/project-schedule";

/** เรียงการ์ด: โปรเจกต์ที่มีปัญหาขึ้นก่อน */
const RANK: Record<string, number> = { late: 0, risk: 1, ok: 2, hold: 3, done: 4, dropped: 5 };

/** หน้ารวมโปรเจกต์ (Portfolio) — ทุกโปรเจกต์ที่เห็นได้ สถานะ ความคืบหน้า และแถบเวลาบนปฏิทินเดียวกัน */
export function ProjectsPortfolio() {
  const router = useRouter();
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const projects = useProjectStore((s) => s.projects);
  const ready = useProjectStore((s) => s.projectsLoaded && s.templatesLoaded);
  const tasks = useTaskStore((s) => s.tasks);
  const [filter, setFilter] = useState<"active" | "all" | "mine">("active");
  const [creating, setCreating] = useState(false);
  const { openTaskId, open: openTask, close: closeTask } = useTaskSheetParam();
  const today = todayBkk();

  const rows = useMemo(() => {
    return projects
      .filter((p) => canSeeProject(p, me, tasks))
      .map((p) => {
        const items = timelineItems(p, tasks, today);
        const tasksOnly = items.filter((i) => i.kind === "task");
        const total = Math.max(1, dayNum(p.endDate) - dayNum(p.startDate) + 1);
        const timePct = Math.min(100, Math.max(0, Math.round(((dayNum(today) - dayNum(p.startDate) + 1) / total) * 100)));
        return {
          p, status: projectStatusOf(p, items), pct: progressOf(items), next: nextMilestoneOf(items), count: tasksOnly.length,
          late: tasksOnly.filter((i) => i.state === "late").length,
          mine: tasksOnly.filter((i) => i.state !== "done" && i.assigneeIds.includes(me)).length,
          timePct, daysLeft: dayNum(p.endDate) - dayNum(today),
        };
      })
      .filter((r) => (filter === "all" ? true : filter === "mine" ? !!memberRole(r.p, me) || tasks.some((t) => t.project?.projectId === r.p.id && t.assigneeIds.includes(me)) : !["done", "dropped"].includes(r.status)))
      .sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.p.endDate.localeCompare(b.p.endDate));
  }, [projects, tasks, me, filter, today]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="m-0 text-2xl font-bold">โปรเจกต์</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-0.5">
            {([["active", "กำลังทำ"], ["all", "ทั้งหมด"], ["mine", "ของฉัน"]] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                className={cn("rounded-md px-3.5 py-1.5 text-[13px]", filter === k ? "bg-[var(--bg)] font-semibold shadow-sm" : "text-[var(--ink-soft)]")}>{l}</button>
            ))}
          </div>
          {canCreateProject(me) && (
            <>
              <Link href="/report-task/projects/templates" className="inline-flex h-9 items-center rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3.5 text-[13px] hover:bg-[var(--bg-soft)]">แม่แบบ</Link>
              <button type="button" className="h-9 rounded-lg bg-[var(--brand-green)] px-3.5 text-[13px] font-semibold text-white disabled:opacity-50" disabled={!ready} onClick={() => setCreating(true)}>+ สร้างโปรเจกต์</button>
            </>
          )}
        </div>
      </div>

      {ready && <MyProjectTasks onOpen={(id) => openTask(id)} />}

      {!ready ? (
        <p className="py-20 text-center text-sm text-[var(--ink-soft)]">กำลังโหลดโปรเจกต์…</p>
      ) : rows.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--ink-soft)]">
          <p className="m-0">{projects.length ? "ไม่มีโปรเจกต์ในตัวกรองนี้" : "ยังไม่มีโปรเจกต์"}</p>
          {canCreateProject(me) ? <p className="m-0">กด &quot;+ สร้างโปรเจกต์&quot; เพื่อเริ่ม — เลือกแม่แบบได้ เช่น รีโนเวทบ้าน</p> : <p className="m-0">หัวหน้าแผนกหรือ CEO เป็นคนสร้างโปรเจกต์ แล้วเพิ่มคุณเป็นสมาชิก</p>}
        </div>
      ) : (
        <>
          <h2 className="m-0 pt-1 text-[16px] font-bold">{filter === "mine" ? "โปรเจกต์ของฉัน" : filter === "all" ? "โปรเจกต์ทั้งหมด" : "โปรเจกต์ที่กำลังทำ"} <span className="ml-1 text-[13px] font-normal text-[var(--ink-soft)]">{rows.length}</span></h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => <ProjectCard key={r.p.id} r={r} today={today} />)}
          </div>
        </>
      )}
      <TaskDetailSheet taskId={openTaskId} onOpenChange={(o) => !o && closeTask()} />
      {creating && <CreateProjectDialog onClose={() => setCreating(false)} onCreated={(id) => router.push(`/report-task/projects/${id}`)} />}
    </div>
  );
}

type Row = { p: Project; status: ProjectStatus; pct: number; next?: TimelineItem; count: number; late: number; mine: number; timePct: number; daysLeft: number };

/** การ์ดโปรเจกต์ — อ่านจบในการ์ดเดียว: สถานะ · คืบหน้าเทียบเวลาที่ผ่านไป · งานเลยกำหนด · จุดสำคัญถัดไป */
function ProjectCard({ r, today }: { r: Row; today: string }) {
  const { p } = r;
  const closed = ["done", "dropped"].includes(r.status);
  // งานคืบหน้าน้อยกว่าเวลาที่ผ่านไปมาก = ส่อว่าจะไม่ทัน (เตือนเบา ๆ ก่อนจะกลายเป็น "ล่าช้า")
  const behind = !closed && r.count > 0 && r.timePct - r.pct >= 20;
  const nd = r.next ? dayNum(r.next.start) - dayNum(today) : 0;
  return (
    <Link href={`/report-task/projects/${p.id}`}
      className={cn("grid content-start gap-3 rounded-2xl border bg-[var(--bg)] p-4 transition-shadow hover:shadow-md",
        r.status === "late" ? "border-red-300 dark:border-red-900" : r.status === "risk" ? "border-amber-300 dark:border-amber-900" : "border-[var(--line)]", closed && "opacity-75")}>
      <div className="flex items-start gap-2">
        <b className="min-w-0 flex-1 break-words text-[16px] leading-snug">{p.name}</b>
        <ProjectStatusChip status={r.status} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--ink-soft)]">
        <span className="inline-flex items-center gap-1.5"><PersonDot userId={p.ownerId} size={20} /><span className="text-[var(--ink)]">{getUser(p.ownerId)?.name ?? "—"}</span></span>
        <span className="tabular-nums">{fmtDay(p.startDate)} – {fmtDay(p.endDate, true)}</span>
      </div>

      {/* คืบหน้า (เขียว) เทียบเวลาที่ผ่านไป (เส้นดำ) */}
      <div className="grid gap-1.5">
        <div className="flex items-baseline gap-2 text-[12.5px]">
          <b className="text-[18px] tabular-nums">{r.pct}%</b>
          <span className="text-[var(--ink-soft)]">เสร็จ</span>
          <span className={cn("ml-auto tabular-nums", !closed && r.daysLeft < 0 ? "font-semibold text-red-600" : "text-[var(--ink-soft)]")}>
            {closed ? "ปิดแล้ว" : r.daysLeft >= 0 ? `เหลือ ${r.daysLeft} วัน` : `เลยวันเสร็จ ${-r.daysLeft} วัน`}
          </span>
        </div>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-[var(--line)]" title={`งานเสร็จ ${r.pct}% · เวลาผ่านไป ${r.timePct}%`}>
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${r.pct}%`, background: r.status === "late" ? "var(--chart-red)" : r.status === "risk" ? "var(--chart-amber)" : "var(--brand-green)" }} />
          {/* เส้นดำ = วันนี้ (เวลาที่ผ่านไป) · ช่วงแรกของโปรเจกต์ไม่ต้องแสดง (ดูเหมือนขีดหลงมา) */}
          {!closed && r.timePct > 3 && <span className="absolute inset-y-0 w-0.5 bg-[var(--ink)]" style={{ left: `calc(${r.timePct}% - 1px)` }} />}
        </div>
        {behind && <span className="text-[12px] text-amber-700 dark:text-amber-300">เวลาผ่านไป {r.timePct}% แต่งานเสร็จ {r.pct}% — อาจไม่ทัน</span>}
      </div>

      <div className="flex flex-wrap gap-1.5 text-[12px]">
        <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-0.5 text-[var(--ink-soft)]">{r.count} งาน</span>
        {r.late > 0 && <span className="rounded-full bg-red-100 px-2.5 py-0.5 font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">เลยกำหนด {r.late}</span>}
        {r.mine > 0 && <span className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 font-semibold text-[var(--brand-green-dark)]">👤 งานของฉัน {r.mine}</span>}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--line)] pt-2.5 text-[13px]">
        {r.next ? (
          <>
            <span className="h-2.5 w-2.5 shrink-0 rotate-45 rounded-[2px]" style={{ background: nd < 0 ? "var(--chart-red)" : "var(--chart-violet)" }} />
            <span className="min-w-0 flex-1 truncate">{r.next.name}</span>
            <span className={cn("shrink-0 text-[12px] tabular-nums", nd < 0 ? "font-semibold text-red-600" : "text-[var(--ink-soft)]")}>
              {fmtDay(r.next.start)} · {nd < 0 ? `เลย ${-nd} วัน` : nd === 0 ? "วันนี้" : `อีก ${nd} วัน`}
            </span>
          </>
        ) : <span className="text-[12.5px] text-[var(--ink-soft)]">ไม่มีจุดสำคัญที่รออยู่</span>}
      </div>
    </Link>
  );
}
