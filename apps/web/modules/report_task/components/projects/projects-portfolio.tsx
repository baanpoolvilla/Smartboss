"use client";

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
import { PersonDot, ProgressBar, ProjectStatusChip, TH_MONTH_SHORT, fmtDay, todayBkk } from "./project-ui";

const BAR: Record<string, string> = { ok: "var(--chart-green)", risk: "var(--chart-amber)", late: "var(--chart-red)", hold: "var(--chart-blue)", done: "var(--chart-gray)", dropped: "var(--chart-gray)" };

/** หน้ารวมโปรเจกต์ (Portfolio) — ทุกโปรเจกต์ที่เห็นได้ สถานะ ความคืบหน้า และแถบเวลาบนปฏิทินเดียวกัน */
export function ProjectsPortfolio() {
  const router = useRouter();
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const projects = useProjectStore((s) => s.projects);
  const tasks = useTaskStore((s) => s.tasks);
  const [filter, setFilter] = useState<"active" | "all" | "mine">("active");
  const [creating, setCreating] = useState(false);
  const today = todayBkk();

  const rows = useMemo(() => {
    return projects
      .filter((p) => canSeeProject(p, me, tasks))
      .map((p) => {
        const items = timelineItems(p, tasks, today);
        return { p, status: projectStatusOf(p, items), pct: progressOf(items), next: nextMilestoneOf(items), count: items.filter((i) => i.kind === "task").length };
      })
      .filter((r) => (filter === "all" ? true : filter === "mine" ? !!memberRole(r.p, me) || tasks.some((t) => t.project?.projectId === r.p.id && t.assigneeIds.includes(me)) : !["done", "dropped"].includes(r.status)))
      .sort((a, b) => a.p.endDate.localeCompare(b.p.endDate));
  }, [projects, tasks, me, filter, today]);

  const lo = rows.length ? Math.min(...rows.map((r) => dayNum(r.p.startDate)), dayNum(today)) : dayNum(today) - 30;
  const hi = rows.length ? Math.max(...rows.map((r) => dayNum(r.p.endDate)), dayNum(today) + 14) : dayNum(today) + 60;
  const span = Math.max(1, hi - lo);
  const x = (s: string) => `${(((dayNum(s) - lo) / span) * 100).toFixed(2)}%`;
  const months: { label: string; left: string }[] = [];
  for (let d = lo; d <= hi; d++) {
    const dt = new Date(d * 864e5);
    if (dt.getUTCDate() === 1) months.push({ label: TH_MONTH_SHORT[dt.getUTCMonth()]!, left: `${(((d - lo) / span) * 100).toFixed(2)}%` });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="m-0 text-xl font-bold">โปรเจกต์</h1>
        <span className="text-xs text-[var(--ink-soft)]">{rows.length} โปรเจกต์</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-0.5">
            {([["active", "กำลังทำ"], ["all", "ทั้งหมด"], ["mine", "ของฉัน"]] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                className={cn("rounded-md px-3 py-1 text-xs", filter === k ? "bg-[var(--bg)] font-semibold shadow-sm" : "text-[var(--ink-soft)]")}>{l}</button>
            ))}
          </div>
          {canCreateProject(me) && (
            <>
              <Link href="/report-task/projects/templates" className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-[var(--bg-soft)]">แม่แบบ</Link>
              <button type="button" className="rounded-lg bg-[var(--brand-green)] px-3 py-1.5 text-xs font-semibold text-white" onClick={() => setCreating(true)}>+ สร้างโปรเจกต์</button>
            </>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-[var(--line)] py-16 text-center text-sm text-[var(--ink-soft)]">
          <p className="m-0">{projects.length ? "ไม่มีโปรเจกต์ในตัวกรองนี้" : "ยังไม่มีโปรเจกต์"}</p>
          {canCreateProject(me) ? <p className="m-0">กด &quot;+ สร้างโปรเจกต์&quot; เพื่อเริ่ม — เลือกแม่แบบได้ เช่น รีโนเวทบ้าน</p> : <p className="m-0">หัวหน้าแผนกหรือ CEO เป็นคนสร้างโปรเจกต์ แล้วเพิ่มคุณเป็นสมาชิก</p>}
        </div>
      ) : (
        <>
          {/* คอม: ตาราง */}
          <div className="hidden overflow-x-auto rounded-xl border border-[var(--line)] md:block">
            <table className="w-full min-w-[900px] border-collapse text-[13.5px]">
              <thead>
                <tr className="bg-[var(--bg-soft)] text-left text-xs text-[var(--ink-soft)]">
                  <th className="px-3 py-2 font-semibold">โปรเจกต์</th>
                  <th className="px-3 py-2 font-semibold">สถานะ</th>
                  <th className="px-3 py-2 font-semibold">เจ้าของ</th>
                  <th className="px-3 py-2 font-semibold">ความคืบหน้า</th>
                  <th className="px-3 py-2 font-semibold">Milestone ถัดไป</th>
                  <th className="w-[34%] px-3 py-2 font-semibold">
                    <div className="relative h-4">{months.map((m) => <span key={m.left} className="absolute" style={{ left: m.left }}>{m.label}</span>)}</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.p.id} tabIndex={0} className="cursor-pointer border-t border-[var(--line)] hover:bg-[var(--bg-soft)]"
                    onClick={() => router.push(`/report-task/projects/${r.p.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/report-task/projects/${r.p.id}`)}>
                    <td className="px-3 py-2.5"><b>{r.p.name}</b><div className="text-xs text-[var(--ink-soft)]">{fmtDay(r.p.startDate)} – {fmtDay(r.p.endDate, true)} · {r.count} งาน</div></td>
                    <td className="px-3 py-2.5"><ProjectStatusChip status={r.status} /></td>
                    <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5"><PersonDot userId={r.p.ownerId} /><span className="text-xs">{getUser(r.p.ownerId)?.name}</span></span></td>
                    <td className="px-3 py-2.5"><ProgressBar pct={r.pct} /></td>
                    <td className="px-3 py-2.5 text-xs">{r.next ? `${r.next.name} · ${fmtDay(r.next.start)}` : "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="relative h-5 rounded bg-[var(--bg-soft)]">
                        <div className="absolute top-1.5 h-2 rounded-full" style={{ left: x(r.p.startDate), width: `calc(${x(r.p.endDate)} - ${x(r.p.startDate)})`, background: BAR[r.status] }} />
                        <div className="absolute inset-y-0 w-0.5" style={{ left: x(today), background: "var(--chart-red)" }} title="วันนี้" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* มือถือ: การ์ด */}
          <div className="grid gap-2 md:hidden">
            {rows.map((r) => (
              <Link key={r.p.id} href={`/report-task/projects/${r.p.id}`} className="grid gap-1.5 rounded-xl border border-[var(--line)] p-3">
                <div className="flex items-start justify-between gap-2"><b className="text-sm">{r.p.name}</b><ProjectStatusChip status={r.status} /></div>
                <ProgressBar pct={r.pct} />
                <span className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)]"><PersonDot userId={r.p.ownerId} size={18} />{fmtDay(r.p.startDate)} – {fmtDay(r.p.endDate)}{r.next ? ` · ถัดไป: ${r.next.name}` : ""}</span>
              </Link>
            ))}
          </div>
        </>
      )}
      {creating && <CreateProjectDialog onClose={() => setCreating(false)} onCreated={(id) => router.push(`/report-task/projects/${id}`)} />}
    </div>
  );
}
