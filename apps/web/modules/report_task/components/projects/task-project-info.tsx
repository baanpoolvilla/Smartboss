"use client";

import Link from "next/link";

import { depRuleLabel } from "@/modules/report_task/lib/project-schedule";
import { useProjectStore } from "@/modules/report_task/store/project-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task } from "@/modules/report_task/types";

/** ในหน้ารายละเอียดงาน: อยู่โปรเจกต์ไหน ช่วงไหน ต้องรออะไร และมีงานไหนรองานนี้อยู่ */
export function TaskProjectInfo({ task }: { task: Task }) {
  const link = task.project!;
  const project = useProjectStore((s) => s.projects.find((p) => p.id === link.projectId));
  const tasks = useTaskStore((s) => s.tasks);
  if (!project) return null;
  const nameOf = (id: string) => tasks.find((t) => t.id === id)?.title ?? project.milestones.find((m) => m.id === id)?.name ?? "—";
  const waitingOn = (link.dependsOn ?? []).map((d) => { const l = depRuleLabel(link.depRules?.[d]); return l ? `${nameOf(d)} (${l})` : nameOf(d); });
  const waiting = [
    ...tasks.filter((t) => t.project?.dependsOn?.includes(task.id)).map((t) => t.title),
    ...project.milestones.filter((m) => m.dependsOn?.includes(task.id)).map((m) => `◆ ${m.name}`),
  ];
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-semibold">โปรเจกต์</h4>
      <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-[var(--ink-soft)]">โปรเจกต์</dt>
        <dd className="m-0">
          <Link href={`/report-task/projects/${project.id}`} className="font-semibold text-[var(--brand-green-dark)] hover:underline">
            {project.name}
          </Link>
          {" › "}
          {project.sections.find((s) => s.id === link.sectionId)?.name ?? "—"}
        </dd>
        <dt className="text-[var(--ink-soft)]">ต้องรอ</dt>
        <dd className="m-0">{waitingOn.length ? waitingOn.join(", ") : "—"}</dd>
        <dt className="text-[var(--ink-soft)]">งานที่รออยู่</dt>
        <dd className="m-0">{waiting.length ? waiting.join(", ") : "—"}</dd>
      </dl>
    </div>
  );
}
