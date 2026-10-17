import type {
  Project,
  ProjectDepRule,
  ProjectMilestone,
  ProjectStatus,
  ProjectTemplate,
  ProjectTemplateItem,
  Task,
} from "@/modules/report_task/types";

/**
 * โปรเจกต์ + Timeline (แบบ Asana) — ฟังก์ชันล้วน ไม่แตะ store
 *
 * ตรรกะเดียวกับ Asana แต่ตัดให้ง่าย (ดู memory projects-timeline-feature / mockup):
 * - งานที่ต้องรอมีแบบเดียว "เสร็จแล้วถึงเริ่มได้" (finish → start) · รอ Milestone = เริ่มวันเดียวกันได้
 * - เลื่อนแล้วชนงานที่รออยู่: ถามก่อน / เลื่อนตามทันที / เลื่อนตามแบบรักษาระยะห่างเดิม
 * - % ความคืบหน้าถ่วงตามจำนวนวันของงาน
 *
 * วันที่ทั้งหมดในไฟล์นี้เป็น "YYYY-MM-DD" คำนวณแบบ UTC — ไม่ขึ้นกับ timezone ของเครื่อง
 */

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; tone: "ok" | "risk" | "late" | "muted" | "info" }> = {
  ok: { label: "ตามแผน", tone: "ok" },
  risk: { label: "มีความเสี่ยง", tone: "risk" },
  late: { label: "ล่าช้า", tone: "late" },
  hold: { label: "พักไว้", tone: "info" },
  done: { label: "เสร็จแล้ว", tone: "muted" },
  dropped: { label: "ยกเลิก", tone: "muted" },
};

export const dayNum = (s: string): number => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
export const ymdOfDay = (d: number): string => new Date(d * 864e5).toISOString().slice(0, 10);
export const ymd = (iso: string): string => iso.slice(0, 10);
export const shiftDays = (s: string, n: number): string => ymdOfDay(dayNum(s) + n);
export const dayToIso = (s: string): string => `${s}T00:00:00.000Z`;

export type ItemState = "done" | "doing" | "todo" | "late";

/** แถวหนึ่งบน Timeline — งาน (Task จริงบนบอร์ด) หรือ Milestone ของโปรเจกต์ */
export interface TimelineItem {
  kind: "task" | "milestone";
  id: string;
  name: string;
  sectionId: string;
  start: string;
  end: string;
  state: ItemState;
  assigneeIds: string[];
  deps: string[];
  /** วิธีรอของแต่ละ dep — ไม่มี key = เริ่มหลังเสร็จ */
  depRules: Record<string, ProjectDepRule>;
  /** งานที่กำลังทำ: % ของเช็คลิสต์ที่ติ๊กแล้ว */
  pct?: number;
  task?: Task;
  milestone?: ProjectMilestone;
}

export function projectTasks(tasks: Task[], projectId: string): Task[] {
  return tasks.filter((t) => t.project?.projectId === projectId);
}

export function timelineItems(project: Project, tasks: Task[], today: string): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const t of projectTasks(tasks, project.id)) {
    const start = ymd(t.startDate), end = ymd(t.dueDate) < start ? start : ymd(t.dueDate);
    const doneItems = t.checklist.filter((c) => c.done).length;
    const state: ItemState = t.status === "done" ? "done" : end < today ? "late" : t.status === "in_progress" ? "doing" : "todo";
    out.push({
      kind: "task",
      id: t.id,
      name: t.title,
      sectionId: t.project!.sectionId,
      start,
      end,
      state,
      assigneeIds: t.assigneeIds,
      deps: t.project!.dependsOn ?? [],
      depRules: t.project!.depRules ?? {},
      pct: t.checklist.length ? Math.round((doneItems / t.checklist.length) * 100) : undefined,
      task: t,
    });
  }
  for (const m of project.milestones) {
    out.push({
      kind: "milestone",
      id: m.id,
      name: m.name,
      sectionId: m.sectionId,
      start: m.date,
      end: m.date,
      state: m.doneAt ? "done" : m.date < today ? "late" : "todo",
      assigneeIds: [],
      deps: m.dependsOn ?? [],
      depRules: m.depRules ?? {},
      milestone: m,
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

/** % ความคืบหน้า — ถ่วงตามจำนวนวันของงาน (งาน 10 วันนับมากกว่างาน 1 วัน) งานที่กำลังทำนับตาม % เช็คลิสต์ */
export function progressOf(items: TimelineItem[]): number {
  let total = 0, got = 0;
  for (const i of items) {
    if (i.kind !== "task") continue;
    const len = dayNum(i.end) - dayNum(i.start) + 1;
    total += len;
    got += i.state === "done" ? len : (len * (i.pct ?? 0)) / 100;
  }
  return total ? Math.round((got / total) * 100) : 0;
}

/** วันแรกที่งานนี้เริ่มได้ ถ้าต้องรอ pre — รองานปกติ: วันถัดจากวันจบ · รอ Milestone: วันเดียวกันได้
 *  rule.type "ss" = เริ่มได้ตั้งแต่วันที่ pre เริ่ม · rule.lag = บวกอีกกี่วัน */
export function earliestAfter(pre: Pick<TimelineItem, "kind" | "start" | "end">, rule?: ProjectDepRule): number {
  const lag = Math.max(0, Math.round(rule?.lag ?? 0));
  if (rule?.type === "ss") return dayNum(pre.start) + lag;
  return dayNum(pre.end) + (pre.kind === "milestone" ? 0 : 1) + lag;
}

/** คำอธิบายสั้น ๆ ของวิธีรอ — "" = แบบปกติ (เริ่มหลังเสร็จ) */
export function depRuleLabel(rule?: ProjectDepRule): string {
  const lag = Math.max(0, Math.round(rule?.lag ?? 0));
  if (rule?.type === "ss") return lag ? `เริ่มหลังงานนี้เริ่ม ${lag} วัน` : "เริ่มพร้อมกันได้";
  return lag ? `รอ ${lag} วันหลังเสร็จ` : "";
}

/** คู่ [งานที่ต้องรอ, งานที่เริ่มก่อนงานนั้นเสร็จ] */
export function conflictsOf(items: TimelineItem[]): [TimelineItem, TimelineItem][] {
  const by = new Map(items.map((i) => [i.id, i]));
  const out: [TimelineItem, TimelineItem][] = [];
  for (const i of items) for (const d of i.deps) { const pre = by.get(d); if (pre && dayNum(i.start) < earliestAfter(pre, i.depRules[d])) out.push([pre, i]); }
  return out;
}

export function successorsOf(items: TimelineItem[], id: string): TimelineItem[] {
  return items.filter((i) => i.deps.includes(id));
}

export interface ItemMove {
  id: string;
  kind: "task" | "milestone";
  start: string;
  end: string;
}

/** เลื่อนงานที่รออยู่ไปเริ่มหลังงานที่ต้องรอเสร็จ (แก้ทุกจุดที่ชน ไล่ต่อเนื่องจนนิ่ง) */
export function cascadePlan(items: TimelineItem[]): ItemMove[] {
  const cur = new Map(items.map((i) => [i.id, { ...i }]));
  const moved = new Set<string>();
  for (let guard = 0; guard < 200; guard++) {
    let changed = false;
    for (const i of cur.values()) for (const d of i.deps) {
      const pre = cur.get(d);
      if (!pre || i.state === "done") continue;
      const need = earliestAfter(pre, i.depRules[d]);
      if (dayNum(i.start) < need) {
        const len = dayNum(i.end) - dayNum(i.start);
        i.start = ymdOfDay(need);
        i.end = ymdOfDay(need + len);
        moved.add(i.id);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return [...moved].map((id) => { const i = cur.get(id)!; return { id, kind: i.kind, start: i.start, end: i.end }; });
}

/** เลื่อนทุกงานที่รอ id (ต่อกันเป็นทอด) ไปเท่ากับ delta วัน — "รักษาระยะห่างเดิม" */
export function keepGapPlan(items: TimelineItem[], id: string, delta: number): ItemMove[] {
  const out: ItemMove[] = [];
  const seen = new Set<string>([id]);
  const walk = (from: string) => {
    for (const s of successorsOf(items, from)) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      if (s.state !== "done") out.push({ id: s.id, kind: s.kind, start: shiftDays(s.start, delta), end: shiftDays(s.end, delta) });
      walk(s.id);
    }
  };
  walk(id);
  return out;
}

/** ตั้ง to ต้องรอ from แล้วจะรอกันวนไหม */
export function wouldCycle(items: TimelineItem[], from: string, to: string): boolean {
  const by = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    by.get(id)?.deps.forEach((d) => stack.push(d));
  }
  return false;
}

/** งานที่เลยกำหนด + ทุกงาน/Milestone ที่รอมันอยู่ (ต่อกันเป็นทอด) */
export function lateImpact(items: TimelineItem[]): { late: TimelineItem[]; affected: TimelineItem[] } {
  const late = items.filter((i) => i.kind === "task" && i.state === "late");
  const aff = new Map<string, TimelineItem>();
  const walk = (id: string) => successorsOf(items, id).forEach((s) => { if (!aff.has(s.id)) { aff.set(s.id, s); walk(s.id); } });
  late.forEach((l) => walk(l.id));
  return { late, affected: [...aff.values()] };
}

/** สถานะที่แสดง — ปิดด้วยมือ > อัปเดตล่าสุดของเจ้าของ > คิดเอง (มีงานเลยกำหนด = ล่าช้า) */
export function projectStatusOf(project: Project, items: TimelineItem[]): ProjectStatus {
  if (project.closedStatus) return project.closedStatus;
  const latest = [...project.updates].sort((a, b) => b.at.localeCompare(a.at))[0];
  if (latest) return latest.status;
  if (items.length && items.every((i) => i.state === "done")) return "done";
  return items.some((i) => i.state === "late") ? "late" : "ok";
}

/** ระบบเห็นว่าสถานะที่เจ้าของตั้งไว้ "ดีเกินจริง" ไหม (ตั้งตามแผนแต่มีงานเลยกำหนดกระทบ Milestone) */
export function suggestLate(project: Project, items: TimelineItem[]): boolean {
  if (project.closedStatus) return false;
  const { affected } = lateImpact(items);
  const st = projectStatusOf(project, items);
  return st === "ok" && affected.some((a) => a.kind === "milestone");
}

export function nextMilestoneOf(items: TimelineItem[]): TimelineItem | undefined {
  return items.filter((i) => i.kind === "milestone" && i.state !== "done").sort((a, b) => a.start.localeCompare(b.start))[0];
}

/* ───────────── วันทำงาน ───────────── */

export function isWorkday(s: string, holidays: Set<string>): boolean {
  const w = new Date(dayNum(s) * 864e5).getUTCDay();
  return w !== 0 && w !== 6 && !holidays.has(s);
}

/* ───────────── แม่แบบ ───────────── */

export function templateEnd(it: Pick<ProjectTemplateItem, "off" | "dur" | "milestone">): number {
  return it.milestone ? it.off : it.off + Math.max(1, it.dur) - 1;
}

export function templateSpan(t: ProjectTemplate): number {
  return t.items.length ? Math.max(...t.items.map(templateEnd)) : 0;
}

/** วันจริงของ "วันที่ off ของโปรเจกต์" — นับเฉพาะวันทำงานถ้าแม่แบบตั้งไว้ */
export function templateDate(t: Pick<ProjectTemplate, "workdays">, start: string, off: number, holidays: Set<string>): string {
  if (!t.workdays) return shiftDays(start, off);
  let d = start;
  while (!isWorkday(d, holidays)) d = shiftDays(d, 1);
  for (let n = 0; n < off; ) { d = shiftDays(d, 1); if (isWorkday(d, holidays)) n++; }
  return d;
}

/** นับถอยหลังจากวันเสร็จ — วันเริ่มที่ทำให้งานสุดท้ายจบตรงวันเสร็จพอดี */
export function templateStartFromEnd(t: ProjectTemplate, end: string, holidays: Set<string>): string {
  const total = templateSpan(t);
  if (!t.workdays) return shiftDays(end, -total);
  let d = end;
  while (!isWorkday(d, holidays)) d = shiftDays(d, -1);
  for (let n = 0; n < total; ) { d = shiftDays(d, -1); if (isWorkday(d, holidays)) n++; }
  return d;
}

export function templateConflict(t: ProjectTemplate, it: ProjectTemplateItem): boolean {
  return it.dependsOn.some((k) => {
    const p = t.items.find((x) => x.key === k);
    return !!p && it.off < templateEnd(p) + (p.milestone ? 0 : 1);
  });
}

/** จัดวันในแม่แบบใหม่ให้ทุกงานเริ่มหลังงานที่ต้องรอเสร็จ */
export function arrangeTemplate(t: ProjectTemplate): ProjectTemplateItem[] {
  const items = t.items.map((i) => ({ ...i }));
  for (let g = 0; g < 100; g++) {
    let ch = false;
    for (const it of items) for (const k of it.dependsOn) {
      const p = items.find((x) => x.key === k);
      if (!p) continue;
      const need = templateEnd(p) + (p.milestone ? 0 : 1);
      if (it.off < need) { it.off = need; ch = true; }
    }
    if (!ch) break;
  }
  return items;
}

/** บันทึกโปรเจกต์เป็นแม่แบบ — วันจริง → "วันที่ n ของโปรเจกต์ + กี่วัน" · คน → ตำแหน่ง */
export function templateFromProject(
  project: Project,
  items: TimelineItem[],
  roleOf: (userId: string) => string,
  ids: () => string,
  actorId: string
): ProjectTemplate {
  const start = items.length ? Math.min(...items.map((i) => dayNum(i.start))) : dayNum(project.startDate);
  const keyOf = new Map<string, string>();
  const secKey = new Map(project.sections.map((s) => [s.id, ids()]));
  for (const i of items) keyOf.set(i.id, ids());
  return {
    id: ids(),
    name: `${project.name} (แม่แบบ)`,
    description: `บันทึกจากโปรเจกต์ ${project.name}`,
    workdays: false,
    anchor: "start",
    sections: project.sections.map((s) => ({ key: secKey.get(s.id)!, name: s.name })),
    items: items.map((i) => ({
      key: keyOf.get(i.id)!,
      sectionKey: secKey.get(i.sectionId) ?? secKey.values().next().value!,
      name: i.name,
      role: i.kind === "milestone" ? "" : roleOf(i.assigneeIds[0] ?? ""),
      off: dayNum(i.start) - start,
      dur: i.kind === "milestone" ? 0 : dayNum(i.end) - dayNum(i.start) + 1,
      milestone: i.kind === "milestone",
      dependsOn: i.deps.map((d) => keyOf.get(d)).filter((x): x is string => !!x),
      description: i.task?.description ?? "",
      checklist: i.task?.checklist.map((c) => c.text) ?? [],
    })),
    usedCount: 0,
    createdBy: actorId,
    updatedAt: new Date().toISOString(),
  };
}
