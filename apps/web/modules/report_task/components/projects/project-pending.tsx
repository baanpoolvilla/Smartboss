"use client";

import { useMemo } from "react";


import { getUser } from "@/modules/report_task/lib/directory";
import { canReviewTaskRecord } from "@/modules/report_task/lib/permissions";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useProjectStore } from "@/modules/report_task/store/project-store";
import { useTaskReviewSettingsStore } from "@/modules/report_task/store/task-review-settings-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";

/**
 * "🔔 รอคุณ" ของหน้าโปรเจกต์ — บอกว่าเลขแดงที่เมนู "โปรเจกต์" (ProjectNavBadge) คือเรื่องอะไร
 * (ผู้ใช้ขอ 18/10/2569 "เปิดมาแล้วไม่รู้ว่างานอะไรที่รอเราอยู่") · นับแบบเดียวกับ taskNavBadgeCount
 * (task-review-nav-badge.tsx) ทุกข้อ ⇒ จำนวนในแถบ = เลขแดงที่เมนูเสมอ:
 *   - งานโปรเจกต์ที่เสร็จแล้ว รอเราตรวจ (คนที่กด ผ่าน/ไม่ผ่าน ได้)
 *   - คอมเมนต์/ไฟล์แนบ/การมอบหมายใหม่ในงานโปรเจกต์ที่ยังไม่ได้เปิดดู (แจ้งเตือนละ 1 ข้อ)
 * เปิดงานแล้ว (TaskDetailSheet มาร์คอ่าน) ข้อนั้นหายเอง · รอตรวจหายเมื่อกดตรวจแล้ว
 */
export interface ProjectPendingItem {
  key: string;
  taskId: string;
  projectId: string;
  kind: string;
  title: string;
  projectName: string;
  who: string | null;
  at: string | null;
}

const KIND: Record<string, string> = {
  task_comment: "💬 คอมเมนต์ใหม่",
  task_attachment: "📎 ไฟล์แนบใหม่",
  task_assigned: "👤 มอบหมายให้คุณ",
};

export function useProjectPending(): ProjectPendingItem[] {
  return useTaskPending("project");
}

/**
 * "project" = งานในโปรเจกต์ (เลขแดงเมนูโปรเจกต์) · "board" = งานบนบอร์ดงาน ไม่รวมงานโปรเจกต์
 * (เลขแดงเมนู "งาน / Kanban" — TaskReviewNavBadge) · นับแบบเดียวกับเลขแดงของเมนูนั้น
 */
export function useTaskPending(scope: "project" | "board"): ProjectPendingItem[] {
  const tasks = useTaskStore((s) => s.tasks);
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const reviewSettings = useTaskReviewSettingsStore((s) => s.settings);
  const notifications = useNotificationStore((s) => s.notifications);
  const projects = useProjectStore((s) => s.projects);
  return useMemo(() => {
    const byId = new Map(tasks.filter((t) => (scope === "project" ? !!t.project : !t.project)).map((t) => [t.id, t]));
    const pname = (pid: string) => projects.find((p) => p.id === pid)?.name ?? "โปรเจกต์";
    const out: ProjectPendingItem[] = [];
    for (const t of byId.values()) {
      if (t.status === "done" && !t.reviewedBy && canReviewTaskRecord(t, me, reviewSettings)) {
        const who = t.assigneeIds.map((id) => getUser(id)?.name).filter(Boolean).join(", ");
        out.push({ key: `review:${t.id}`, taskId: t.id, projectId: t.project?.projectId ?? "", kind: "✅ รอคุณตรวจ", title: t.title, projectName: t.project ? pname(t.project.projectId) : "", who: who || null, at: t.completedAt ?? t.updatedAt ?? null });
      }
    }
    for (const n of notifications) {
      if (n.userId !== me || n.read || !n.taskId || !n.kind || !KIND[n.kind]) continue;
      const t = byId.get(n.taskId);
      if (!t) continue;
      out.push({ key: n.id, taskId: t.id, projectId: t.project?.projectId ?? "", kind: KIND[n.kind]!, title: t.title, projectName: t.project ? pname(t.project.projectId) : "", who: n.byUserId ? (getUser(n.byUserId)?.name ?? null) : null, at: n.createdAt });
    }
    return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }, [tasks, me, reviewSettings, notifications, projects, scope]);
}

/** ป้ายแดงบนแถวงาน/การ์ดโปรเจกต์ */
export function PendingTag({ items }: { items: ProjectPendingItem[] }) {
  if (!items.length) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#dc2626] px-2 py-0.5 text-[10.5px] font-bold text-white" title={items.map((i) => `${i.kind} · ${i.title}`).join("\n")}>
      {items[0]!.kind.startsWith("✅") ? items[0]!.kind : `ยังไม่ได้อ่าน · ${items[0]!.kind}`}
      {items.length > 1 && <span>+{items.length - 1}</span>}
    </span>
  );
}
