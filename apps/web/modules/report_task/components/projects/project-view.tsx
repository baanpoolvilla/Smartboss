"use client";

import Link from "next/link";
import { CalendarDays, ChartColumn, Flag, GanttChart, LayoutGrid, List, MessageSquare, Paperclip, SquareKanban, type LucideIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { NewTaskDialog } from "@/modules/report_task/components/kanban/new-task-dialog";
import { useProjectPending } from "./project-pending";
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
import { updateChannel } from "@/modules/chat/lib/api";
import { PCT_HELP, PersonDot, ProjectStatusChip, STATE_COLOR, STATE_LABEL, StatePill, fmtDay, askProjectUpdate, defaultMemberRole, ensureProjectMembers, notifyAddedToProject, syncChatMember, todayBkk, useCompanyHolidays } from "./project-ui";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { ROLE_OF_DEFAULT } from "./project-roles";
import { useSetAppBarLeading } from "@/modules/report_task/components/shared/app-bar-leading";

// มุมมองเดียวกับ Asana: Overview · List · Board · Timeline(+Gantt) · Calendar · Dashboard · Messages · Files (+ อัปเดตสถานะ)
type Tab = "timeline" | "overview" | "list" | "board" | "calendar" | "dashboard" | "messages" | "files" | "updates";
// แท็บหลักโชว์ตลอด ที่เหลืออยู่ใต้ "เพิ่มเติม ▾" — 9 แท็บเรียงกันบนมือถือต้องเลื่อนหา คนทั่วไปงง
// 20/10/2569 (ตามเอกสาร Asana): เหลือ 4 แท็บ ภาพรวม · รายการ · บอร์ด · ไทม์ไลน์ — ข้อความ/อื่น ๆ อยู่ใน "เพิ่มเติม"
const PRIMARY_TABS: Tab[] = ["overview", "list", "board", "timeline"];
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "ภาพรวม", icon: LayoutGrid },
  { id: "list", label: "รายการ", icon: List },
  { id: "board", label: "บอร์ด", icon: SquareKanban },
  { id: "timeline", label: "ไทม์ไลน์", icon: GanttChart },
  { id: "calendar", label: "ปฏิทิน", icon: CalendarDays },
  { id: "dashboard", label: "แดชบอร์ด", icon: ChartColumn },
  { id: "messages", label: "ข้อความ", icon: MessageSquare },
  { id: "files", label: "ไฟล์", icon: Paperclip },
  { id: "updates", label: "อัปเดตสถานะ", icon: Flag },
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
  // "รอคุณ" เฉพาะโปรเจกต์นี้ (ผู้ใช้ขอ 18/10/2569 "ให้มีแจ้งเตือนในนี้ด้วย") — ชุดเดียวกับเลขแดงที่เมนูโปรเจกต์
  const pendingAll = useProjectPending();
  const pending = useMemo(() => pendingAll.filter((i) => i.projectId === projectId), [pendingAll, projectId]);
  const pendingIds = useMemo(() => new Set(pending.map((i) => i.taskId)), [pending]);
  const today = todayBkk();
  // เปิดหน้ามือถือ (จอแคบ) เจอ "รายการ" ก่อน — อ่านง่ายกว่า Timeline บนจอเล็ก
  // แท็บแรก: เจ้าของ/CEO บนคอม = แผนเวลา (คุมแผน) · คนอื่น/มือถือ = รายการ (อ่านง่ายสุด)
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) return "list";
    const p = useProjectStore.getState().projects.find((x) => x.id === projectId);
    return p && canPlanProject(p, useIdentityStore.getState().viewingAsUserId) ? "timeline" : "list";
  });
  const [newTaskSection, setNewTaskSection] = useState<string | null>(null);
  const searchParams = useSearchParams();
  // "งานของฉัน": พนักงานที่มีงานในโปรเจกต์เปิดมาเห็นเฉพาะงานตัวเองก่อน (ไม่ต้องไล่หาชื่อตัวเองในรายการ)
  // เจ้าของ/CEO เห็นทั้งหมดก่อน · ลิงก์ ?mine=1 (จาก "งานของฉันในโปรเจกต์") บังคับเปิดแบบของฉัน
  const [mineOnly, setMineOnly] = useState<boolean>(() => {
    if (searchParams.get("mine") === "1") return true;
    const p = useProjectStore.getState().projects.find((x) => x.id === projectId);
    const uid = useIdentityStore.getState().viewingAsUserId;
    if (!p || canPlanProject(p, uid)) return false;
    return useTaskStore.getState().tasks.some((t) => t.project?.projectId === projectId && t.assigneeIds.includes(uid));
  });

  const allItems = useMemo(() => (project ? timelineItems(project, tasks, today) : []), [project, tasks, today]);
  const myCount = useMemo(() => allItems.filter((i) => i.kind === "task" && i.assigneeIds.includes(me)).length, [allItems, me]);
  const mineView = mineOnly && myCount > 0;
  // มุมมองงาน (รายการ/บอร์ด/แผนเวลา/ปฏิทิน) กรองตามปุ่ม · ภาพรวม/แดชบอร์ด/ไฟล์ ยังเป็นของทั้งโปรเจกต์
  const items = useMemo(() => (mineView ? allItems.filter((i) => i.kind === "task" && i.assigneeIds.includes(me)) : allItems), [allItems, mineView, me]);

  // ยังโหลดไม่เสร็จ — อย่าเพิ่งขึ้น "ไม่พบโปรเจกต์" (เปิดจากลิงก์แจ้งเตือนจะเห็นแวบหนึ่ง) และกันแก้ก่อนโหลดเสร็จ
  // แถบหัว: ‹ โปรเจกต์ทั้งหมด ซ้ายบน · บันทึกเป็นแม่แบบ / ⚙ ตั้งค่าโปรเจกต์ ขวาบน · ไม่มีชื่อหน้า "โปรเจกต์"
  // (20/10/2569 "ย้ายตรงนี้ด้วย") — ต้องเรียกก่อน return ด้านล่าง (กฎของ hook)
  const headerCanEdit = !!project && canEditProject(project, me);
  const headerCanPlan = !!project && canPlanProject(project, me);
  const appBarLeading = useMemo(
    () => (
      <div className="flex w-full min-w-0 items-center gap-2 pl-1 sm:pl-2">
        <Link
          href="/report-task/projects"
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13.5px] font-semibold text-[var(--brand-navy)] transition-colors hover:bg-[#eaeef5]"
        >
          <span className="text-lg leading-none">‹</span> โปรเจกต์ทั้งหมด
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {project && headerCanEdit && (
            <button type="button" className="hidden h-9 cursor-pointer rounded-lg border border-[#cfd6e2] bg-[#eaeef5] px-3.5 text-[13px] font-semibold text-[var(--brand-navy)] transition-colors hover:bg-[#dde3ee] disabled:opacity-50 sm:inline-flex sm:items-center" disabled={!templatesReady}
              onClick={() => {
                const t = templateFromProject(project, items, (uid) => ROLE_OF_DEFAULT(uid), () => `tpl-${uuid()}`, me);
                upsertTemplate(t);
                toast.success("บันทึกเป็นแม่แบบแล้ว · แก้ต่อได้ที่หน้าแม่แบบ");
                router.push(`/report-task/projects/templates?t=${t.id}`);
              }}>
              บันทึกเป็นแม่แบบ
            </button>
          )}
          {project && headerCanPlan && <ProjectSettingsButton project={project} />}
        </div>
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, headerCanEdit, headerCanPlan, templatesReady, items, me]
  );
  useSetAppBarLeading(appBarLeading);

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
  const status = projectStatusOf(project, allItems);
  const pct = progressOf(allItems);

  // ปุ่ม "งานของฉัน" — คอม: ท้ายแถวแท็บ · มือถือ: ท้ายบรรทัดข้อมูลโปรเจกต์ (แถวแท็บมือถือแคบ ใส่แล้วแท็บถูกบีบ)
  const mineToggle = (where: "desk" | "mobile") =>
    myCount > 0 && MINE_TABS.includes(tab) ? (
          <button type="button" aria-pressed={mineOnly} onClick={() => setMineOnly((v) => !v)}
            title={mineOnly ? "กำลังดูเฉพาะงานที่คุณรับผิดชอบ · กดเพื่อดูทั้งหมด" : "ดูเฉพาะงานที่คุณรับผิดชอบ"}
            className={cn(
              where === "desk" ? "mb-1.5 ml-auto hidden h-8 sm:inline-flex" : "ml-auto inline-flex h-8 sm:hidden",
              "shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors",
              mineOnly ? "border-[var(--brand-navy)] bg-[var(--brand-navy)] text-white" : "border-[#cfd6e2] bg-[#eaeef5] text-[var(--brand-navy)] hover:bg-[#dde3ee]"
            )}>
            <span aria-hidden>👤</span><span className="hidden sm:inline">งานของฉัน</span><span className="sm:hidden">ของฉัน</span>
            <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums leading-[16px]", mineOnly ? "bg-white text-[var(--brand-navy)]" : "bg-white/80")}>{myCount}</span>
          </button>
    ) : null;

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          {/* คอม: ข้อมูลโปรเจกต์ (ผู้ดูแล วัน เหลือกี่วัน %เสร็จ) ชิดขวาแถวเดียวกับชื่อ (ผู้ใช้ 21/10/2569) · มือถือ: ใต้ชื่อเหมือนเดิม */}
          <div className="flex min-w-0 flex-[1_1_320px] flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="m-0 min-w-0 break-words text-xl font-bold leading-tight sm:text-2xl">{project.name}</h1>
              <ProjectStatusChip status={status} />
            </div>
            {/* แยกข้อมูลเป็นก้อน อ่านทีละอย่าง — เดิมยัดบรรทัดเดียวตัวเล็ก */}
            <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-[var(--ink-soft)] sm:ml-auto sm:basis-auto sm:gap-x-5">
              <span className="inline-flex items-center gap-1.5"><PersonDot userId={project.ownerId} size={20} /><span className="text-[var(--ink)]">{getUser(project.ownerId)?.name ?? "—"}</span> ผู้ดูแลโปรเจกต์</span>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{fmtDay(project.startDate)} – {fmtDay(project.endDate, true)}</span>
              <span>{project.closedStatus ? "ปิดแล้ว" : dayNum(project.endDate) >= dayNum(today) ? `เหลือ ${dayNum(project.endDate) - dayNum(today)} วัน` : `เลยวันเสร็จมา ${dayNum(today) - dayNum(project.endDate)} วัน`}</span>
              <span className="inline-flex items-center gap-2" title={PCT_HELP}>
                <span className="h-2 w-14 overflow-hidden rounded-full sm:w-28 bg-[var(--bg-soft)] ring-1 ring-[var(--line)]">
                  <span className="block h-full rounded-full bg-[var(--brand-green)]" style={{ width: `${pct}%` }} />
                </span>
                <b className="tabular-nums text-[var(--ink)]">{pct}%</b> เสร็จ
              </span>
              {mineToggle("mobile")}
            </div>
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
              className={cn("inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2.5 text-[14px] transition-colors sm:px-3.5", tab === t.id ? "font-bold text-[var(--brand-navy)] shadow-[inset_0_-2px_0_var(--brand-navy)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]")}>
              <t.icon className="hidden h-4 w-4 sm:block" />
              {t.label}
              {/* เลขแดง = งานในโปรเจกต์นี้ที่มีเรื่องรอเรา (แท็บที่โชว์งาน) */}
              {(t.id === "list" || t.id === "board") && pending.length > 0 && (
                <span className="rounded-full bg-[#dc2626] px-1.5 text-[11px] font-bold leading-[18px] text-white">{pending.length}</span>
              )}
            </button>
          ))}
        </div>
        <MoreTabs tab={tab} onPick={setTab} />
        {/* "งานของฉัน" เป็นปุ่มเปิด/ปิดปุ่มเดียวท้ายแถวแท็บ (เดิมเป็นแถว "งานของฉัน | ทั้งหมด" แยก) — ประหยัดความสูงหัวโปรเจกต์ */}
        {mineToggle("desk")}
      </div>

      {allItems.length === 0 && EMPTY_TABS.includes(tab) ? (
        <EmptyProject canEdit={canEdit} onAddTask={() => setNewTaskSection(project.sections[0]?.id ?? "")} onTemplates={() => router.push("/report-task/projects/templates")} />
      ) : <>
      {tab === "timeline" && (
        <ProjectTimeline project={project} items={items} today={today} holidays={holidays} canEdit={canEdit} canPlan={canPlan}
          onOpenTask={(id) => openTask(id)} onAddTask={(sec) => setNewTaskSection(sec || project.sections[0]?.id || "")} />
      )}
      {tab === "overview" && <Overview project={project} items={allItems} pct={pct} today={today} canEdit={canEdit} onOpen={(id) => openTask(id)} />}
      {tab === "list" && <ListTab project={project} items={items} canEdit={canEdit} canPlan={canPlan} onOpen={(id) => openTask(id)} pendingIds={pendingIds} />}
      {tab === "board" && <BoardTab project={project} items={items} canEdit={canEdit} onOpen={(id) => openTask(id)} />}
      {tab === "calendar" && <CalendarTab items={items} today={today} onOpen={(id) => openTask(id)} />}
      {tab === "dashboard" && <DashboardTab project={project} items={allItems} today={today} onOpen={(id) => openTask(id)} />}
      {tab === "messages" && <MessagesTab project={project} canEdit={canEdit} />}
      {tab === "files" && <FilesTab items={allItems} onOpen={(id) => openTask(id)} />}
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
/** แท็บที่ปุ่ม "งานของฉัน | ทั้งหมด" มีผล */
const MINE_TABS: Tab[] = ["list", "board", "timeline", "calendar"];

/** แท็บรอง (บอร์ด… ไฟล์ อัปเดตสถานะ) — ปุ่มบอกชื่อแท็บที่เปิดอยู่ถ้าเป็นแท็บรอง */
function MoreTabs({ tab, onPick }: { tab: Tab; onPick: (t: Tab) => void }) {
  const [open, setOpen] = useState(false);
  const rest = TABS.filter((t) => !PRIMARY_TABS.includes(t.id));
  const active = rest.find((t) => t.id === tab);
  return (
    <div className="relative shrink-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2.5 text-[14px] sm:px-3.5", active ? "font-bold text-[var(--brand-navy)] shadow-[inset_0_-2px_0_var(--brand-navy)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]")}>
        {active && <active.icon className="h-4 w-4" />}
        {active ? active.label : "เพิ่มเติม"} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-1 grid w-max min-w-40 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-1 shadow-xl">
            {rest.map((t) => (
              <button key={t.id} type="button" onClick={() => { onPick(t.id); setOpen(false); }}
                className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--bg-soft)]", tab === t.id && "font-bold text-[var(--brand-navy)]")}>
                <t.icon className="h-4 w-4 text-[var(--ink-soft)]" />
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
      ) : <p className="m-0 text-sm text-[var(--ink-soft)]">รอผู้ดูแลโปรเจกต์เพิ่มงาน</p>}
    </div>
  );
}

function Overview({ project, items, pct, today, canEdit, onOpen }: { project: Project; items: ReturnType<typeof timelineItems>; pct: number; today: string; canEdit: boolean; onOpen: (id: string) => void }) {
  const tasksOnly = items.filter((i) => i.kind === "task");
  const n = (s: string) => tasksOnly.filter((i) => i.state === s).length;
  const latest = [...project.updates].sort((a, b) => b.at.localeCompare(a.at))[0];
  const miles = items.filter((i) => i.kind === "milestone").sort((a, b) => a.start.localeCompare(b.start));
  const R = 26, C = 2 * Math.PI * R;
  const { late, affected } = lateImpact(items);
  const daysLeft = dayNum(project.endDate) - dayNum(today);
  // งานที่ต้องทำต่อ: เลยกำหนดก่อน แล้วตามวันส่ง (ไม่รวมที่เสร็จแล้ว)
  const next = tasksOnly
    .filter((i) => i.state !== "done")
    .sort((a, b) => (a.state === "late" ? 0 : 1) - (b.state === "late" ? 0 : 1) || a.end.localeCompare(b.end))
    .slice(0, 6);
  const card = "rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4";
  const h = "m-0 text-[15px] font-bold";
  const tiles: { k: "done" | "doing" | "late" | "todo"; icon: string }[] = [
    { k: "done", icon: "✓" }, { k: "doing", icon: "▶" }, { k: "late", icon: "!" }, { k: "todo", icon: "○" },
  ];
  return (
    <div className="grid gap-3">
      {/* แถวสรุป — อ่านจบในบรรทัดเดียว */}
      {/* มือถือ: ความคืบหน้าเต็มแถว แล้วตัวเลข 4 ช่องเรียงแถวเดียว (เดิม 2x2 กล่องใหญ่กินจอ) */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        <div className={cn(card, "col-span-4 flex items-center gap-3 sm:col-span-1")} title={PCT_HELP}>
          <svg width="64" height="64" viewBox="0 0 64 64" aria-label={`ความคืบหน้า ${pct}%`} className="shrink-0">
            {/* เส้นพื้นหลังต้องมองเห็น (เดิมใช้สีเดียวกับพื้นการ์ด เหลือแต่เส้นโค้งลอย ๆ) */}
            <circle cx="32" cy="32" r={R} fill="none" stroke="var(--line)" strokeWidth="7" />
            {pct > 0 && <circle cx="32" cy="32" r={R} fill="none" stroke="var(--brand-green)" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(C * pct) / 100} ${C}`} transform="rotate(-90 32 32)" />}
            <text x="32" y="37" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--ink)">{pct}%</text>
          </svg>
          <div className="min-w-0">
            <b className="block text-[14px]">ความคืบหน้า</b>
            <span className={cn("text-[12.5px]", daysLeft < 0 && !project.closedStatus ? "font-semibold text-red-600" : "text-[var(--ink-soft)]")}>
              {project.closedStatus ? "ปิดโปรเจกต์แล้ว" : daysLeft >= 0 ? `เหลือ ${daysLeft} วัน` : `เลยวันเสร็จ ${-daysLeft} วัน`}
            </span>
          </div>
        </div>
        {tiles.map(({ k, icon }) => {
          const v = n(k);
          const hot = k === "late" && v > 0;
          return (
            <div key={k} className={cn(card, "grid content-center gap-0.5 max-sm:p-2.5 max-sm:text-center", hot && "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30")}>
              <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--ink-soft)] max-sm:flex-col max-sm:gap-1 max-sm:text-[11px]">
                <span className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: k === "todo" ? "var(--chart-gray)" : STATE_COLOR[k] }}>{icon}</span>
                {STATE_LABEL[k]}
              </span>
              <b className={cn("text-[22px] leading-tight tabular-nums sm:text-[28px]", hot && "text-red-600")}>{v}</b>
            </div>
          );
        })}
      </div>

      {late.length > 0 && (
        <p className="m-0 rounded-xl bg-red-50 px-4 py-2.5 text-[13.5px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <b>เลยกำหนด:</b> {late.map((l) => l.name).join(", ")}{affected.length ? ` · มีงาน/จุดสำคัญรออยู่ ${affected.length} รายการ` : ""}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <section className={card}>
            <h3 className={cn(h, "mb-2")}>งานที่ต้องทำต่อ</h3>
            {next.length ? (
              <ul className="m-0 grid list-none gap-0.5 p-0">
                {next.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => onOpen(i.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-[var(--bg-soft)]">
                      {i.assigneeIds[0] ? <PersonDot userId={i.assigneeIds[0]} size={24} /> : <span className="w-6" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{i.parentId ? "↳ " : ""}{i.name}</span>
                        <span className="block truncate text-[12px] text-[var(--ink-soft)]">{getUser(i.assigneeIds[0] ?? "")?.name ?? "ยังไม่มีคนทำ"} · ส่ง {fmtDay(i.end)}</span>
                      </span>
                      <StatePill state={i.state} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 text-[13.5px] text-[var(--ink-soft)]">{tasksOnly.length ? "งานทั้งหมดเสร็จแล้ว 🎉" : "ยังไม่มีงานในโปรเจกต์"}</p>}
          </section>
          <section className={card}>
            <h3 className={cn(h, "mb-1.5")}>เป้าหมาย</h3>
            {project.description ? (
              <p className="m-0 whitespace-pre-wrap text-[14px] leading-relaxed">{project.description}</p>
            ) : (
              <p className="m-0 text-[13.5px] text-[var(--ink-soft)]">ยังไม่ได้เขียนเป้าหมาย{canEdit ? " · เขียนได้ใน ⚙ ตั้งค่าโปรเจกต์ (เช่น ทำอะไร ให้เสร็จเมื่อไหร่ งบเท่าไหร่)" : ""}</p>
            )}
          </section>
          <KeyResources project={project} canEdit={canEdit} />
        </div>

        <div className="grid content-start gap-3">
          <section className={card}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className={h}>สถานะล่าสุด</h3>
              <span className="ml-auto"><AskUpdateButton project={project} /></span>
            </div>
            {latest ? <UpdatePost u={latest} /> : <p className="m-0 text-[13.5px] text-[var(--ink-soft)]">ยังไม่มีอัปเดต · โพสต์ได้ในแท็บ &quot;อัปเดตสถานะ&quot; (เพิ่มเติม ▾)</p>}
          </section>
          <section className={card}>
            <h3 className={cn(h, "mb-2")}>จุดสำคัญ</h3>
            {miles.length ? (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {miles.map((m) => {
                  const d = dayNum(m.start) - dayNum(today);
                  return (
                    <li key={m.id} className="flex items-center gap-2.5 text-[14px]">
                      <span className="h-3 w-3 shrink-0 rotate-45 rounded-[2px]" style={{ background: m.state === "done" ? STATE_COLOR.done : m.state === "late" ? STATE_COLOR.late : "var(--chart-violet)" }} />
                      <span className={cn("min-w-0 flex-1 truncate", m.state === "done" && "text-[var(--ink-soft)] line-through")}>{m.name}</span>
                      <span className="whitespace-nowrap text-[12.5px] tabular-nums text-[var(--ink-soft)]">{fmtDay(m.start)}</span>
                      <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
                        m.state === "done" ? "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300" : d < 0 ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" : "bg-[var(--bg-soft)] text-[var(--ink-soft)]")}>
                        {m.state === "done" ? "ถึงแล้ว" : d < 0 ? `เลย ${-d} วัน` : d === 0 ? "วันนี้" : `อีก ${d} วัน`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="m-0 text-[13.5px] text-[var(--ink-soft)]">ยังไม่มีจุดสำคัญ · เพิ่มได้ในแท็บไทม์ไลน์</p>}
          </section>
          <section className={card}>
            <h3 className={cn(h, "mb-2")}>สมาชิก <span className="ml-1 text-[12px] font-normal text-[var(--ink-soft)]">{project.members.filter((m) => m.userId !== project.ownerId).length + 1} คน</span></h3>
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {[{ userId: project.ownerId, role: "owner" as const }, ...project.members.filter((m) => m.userId !== project.ownerId)].map((m) => (
                <li key={m.userId} className="flex items-center gap-2.5 text-[14px]">
                  <PersonDot userId={m.userId} size={26} />
                  <span className="min-w-0 flex-1 truncate">{getUser(m.userId)?.name ?? "—"}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", m.role === "owner" ? "bg-[var(--accent)] text-[var(--brand-green-dark)]" : "bg-[var(--bg-soft)] text-[var(--ink-soft)]")}>
                    {{ owner: "ผู้ดูแลโปรเจกต์", editor: "แก้ได้", viewer: "ดูอย่างเดียว" }[m.role]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
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
  const field = "w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-base sm:text-sm text-[var(--ink)]";
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
      onClick={() => askProjectUpdate(project, me)}>
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
              onClick={() => {
                addUpdate(project.id, st, text.trim(), me);
                setText("");
                toast.success("โพสต์อัปเดตแล้ว");
                // ปิดโปรเจกต์ (เสร็จแล้ว/ยกเลิก) → ปิดห้องแชทของโปรเจกต์ให้ (อ่านย้อนหลังได้) · เปิดโปรเจกต์กลับ → เปิดห้องกลับ
                // ไม่มีสิทธิ์/ไม่มีห้อง = เงียบไว้ (ผู้ใช้ 20/10/2569)
                const wasClosed = project.closedStatus === "done" || project.closedStatus === "dropped";
                const nowClosed = st === "done" || st === "dropped";
                if (project.chatChannelId && wasClosed !== nowClosed) {
                  updateChannel(project.chatChannelId, { closed: nowClosed })
                    .then(() => toast.success(nowClosed ? "ปิดห้องแชทของโปรเจกต์ให้แล้ว · อ่านย้อนหลังได้" : "เปิดห้องแชทของโปรเจกต์อีกครั้งแล้ว"))
                    .catch(() => {});
                }
              }}>
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
  const field = "w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-base sm:text-sm text-[var(--ink)]";
  const memberIds = new Set(project.members.map((m) => m.userId));
  return (
    <>
      <button type="button" className="h-9 rounded-lg border border-[var(--line)] px-3.5 text-[13px] hover:bg-[var(--bg-soft)]" onClick={() => setOpen(true)}>⚙ ตั้งค่าโปรเจกต์</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="grid max-h-[90dvh] w-full gap-3 overflow-y-auto rounded-t-2xl bg-[var(--bg)] p-4 shadow-2xl sm:max-w-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="ตั้งค่าโปรเจกต์">
            <div className="flex items-center"><b>ตั้งค่าโปรเจกต์</b><button type="button" className="ml-auto px-2" onClick={() => setOpen(false)} aria-label="ปิด">✕</button></div>
            <label className="grid gap-1 text-xs text-[var(--ink-soft)]">ชื่อโปรเจกต์<input className={field} defaultValue={project.name} onBlur={(e) => e.target.value.trim() && updateProject(project.id, { name: e.target.value.trim() })} /></label>
            <label className="grid gap-1 text-xs text-[var(--ink-soft)]">เป้าหมาย / ขอบเขต<textarea className={field} rows={3} defaultValue={project.description} onBlur={(e) => updateProject(project.id, { description: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs text-[var(--ink-soft)]">วันเริ่ม<DatePickerField className="text-[var(--ink)]" value={project.startDate} onChange={(v) => v && updateProject(project.id, { startDate: v })} /></label>
              <label className="grid gap-1 text-xs text-[var(--ink-soft)]">วันเสร็จเป้าหมาย<DatePickerField className="text-[var(--ink)]" value={project.endDate} minDate={project.startDate} onChange={(v) => v && updateProject(project.id, { endDate: v })} /></label>
            </div>
            <label className="grid gap-1 text-xs text-[var(--ink-soft)]">ผู้ดูแลโปรเจกต์ (คุมแผน เลื่อนกำหนดส่งได้)
              <select className={field} value={project.ownerId}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!next || next === project.ownerId) return;
                  // เจ้าของเดิมยังอยู่ต่อเป็นสมาชิก "แก้ได้" · เจ้าของใหม่ไม่ซ้ำในรายชื่อสมาชิก
                  const members = [...project.members.filter((m) => m.userId !== next && m.userId !== project.ownerId), { userId: project.ownerId, role: "editor" as const }];
                  updateProject(project.id, { ownerId: next, members });
                  useNotificationStore.getState().notifyMany([next], me, `${getUser(me)?.name ?? "มีคน"} ตั้งให้คุณเป็นผู้ดูแลโปรเจกต์ "${project.name}"`, undefined, `/report-task/projects/${project.id}`);
                  if (!memberIds.has(next)) syncChatMember(project, next, "add");
                  toast.success(`เปลี่ยนผู้ดูแลโปรเจกต์เป็น ${getUser(next)?.name ?? ""} แล้ว`);
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
                  updateProject(project.id, { members: [...project.members, { userId: e.target.value, role: defaultMemberRole(e.target.value) }] });
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

