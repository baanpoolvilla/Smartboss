"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { NewTaskDialog } from "@/modules/report_task/components/kanban/new-task-dialog";
import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";
import { useTaskSheetParam } from "@/modules/report_task/hooks/use-task-sheet-param";
import { getUser, users } from "@/modules/report_task/lib/directory";
import { canEditProject, canPlanProject, canSeeProject } from "@/modules/report_task/lib/project-access";
import {
  PROJECT_STATUS_META,
  dayNum,
  lateImpact,
  progressOf,
  projectStatusOf,
  suggestLate,
  templateFromProject,
  timelineItems,
} from "@/modules/report_task/lib/project-schedule";
import { uuid } from "@/modules/report_task/lib/uuid";
import { cn } from "@/modules/report_task/lib/utils";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useProjectStore } from "@/modules/report_task/store/project-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Project, ProjectStatus } from "@/modules/report_task/types";
import { ProjectTimeline } from "./project-timeline";
import { BoardTab, CalendarTab, DashboardTab, FilesTab, ListTab, MessagesTab } from "./project-tabs";
import { PCT_HELP, PersonDot, ProjectStatusChip, STATE_COLOR, STATE_LABEL, fmtDay, ensureProjectMembers, notifyAddedToProject, syncChatMember, todayBkk, useCompanyHolidays } from "./project-ui";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { ROLE_OF_DEFAULT } from "./project-roles";

// มุมมองเดียวกับ Asana: Overview · List · Board · Timeline(+Gantt) · Calendar · Dashboard · Messages · Files (+ อัปเดตสถานะ)
type Tab = "timeline" | "overview" | "list" | "board" | "calendar" | "dashboard" | "messages" | "files" | "updates";
// แท็บหลักโชว์ตลอด ที่เหลืออยู่ใต้ "เพิ่มเติม ▾" — 9 แท็บเรียงกันบนมือถือต้องเลื่อนหา คนทั่วไปงง
const PRIMARY_TABS: Tab[] = ["overview", "list", "board", "timeline", "messages"];
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "ภาพรวม" },
  { id: "list", label: "รายการ" },
  { id: "board", label: "บอร์ด" },
  { id: "timeline", label: "แผนเวลา" },
  { id: "calendar", label: "ปฏิทิน" },
  { id: "dashboard", label: "แดชบอร์ด" },
  { id: "messages", label: "ข้อความ" },
  { id: "files", label: "ไฟล์" },
  { id: "updates", label: "อัปเดตสถานะ" },
];

export function ProjectView({ projectId }: { projectId: string }) {
  const router = useRouter();
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));
  const upsertTemplate = useProjectStore((s) => s.upsertTemplate);
  const ready = useProjectStore((s) => s.projectsLoaded);
  const templatesReady = useProjectStore((s) => s.templatesLoaded);
  const tasks = useTaskStore((s) => s.tasks);
  const setTaskProject = useTaskStore((s) => s.setTaskProject);
  const { openTaskId, open: openTask, close: closeTask } = useTaskSheetParam();
  const holidays = useCompanyHolidays();
  const today = todayBkk();
  // เปิดหน้ามือถือ (จอแคบ) เจอ "รายการ" ก่อน — อ่านง่ายกว่า Timeline บนจอเล็ก
  // แท็บแรก: เจ้าของ/CEO บนคอม = แผนเวลา (คุมแผน) · คนอื่น/มือถือ = รายการ (อ่านง่ายสุด)
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) return "list";
    const p = useProjectStore.getState().projects.find((x) => x.id === projectId);
    return p && canPlanProject(p, useIdentityStore.getState().viewingAsUserId) ? "timeline" : "list";
  });
  const [newTaskSection, setNewTaskSection] = useState<string | null>(null);

  const items = useMemo(() => (project ? timelineItems(project, tasks, today) : []), [project, tasks, today]);

  // ยังโหลดไม่เสร็จ — อย่าเพิ่งขึ้น "ไม่พบโปรเจกต์" (เปิดจากลิงก์แจ้งเตือนจะเห็นแวบหนึ่ง) และกันแก้ก่อนโหลดเสร็จ
  if (!ready) return <p className="py-20 text-center text-sm text-[var(--ink-soft)]">กำลังโหลดโปรเจกต์…</p>;
  if (!project) {
    return (
      <div className="grid place-items-center gap-3 py-20 text-center text-[var(--ink-soft)]">
        <p>ไม่พบโปรเจกต์นี้ หรือถูกลบไปแล้ว</p>
        <Link href="/report-task/projects" className="text-sm font-semibold text-[var(--brand-green-dark)]">‹ กลับหน้ารวมโปรเจกต์</Link>
      </div>
    );
  }
  if (!canSeeProject(project, me, tasks)) {
    return <p className="py-20 text-center text-[var(--ink-soft)]">คุณไม่ได้อยู่ในโปรเจกต์นี้</p>;
  }
  const canEdit = canEditProject(project, me);
  const canPlan = canPlanProject(project, me);
  const status = projectStatusOf(project, items);
  const pct = progressOf(items);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Link href="/report-task/projects" className="text-xs text-[var(--ink-soft)] hover:text-[var(--ink)]">‹ โปรเจกต์ทั้งหมด</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="m-0 text-xl font-bold">{project.name}</h1>
          <ProjectStatusChip status={status} />
          <span className="text-xs text-[var(--ink-soft)]">
            {fmtDay(project.startDate)} – {fmtDay(project.endDate, true)} · เจ้าของ {getUser(project.ownerId)?.name ?? "—"} · {pct}% เสร็จ
            <span className="ml-1 inline-grid h-4 w-4 cursor-help place-items-center rounded-full border border-[var(--ink-soft)] text-[10px]" title={PCT_HELP} tabIndex={0}>?</span>
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {canEdit && (
              <button type="button" className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-[var(--bg-soft)] disabled:opacity-50" disabled={!templatesReady}
                onClick={() => {
                  const t = templateFromProject(project, items, (uid) => ROLE_OF_DEFAULT(uid), () => `tpl-${uuid()}`, me);
                  upsertTemplate(t);
                  toast.success("บันทึกเป็นแม่แบบแล้ว · แก้ต่อได้ที่หน้าแม่แบบ");
                  router.push(`/report-task/projects/templates?t=${t.id}`);
                }}>
                บันทึกเป็นแม่แบบ
              </button>
            )}
            {canPlan && <ProjectSettingsButton project={project} />}
          </div>
        </div>
        {suggestLate(project, items) && (
          <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            ระบบเห็นว่ามีงานเลยกำหนดที่กระทบจุดสำคัญ แต่สถานะล่าสุดยังเป็น &quot;ตามแผน&quot; — ลองอัปเดตสถานะ
          </p>
        )}
      </div>

      <div className="flex items-end gap-1 border-b border-[var(--line)]">
        <div role="tablist" className="flex min-w-0 gap-1 overflow-x-auto">
          {TABS.filter((t) => PRIMARY_TABS.includes(t.id)).map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === t.id ? "border-[var(--brand-green)] font-bold text-[var(--brand-green-dark)]" : "border-transparent text-[var(--ink-soft)]")}>
              {t.label}
            </button>
          ))}
        </div>
        <MoreTabs tab={tab} onPick={setTab} />
      </div>

      {items.length === 0 && EMPTY_TABS.includes(tab) ? (
        <EmptyProject canEdit={canEdit} onAddTask={() => setNewTaskSection(project.sections[0]?.id ?? "")} onTemplates={() => router.push("/report-task/projects/templates")} />
      ) : <>
      {tab === "timeline" && (
        <ProjectTimeline project={project} items={items} today={today} holidays={holidays} canEdit={canEdit} canPlan={canPlan}
          onOpenTask={(id) => openTask(id)} onAddTask={(sec) => setNewTaskSection(sec || project.sections[0]?.id || "")} />
      )}
      {tab === "overview" && <Overview project={project} items={items} pct={pct} today={today} canEdit={canEdit} />}
      {tab === "list" && <ListTab project={project} items={items} canEdit={canEdit} canPlan={canPlan} onOpen={(id) => openTask(id)} />}
      {tab === "board" && <BoardTab project={project} items={items} canEdit={canEdit} onOpen={(id) => openTask(id)} />}
      {tab === "calendar" && <CalendarTab items={items} today={today} onOpen={(id) => openTask(id)} />}
      {tab === "dashboard" && <DashboardTab project={project} items={items} today={today} onOpen={(id) => openTask(id)} />}
      {tab === "messages" && <MessagesTab project={project} canEdit={canEdit} />}
      {tab === "files" && <FilesTab items={items} onOpen={(id) => openTask(id)} />}
      {tab === "updates" && <UpdatesTab project={project} canEdit={canEdit} />}
      </>}

      <TaskDetailSheet taskId={openTaskId} onOpenChange={(o) => !o && closeTask()} />
      {newTaskSection !== null && (
        <NewTaskDialog
          open
          onOpenChange={(o) => !o && setNewTaskSection(null)}
          allowedTypes={["task"]}
          defaultDate={today}
          onCreated={(taskId) => {
            setTaskProject(taskId, { projectId: project.id, sectionId: newTaskSection || project.sections[0]?.id || "", dependsOn: [] }, me);
            ensureProjectMembers(project.id, useTaskStore.getState().tasks.find((t) => t.id === taskId)?.assigneeIds ?? [], me);
            setNewTaskSection(null);
          }}
        />
      )}
    </div>
  );
}

const EMPTY_TABS: Tab[] = ["timeline", "list", "board", "calendar", "dashboard", "files"];

/** แท็บรอง (บอร์ด… ไฟล์ อัปเดตสถานะ) — ปุ่มบอกชื่อแท็บที่เปิดอยู่ถ้าเป็นแท็บรอง */
function MoreTabs({ tab, onPick }: { tab: Tab; onPick: (t: Tab) => void }) {
  const [open, setOpen] = useState(false);
  const rest = TABS.filter((t) => !PRIMARY_TABS.includes(t.id));
  const active = rest.find((t) => t.id === tab);
  return (
    <div className="relative shrink-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active ? "border-[var(--brand-green)] font-bold text-[var(--brand-green-dark)]" : "border-transparent text-[var(--ink-soft)]")}>
        {active ? active.label : "เพิ่มเติม"} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-1 grid w-max min-w-40 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-1 shadow-xl">
            {rest.map((t) => (
              <button key={t.id} type="button" onClick={() => { onPick(t.id); setOpen(false); }}
                className={cn("rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--bg-soft)]", tab === t.id && "font-bold text-[var(--brand-green-dark)]")}>
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** โปรเจกต์ที่ยังไม่มีงาน — บอกว่าต้องทำอะไรต่อ แทนตาราง/แผนเวลาว่าง ๆ */
function EmptyProject({ canEdit, onAddTask, onTemplates }: { canEdit: boolean; onAddTask: () => void; onTemplates: () => void }) {
  return (
    <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-[var(--line)] px-4 py-14 text-center">
      <b>ยังไม่มีงานในโปรเจกต์นี้</b>
      {canEdit ? (
        <>
          <p className="m-0 max-w-md text-sm text-[var(--ink-soft)]">เพิ่มงานแรก แล้วงานจะขึ้นทั้งที่นี่และบนบอร์ดงานของคนที่ได้รับ · ครั้งหน้าสร้างโปรเจกต์จากแม่แบบได้ งานจะมาครบพร้อมวัน</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="rounded-lg bg-[var(--brand-green)] px-4 py-1.5 text-sm font-semibold text-white" onClick={onAddTask}>+ เพิ่มงานแรก</button>
            <button type="button" className="rounded-lg border border-[var(--line)] px-4 py-1.5 text-sm" onClick={onTemplates}>ดูแม่แบบ</button>
          </div>
        </>
      ) : <p className="m-0 text-sm text-[var(--ink-soft)]">รอเจ้าของโปรเจกต์เพิ่มงาน</p>}
    </div>
  );
}

function Overview({ project, items, pct, today, canEdit }: { project: Project; items: ReturnType<typeof timelineItems>; pct: number; today: string; canEdit: boolean }) {
  const tasksOnly = items.filter((i) => i.kind === "task");
  const n = (s: string) => tasksOnly.filter((i) => i.state === s).length;
  const latest = [...project.updates].sort((a, b) => b.at.localeCompare(a.at))[0];
  const miles = items.filter((i) => i.kind === "milestone");
  const C = 2 * Math.PI * 34;
  const { late, affected } = lateImpact(items);
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <section className="rounded-xl border border-[var(--line)] p-4">
          <h3 className="m-0 mb-1 text-sm font-semibold">เป้าหมาย</h3>
          <p className="m-0 whitespace-pre-wrap text-sm">{project.description || "—"}</p>
        </section>
        <KeyResources project={project} canEdit={canEdit} />
        <section className="grid gap-3 rounded-xl border border-[var(--line)] p-4">
          <div className="flex items-center gap-4">
            <svg width="84" height="84" viewBox="0 0 84 84" aria-label={`ความคืบหน้า ${pct}%`}>
              <circle cx="42" cy="42" r="34" fill="none" stroke="var(--bg-soft)" strokeWidth="9" />
              <circle cx="42" cy="42" r="34" fill="none" stroke="var(--brand-green)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(C * pct) / 100} ${C}`} transform="rotate(-90 42 42)" />
              <text x="42" y="47" textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--ink)">{pct}%</text>
            </svg>
            <div>
              <b>ความคืบหน้า</b>
              <p className="m-0 text-xs text-[var(--ink-soft)]">{PCT_HELP}</p>
              <p className="m-0 text-xs text-[var(--ink-soft)]">เหลือ {Math.max(0, dayNum(project.endDate) - dayNum(today))} วันถึงวันเสร็จเป้าหมาย</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["done", "doing", "late", "todo"] as const).map((k) => (
              <div key={k} className="rounded-lg bg-[var(--bg-soft)] p-2.5">
                <b className="block text-2xl tabular-nums" style={k === "late" ? { color: STATE_COLOR.late } : undefined}>{n(k)}</b>
                <span className="text-xs text-[var(--ink-soft)]">{STATE_LABEL[k]}</span>
              </div>
            ))}
          </div>
          {late.length > 0 && (
            <p className="m-0 text-xs text-red-600">
              เลยกำหนด: {late.map((l) => l.name).join(", ")}{affected.length ? ` · มีงานรออยู่ ${affected.length} รายการ` : ""}
            </p>
          )}
        </section>
      </div>
      <div className="grid content-start gap-3">
        <section className="rounded-xl border border-[var(--line)] p-4">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="m-0 text-sm font-semibold">สถานะล่าสุด</h3>
            <span className="ml-auto"><AskUpdateButton project={project} /></span>
          </div>
          {latest ? <UpdatePost u={latest} /> : <p className="m-0 text-sm text-[var(--ink-soft)]">ยังไม่มีอัปเดต</p>}
        </section>
        <section className="rounded-xl border border-[var(--line)] p-4">
          <h3 className="m-0 mb-2 text-sm font-semibold">จุดสำคัญ</h3>
          {miles.length ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {miles.map((m) => (
                <li key={m.id} className="flex items-center gap-2.5 text-sm">
                  <span className="h-2.5 w-2.5 rotate-45 rounded-[2px]" style={{ background: m.state === "done" ? STATE_COLOR.done : m.state === "late" ? STATE_COLOR.late : "var(--chart-violet)" }} />
                  {m.name}
                  <span className="ml-auto whitespace-nowrap tabular-nums text-[var(--ink-soft)]">{fmtDay(m.start)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-sm text-[var(--ink-soft)]">ยังไม่มีจุดสำคัญ</p>}
        </section>
        <section className="rounded-xl border border-[var(--line)] p-4">
          <h3 className="m-0 mb-2 text-sm font-semibold">สมาชิก</h3>
          <div className="flex flex-wrap gap-2.5">
            {[{ userId: project.ownerId, role: "owner" as const }, ...project.members.filter((m) => m.userId !== project.ownerId)].map((m) => (
              <span key={m.userId} className="inline-flex items-center gap-1.5 text-[13px]">
                <PersonDot userId={m.userId} size={22} />
                {getUser(m.userId)?.name}
                <span className="text-[11px] text-[var(--ink-soft)]">{{ owner: "เจ้าของ", editor: "แก้ได้", viewer: "ดูอย่างเดียว" }[m.role]}</span>
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** ลิงก์สำคัญ (Asana "Key resources") — ปักลิงก์เอกสาร/ไดรฟ์/แบบบ้าน ไว้หน้าภาพรวม */
function KeyResources({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const updateProject = useProjectStore((s) => s.updateProject);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const list = project.resources ?? [];
  const field = "w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-base sm:text-sm";
  function add() {
    let u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    try { new URL(u); } catch { toast.error("ลิงก์ไม่ถูกต้อง"); return; }
    const t = title.trim() || new URL(u).hostname;
    updateProject(project.id, { resources: [...list, { id: uuid(), title: t, url: u, by: me, at: new Date().toISOString() }] });
    setTitle(""); setUrl(""); setAdding(false);
  }
  if (!list.length && !canEdit) return null;
  return (
    <section className="rounded-xl border border-[var(--line)] p-4">
      <div className="mb-2 flex items-center">
        <h3 className="m-0 text-sm font-semibold">ลิงก์สำคัญ</h3>
        {canEdit && !adding && <button type="button" className="ml-auto text-xs font-semibold text-[var(--brand-green-dark)]" onClick={() => setAdding(true)}>+ เพิ่มลิงก์</button>}
      </div>
      {list.length > 0 && (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <span aria-hidden>🔗</span>
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[var(--brand-green-dark)] hover:underline" title={r.url}>{r.title}</a>
              {canEdit && (
                <button type="button" className="px-1 text-[var(--ink-soft)]" aria-label={`เอาลิงก์ ${r.title} ออก`}
                  onClick={() => updateProject(project.id, { resources: list.filter((x) => x.id !== r.id) })}>✕</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!list.length && !adding && <p className="m-0 text-xs text-[var(--ink-soft)]">ปักลิงก์ที่ทีมต้องเปิดบ่อย เช่น แบบบ้าน ใบเสนอราคา โฟลเดอร์รูป</p>}
      {adding && (
        <div className="mt-2 grid gap-2">
          <input className={field} placeholder="ชื่อ เช่น แบบบ้าน HS3" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className={field} placeholder="วางลิงก์ https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} autoFocus />
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-lg px-3 py-1 text-xs" onClick={() => setAdding(false)}>ยกเลิก</button>
            <button type="button" className="rounded-lg bg-[var(--brand-green)] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={!url.trim()} onClick={add}>เพิ่ม</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** ขอให้เจ้าของโปรเจกต์อัปเดตสถานะ (Asana "Ask for update") — เจ้าของเองไม่เห็นปุ่ม */
function AskUpdateButton({ project }: { project: Project }) {
  const me = useIdentityStore((s) => s.viewingAsUserId);
  if (me === project.ownerId || project.closedStatus) return null;
  return (
    <button type="button" className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs hover:bg-[var(--bg-soft)]"
      onClick={() => {
        const name = getUser(me)?.name ?? "มีคน";
        useNotificationStore.getState().notifyMany([project.ownerId], me, `${name} ขอให้อัปเดตสถานะโปรเจกต์ "${project.name}"`, undefined, `/report-task/projects/${project.id}`);
        toast.success(`ส่งคำขอให้ ${getUser(project.ownerId)?.name ?? "เจ้าของ"} แล้ว`);
      }}>
      🔔 ขอให้อัปเดต
    </button>
  );
}

function UpdatePost({ u }: { u: Project["updates"][number] }) {
  const tone = PROJECT_STATUS_META[u.status].tone;
  const border = { ok: "border-green-500", risk: "border-amber-500", late: "border-red-500", info: "border-sky-500", muted: "border-slate-400" }[tone];
  return (
    <div className={cn("grid gap-1 border-l-4 pl-3", border)}>
      <div className="flex flex-wrap items-center gap-2">
        <ProjectStatusChip status={u.status} />
        <span className="text-xs text-[var(--ink-soft)]">{getUser(u.by)?.name ?? "—"} · {new Date(u.at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <p className="m-0 whitespace-pre-wrap text-sm">{u.text}</p>
    </div>
  );
}

function UpdatesTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const addUpdate = useProjectStore((s) => s.addUpdate);
  const [st, setSt] = useState<ProjectStatus>("ok");
  const [text, setText] = useState("");
  const list = [...project.updates].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="grid max-w-3xl gap-4">
      {canEdit && (
        <div className="grid gap-2.5 rounded-xl border border-[var(--line)] p-3.5">
          <b className="text-sm">อัปเดตสถานะประจำสัปดาห์</b>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(PROJECT_STATUS_META) as ProjectStatus[]).map((k) => (
              <button key={k} type="button" onClick={() => setSt(k)} aria-pressed={st === k}
                className={cn("rounded-full border px-3 py-1 text-xs", st === k ? "border-[var(--ink)] font-bold" : "border-[var(--line)] text-[var(--ink-soft)]")}>
                {PROJECT_STATUS_META[k].label}
              </button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="สัปดาห์นี้ทำอะไรไปแล้ว ติดอะไร ต้องการให้ใครช่วย"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-base sm:text-sm" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--ink-soft)]">{st === "done" || st === "dropped" || st === "hold" ? "สถานะนี้จะปิดโปรเจกต์ (เปิดใหม่ได้ด้วยอัปเดตครั้งถัดไป)" : ""}</span>
            <button type="button" className="ml-auto rounded-lg bg-[var(--brand-green)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!text.trim()}
              onClick={() => { addUpdate(project.id, st, text.trim(), me); setText(""); toast.success("โพสต์อัปเดตแล้ว"); }}>
              โพสต์อัปเดต
            </button>
          </div>
        </div>
      )}
      <div className="flex"><span className="ml-auto"><AskUpdateButton project={project} /></span></div>
      {list.length ? list.map((u) => <UpdatePost key={u.id} u={u} />) : <p className="text-sm text-[var(--ink-soft)]">ยังไม่มีอัปเดต</p>}
    </div>
  );
}

/** ตั้งค่าโปรเจกต์ (เจ้าของ/CEO): ชื่อ เป้าหมาย วัน สมาชิก ช่วงงาน ลบโปรเจกต์ */
function ProjectSettingsButton({ project }: { project: Project }) {
  const router = useRouter();
  const updateProject = useProjectStore((s) => s.updateProject);
  const removeProject = useProjectStore((s) => s.removeProject);
  const addSection = useProjectStore((s) => s.addSection);
  const renameSection = useProjectStore((s) => s.renameSection);
  const removeSection = useProjectStore((s) => s.removeSection);
  const tasks = useTaskStore((s) => s.tasks);
  const setTaskProject = useTaskStore((s) => s.setTaskProject);
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const field = "w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-base sm:text-sm";
  const memberIds = new Set(project.members.map((m) => m.userId));
  return (
    <>
      <button type="button" className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-[var(--bg-soft)]" onClick={() => setOpen(true)}>ตั้งค่าโปรเจกต์</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="grid max-h-[90dvh] w-full gap-3 overflow-y-auto rounded-t-2xl bg-[var(--bg)] p-4 shadow-2xl sm:max-w-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="ตั้งค่าโปรเจกต์">
            <div className="flex items-center"><b>ตั้งค่าโปรเจกต์</b><button type="button" className="ml-auto px-2" onClick={() => setOpen(false)} aria-label="ปิด">✕</button></div>
            <label className="grid gap-1 text-xs text-[var(--ink-soft)]">ชื่อโปรเจกต์<input className={field} defaultValue={project.name} onBlur={(e) => e.target.value.trim() && updateProject(project.id, { name: e.target.value.trim() })} /></label>
            <label className="grid gap-1 text-xs text-[var(--ink-soft)]">เป้าหมาย / ขอบเขต<textarea className={field} rows={3} defaultValue={project.description} onBlur={(e) => updateProject(project.id, { description: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs text-[var(--ink-soft)]">วันเริ่ม<DatePickerField value={project.startDate} onChange={(v) => v && updateProject(project.id, { startDate: v })} /></label>
              <label className="grid gap-1 text-xs text-[var(--ink-soft)]">วันเสร็จเป้าหมาย<DatePickerField value={project.endDate} minDate={project.startDate} onChange={(v) => v && updateProject(project.id, { endDate: v })} /></label>
            </div>
            <label className="grid gap-1 text-xs text-[var(--ink-soft)]">เจ้าของโปรเจกต์ (คุมแผน เลื่อนกำหนดส่งได้)
              <select className={field} value={project.ownerId}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!next || next === project.ownerId) return;
                  // เจ้าของเดิมยังอยู่ต่อเป็นสมาชิก "แก้ได้" · เจ้าของใหม่ไม่ซ้ำในรายชื่อสมาชิก
                  const members = [...project.members.filter((m) => m.userId !== next && m.userId !== project.ownerId), { userId: project.ownerId, role: "editor" as const }];
                  updateProject(project.id, { ownerId: next, members });
                  useNotificationStore.getState().notifyMany([next], me, `${getUser(me)?.name ?? "มีคน"} ตั้งให้คุณเป็นเจ้าของโปรเจกต์ "${project.name}"`, undefined, `/report-task/projects/${project.id}`);
                  if (!memberIds.has(next)) syncChatMember(project, next, "add");
                  toast.success(`เปลี่ยนเจ้าของเป็น ${getUser(next)?.name ?? ""} แล้ว`);
                }}>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <div className="grid gap-1.5">
              <span className="text-xs text-[var(--ink-soft)]">สมาชิก</span>
              {project.members.filter((m) => m.userId !== project.ownerId).map((m) => (
                <div key={m.userId} className="flex items-center gap-2 text-sm">
                  <PersonDot userId={m.userId} size={22} />{getUser(m.userId)?.name}
                  <select className="ml-auto rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-base sm:text-xs" value={m.role}
                    onChange={(e) => updateProject(project.id, { members: project.members.map((x) => (x.userId === m.userId ? { ...x, role: e.target.value as "editor" | "viewer" } : x)) })}>
                    <option value="editor">แก้ได้</option><option value="viewer">ดูอย่างเดียว</option>
                  </select>
                  <button type="button" className="text-[var(--ink-soft)]" aria-label="เอาออก" onClick={() => {
                    updateProject(project.id, { members: project.members.filter((x) => x.userId !== m.userId) });
                    syncChatMember(project, m.userId, "remove");
                  }}>✕</button>
                </div>
              ))}
              <select className={field} value="" onChange={(e) => {
                  if (!e.target.value) return;
                  updateProject(project.id, { members: [...project.members, { userId: e.target.value, role: "editor" }] });
                  notifyAddedToProject(project, [e.target.value], me);
                  syncChatMember(project, e.target.value, "add");
                }}>
                <option value="">+ เพิ่มสมาชิก</option>
                {users.filter((u) => !memberIds.has(u.id) && u.id !== project.ownerId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <span className="text-xs text-[var(--ink-soft)]">ช่วงงาน</span>
              {project.sections.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <input className={field} defaultValue={s.name} onBlur={(e) => e.target.value.trim() && renameSection(project.id, s.id, e.target.value.trim())} />
                  <button type="button" className="text-[var(--ink-soft)]" aria-label="ลบช่วงงาน" disabled={project.sections.length <= 1}
                    onClick={() => {
                      const fallback = project.sections.find((x) => x.id !== s.id)!;
                      tasks.filter((t) => t.project?.projectId === project.id && t.project.sectionId === s.id)
                        .forEach((t) => setTaskProject(t.id, { ...t.project!, sectionId: fallback.id }, me));
                      removeSection(project.id, s.id);
                    }}>✕</button>
                </div>
              ))}
              <button type="button" className="w-max rounded-lg border border-[var(--line)] px-3 py-1 text-xs" onClick={() => addSection(project.id, "ช่วงใหม่")}>+ ช่วงงาน</button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
              {confirmDel ? (
                <button type="button" className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white"
                  onClick={() => {
                    tasks.filter((t) => t.project?.projectId === project.id).forEach((t) => setTaskProject(t.id, null, me));
                    removeProject(project.id);
                    toast.success("ลบโปรเจกต์แล้ว · งานยังอยู่บนบอร์ดงาน");
                    router.push("/report-task/projects");
                  }}>
                  ยืนยันลบโปรเจกต์ (งานยังอยู่บนบอร์ด)
                </button>
              ) : (
                <button type="button" className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-red-600" onClick={() => setConfirmDel(true)}>ลบโปรเจกต์</button>
              )}
              <button type="button" className="ml-auto rounded-lg bg-[var(--brand-green)] px-4 py-1.5 text-sm font-semibold text-white" onClick={() => setOpen(false)}>เสร็จ</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

