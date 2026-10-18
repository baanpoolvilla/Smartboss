"use client";

import { useMemo, useState } from "react";
import { Bell, ChevronDown, ChevronUp } from "lucide-react";

import { getUser } from "@/modules/report_task/lib/directory";
import { canReviewTask } from "@/modules/report_task/lib/permissions";
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
  const tasks = useTaskStore((s) => s.tasks);
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const reviewSettings = useTaskReviewSettingsStore((s) => s.settings);
  const notifications = useNotificationStore((s) => s.notifications);
  const projects = useProjectStore((s) => s.projects);
  return useMemo(() => {
    const byId = new Map(tasks.filter((t) => t.project).map((t) => [t.id, t]));
    const pname = (pid: string) => projects.find((p) => p.id === pid)?.name ?? "โปรเจกต์";
    const out: ProjectPendingItem[] = [];
    for (const t of byId.values()) {
      if (t.status === "done" && !t.reviewedBy && canReviewTask(t.departmentIds, me, reviewSettings)) {
        const who = t.assigneeIds.map((id) => getUser(id)?.name).filter(Boolean).join(", ");
        out.push({ key: `review:${t.id}`, taskId: t.id, projectId: t.project!.projectId, kind: "✅ รอคุณตรวจ", title: t.title, projectName: pname(t.project!.projectId), who: who || null, at: t.completedAt ?? t.updatedAt ?? null });
      }
    }
    for (const n of notifications) {
      if (n.userId !== me || n.read || !n.taskId || !n.kind || !KIND[n.kind]) continue;
      const t = byId.get(n.taskId);
      if (!t) continue;
      out.push({ key: n.id, taskId: t.id, projectId: t.project!.projectId, kind: KIND[n.kind]!, title: t.title, projectName: pname(t.project!.projectId), who: n.byUserId ? (getUser(n.byUserId)?.name ?? null) : null, at: n.createdAt });
    }
    return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }, [tasks, me, reviewSettings, notifications, projects]);
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return "เมื่อกี้";
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ชม. ที่แล้ว`;
  return `${Math.round(h / 24)} วันที่แล้ว`;
}

/** ป้ายแดงบนแถวงาน/การ์ดโปรเจกต์ */
export function PendingTag({ items }: { items: ProjectPendingItem[] }) {
  if (!items.length) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#dc2626] px-2 py-0.5 text-[10.5px] font-bold text-white" title={items.map((i) => `${i.kind} · ${i.title}`).join("\n")}>
      {items[0]!.kind}
      {items.length > 1 && <span>+{items.length - 1}</span>}
    </span>
  );
}

const SHOW = 3;

export function ProjectPendingStrip({ items, onOpen }: { items: ProjectPendingItem[]; onOpen: (taskId: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const shown = open ? items : items.slice(0, SHOW);
  return (
    <section className="rounded-xl border border-red-200 bg-[var(--bg)] px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[13.5px] font-bold text-red-700">
        <Bell className="h-4 w-4" />
        รอคุณ
        <span className="rounded-full bg-[#dc2626] px-2 text-[11.5px] leading-5 text-white">{items.length}</span>
        <span className="text-[11.5px] font-normal text-[var(--ink-soft)]">เปิดดูแล้วจะหายจากรายการนี้</span>
      </div>
      <div className="grid gap-1.5">
        {shown.map((i) => (
          <button key={i.key} type="button" onClick={() => onOpen(i.taskId)}
            className="flex w-full items-center gap-2 rounded-[10px] border border-red-200 bg-red-50 px-2.5 py-1.5 text-left text-[12.5px] hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40">
            <span className="shrink-0 font-bold text-red-700 dark:text-red-300">{i.kind}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{i.title}</span>
            <span className="hidden shrink-0 text-[var(--ink-soft)] sm:inline">
              📁 {i.projectName}
              {i.who ? ` · ${i.who}` : ""}
              {i.at ? ` · ${ago(i.at)}` : ""}
            </span>
            <span className="shrink-0 font-bold text-[var(--brand-green-dark)]">เปิดดู →</span>
          </button>
        ))}
      </div>
      {items.length > SHOW && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--ink-soft)] hover:text-[var(--ink)]">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {open ? "ย่อ" : `ดูอีก ${items.length - SHOW} เรื่อง`}
        </button>
      )}
    </section>
  );
}
