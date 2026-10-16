import type { Task, TaskRecurrence, TaskRecurrenceRule, TaskRecurrenceTemplate } from "@/modules/report_task/types";

/**
 * งานทำซ้ำ (ติ๊ก "ทำซ้ำ" ตอนสร้างงาน) — ฟังก์ชันล้วน ใช้ทั้งฝั่ง client (ฟอร์ม/หน้ารายละเอียด)
 * และ server (task-penalty-sweep-run.ts สร้างรอบใหม่ทุกครั้งที่ sweep รัน)
 *
 * แต่ละรอบเป็นงานปกติหนึ่งงาน ⇒ เลยกำหนดก็โดนหักคะแนนด้วยกลไกเดิมทุกอย่าง
 * รอบล่าสุดของชุด (occurrence มากสุด) คือตัวที่ถือ rule/template ที่ใช้สร้างรอบถัดไป
 *
 * วันที่ทั้งหมดเป็นสตริง YYYY-MM-DD (วันตามปฏิทิน) คำนวณด้วย UTC ล้วน ไม่ขึ้นกับ timezone เครื่อง
 * dueDate ของงานเก็บเป็น "YYYY-MM-DDT00:00:00.000Z" เหมือนงานที่สร้างจากฟอร์มปกติ
 */

const MAX_SCAN = 5000;

export const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export const TH_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
export const TH_WEEKDAYS_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function ymd(y: number, m: number, d: number): string {
  const t = new Date(Date.UTC(y, m, d));
  return t.toISOString().slice(0, 10);
}
function parts(s: string): [number, number, number] {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number) as [number, number, number];
  return [y, m - 1, d];
}
function weekday(s: string): number {
  const [y, m, d] = parts(s);
  return new Date(Date.UTC(y, m, d)).getUTCDay();
}
export function addDaysYmd(s: string, n: number): string {
  const [y, m, d] = parts(s);
  return ymd(y, m, d + n);
}
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}
function nthWeekdayOf(y: number, m: number, wd: number, n: number): string | null {
  if (n === -1) {
    const last = lastDayOfMonth(y, m);
    const lastWd = new Date(Date.UTC(y, m, last)).getUTCDay();
    return ymd(y, m, last - ((lastWd - wd + 7) % 7));
  }
  const firstWd = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const day = 1 + ((wd - firstWd + 7) % 7) + (n - 1) * 7;
  return day <= lastDayOfMonth(y, m) ? ymd(y, m, day) : null;
}

/** วันกำหนดส่งตามตาราง (ไม่สนวันสิ้นสุด) ทีละวัน เรียงจากเก่าไปใหม่ เริ่มที่ anchor */
function* rawDates(rule: TaskRecurrenceRule): Generator<string> {
  const every = Math.max(1, Math.floor(rule.interval) || 1);
  const anchor = rule.anchor.slice(0, 10);
  const [ay, am] = parts(anchor);
  if (rule.freq === "daily") {
    let d = anchor;
    let i = 0;
    for (let guard = 0; guard < MAX_SCAN * 2; guard++) {
      const wd = weekday(d);
      if (!rule.skipWeekends || (wd !== 0 && wd !== 6)) {
        if (i % every === 0) yield d;
        i++;
      }
      d = addDaysYmd(d, 1);
    }
  } else if (rule.freq === "weekly") {
    const days = [...new Set(rule.weekdays ?? [])].filter((x) => x >= 0 && x <= 6).sort((a, b) => a - b);
    if (days.length === 0) return;
    const weekStart = addDaysYmd(anchor, -weekday(anchor));
    for (let w = 0; w < MAX_SCAN; w += every) {
      for (const wd of days) {
        const d = addDaysYmd(weekStart, w * 7 + wd);
        if (d >= anchor) yield d;
      }
    }
  } else if (rule.freq === "monthly") {
    for (let k = 0; k < MAX_SCAN; k += every) {
      const y = ay + Math.floor((am + k) / 12);
      const m = (am + k) % 12;
      let d: string | null;
      if (rule.monthlyMode === "last") d = ymd(y, m, lastDayOfMonth(y, m));
      else if (rule.monthlyMode === "nth") d = nthWeekdayOf(y, m, rule.nthWeekday ?? 1, rule.nth ?? 1);
      else d = ymd(y, m, Math.min(rule.monthDay ?? 1, lastDayOfMonth(y, m)));
      if (d && d >= anchor) yield d;
    }
  } else {
    const mon = rule.yearMonth ?? 0;
    for (let k = 0; k < MAX_SCAN; k += every) {
      const y = ay + k;
      const d = ymd(y, mon, Math.min(rule.monthDay ?? 1, lastDayOfMonth(y, mon)));
      if (d >= anchor) yield d;
    }
  }
}

function startOf(rule: TaskRecurrenceRule): number {
  return Math.max(1, Math.floor(rule.startOccurrence ?? 1));
}

/**
 * กำหนดส่งที่ตารางนี้สร้างได้ เรียงตามรอบ — ตัวที่ i คือรอบที่ startOccurrence + i
 * (ตารางที่ไม่เคยแก้: ตัวที่ i คือรอบ i + 1) · "ครบ N ครั้ง" นับรวมรอบก่อนแก้ตารางด้วย
 */
export function occurrenceDates(rule: TaskRecurrenceRule, limit: number): string[] {
  const out: string[] = [];
  const remaining = rule.end.mode === "count" ? rule.end.count - (startOf(rule) - 1) : Infinity;
  for (const d of rawDates(rule)) {
    if (out.length >= limit || out.length >= remaining) break;
    if (rule.end.mode === "date" && d > rule.end.until.slice(0, 10)) break;
    out.push(d);
  }
  return out;
}

/** กำหนดส่งของรอบที่ n (เริ่ม 1) — null = ไม่มีรอบนั้นแล้ว (เลยวันสิ้นสุด/ครบจำนวน/ก่อนแก้ตาราง)
 * รอบที่กดแก้วันไว้ (dateOverrides) ใช้วันที่แก้ ที่เหลือเป็นไปตามตารางปกติ */
export function occurrenceDate(rule: TaskRecurrenceRule, n: number): string | null {
  const i = n - startOf(rule);
  if (i < 0) return null;
  const scheduled = occurrenceDates(rule, i + 1)[i] ?? null;
  return scheduled ? (rule.dateOverrides?.[String(n)] ?? scheduled) : null;
}

/** วันตามตารางปกติของรอบ n (ไม่สนการแก้วันรายรอบ) — ใช้บอกว่ารอบนี้ถูกเลื่อนจากวันไหน */
export function scheduledDate(rule: TaskRecurrenceRule, n: number): string | null {
  return occurrenceDate({ ...rule, dateOverrides: undefined }, n);
}

/** แก้วันของรอบ n ได้ช่วงไหน — ต้องหลังรอบก่อนหน้าและก่อนรอบถัดไป (กันรอบสลับกัน) */
export function roundDateBounds(rule: TaskRecurrenceRule, n: number, prevDue: string | null): { min: string; max: string | null } {
  const next = occurrenceDate(rule, n + 1);
  return { min: prevDue ? addDaysYmd(prevDue.slice(0, 10), 1) : rule.anchor, max: next ? addDaysYmd(next, -1) : null };
}

/** จำนวนรอบทั้งหมด (รวมรอบก่อนแก้ตาราง) — null = ไม่มีวันสิ้นสุด */
export function totalOccurrences(rule: TaskRecurrenceRule): number | null {
  if (rule.end.mode === "never") return null;
  return startOf(rule) - 1 + occurrenceDates(rule, MAX_SCAN).length;
}

/**
 * "แก้การทำซ้ำ" กลางทาง — ตารางใหม่เริ่มนับวันถัดจากกำหนดส่งรอบล่าสุด และวันแรกที่ได้คือรอบถัดไป
 * เดิม (ไม่ย้าย anchor) เปลี่ยนวันที่ 16 → 10 แล้วรอบถัดไปกระโดดข้ามไปหนึ่งเดือน เพราะนับใหม่จากวันเริ่มเดิม
 */
export function reanchorRule(rule: TaskRecurrenceRule, latestDue: string, latestOccurrence: number): TaskRecurrenceRule {
  // เริ่มตารางใหม่ที่ "รอบเวลาถัดไป" ของรอบล่าสุด — รายเดือน: เดือนหน้า · รายสัปดาห์: สัปดาห์หน้า · รายปี: ปีหน้า
  // (เปลี่ยนวันที่ 16 → 25 หลังรอบ 16 พ.ย. ⇒ รอบถัดไป 25 ธ.ค. ไม่ใช่ 25 พ.ย. ซ้อนเดือนเดียวกัน)
  const [y, m] = parts(latestDue);
  const due = latestDue.slice(0, 10);
  const anchor =
    rule.freq === "monthly"
      ? ymd(y, m + 1, 1)
      : rule.freq === "yearly"
        ? ymd(y + 1, 0, 1)
        : rule.freq === "weekly"
          ? addDaysYmd(due, 7 - weekday(due))
          : addDaysYmd(due, 1);
  // วันที่แก้รายรอบผูกกับตารางเดิม — เปลี่ยนตารางแล้วล้างทิ้ง กลับเป็นวันมาตรฐานของตารางใหม่
  return { ...rule, anchor, startOccurrence: latestOccurrence + 1, dateOverrides: undefined };
}

/** ตั้งค่าครบพอจะคำนวณได้ไหม — คืนข้อความผิดพลาด (ภาษาไทย) หรือ null */
export function validateRule(rule: TaskRecurrenceRule): string | null {
  if (rule.freq === "weekly" && !(rule.weekdays ?? []).length) return "เลือกวันในสัปดาห์อย่างน้อย 1 วัน";
  if (rule.end.mode === "count" && !(rule.end.count >= 1)) return "จำนวนครั้งต้องอย่างน้อย 1";
  if (rule.end.mode === "date" && rule.end.until.slice(0, 10) < rule.anchor.slice(0, 10)) return "วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น";
  if (!occurrenceDate(rule, startOf(rule))) return "ไม่มีรอบไหนอยู่ในช่วงที่ตั้งไว้";
  return null;
}

export function formatThaiDate(s: string, withYear = true): string {
  const [y, m, d] = parts(s);
  return `${d} ${TH_MONTHS[m]}${withYear ? ` ${y + 543}` : ""}`;
}

/** "ทุกเดือน วันที่ 25" — สรุปสั้นของตาราง */
export function describeRule(rule: TaskRecurrenceRule): string {
  const n = Math.max(1, Math.floor(rule.interval) || 1);
  if (rule.freq === "daily") return (n === 1 ? "ทุกวัน" : `ทุก ${n} วัน`) + (rule.skipWeekends ? " (เว้นเสาร์-อาทิตย์)" : "");
  if (rule.freq === "weekly") {
    const days = [...(rule.weekdays ?? [])].sort((a, b) => a - b).map((d) => TH_WEEKDAYS_SHORT[d]).join(", ");
    return `${n === 1 ? "ทุกสัปดาห์" : `ทุก ${n} สัปดาห์`} วัน${days || "—"}`;
  }
  if (rule.freq === "monthly") {
    const base = n === 1 ? "ทุกเดือน" : `ทุก ${n} เดือน`;
    if (rule.monthlyMode === "last") return `${base} วันสุดท้ายของเดือน`;
    if (rule.monthlyMode === "nth") {
      const which = rule.nth === -1 ? "สุดท้าย" : rule.nth === 1 ? "แรก" : `ที่ ${rule.nth}`;
      return `${base} วัน${TH_WEEKDAYS[rule.nthWeekday ?? 1]}${which}`;
    }
    return `${base} วันที่ ${rule.monthDay ?? 1}`;
  }
  return `${n === 1 ? "ทุกปี" : `ทุก ${n} ปี`} วันที่ ${rule.monthDay ?? 1} ${TH_MONTHS[rule.yearMonth ?? 0]}`;
}

/** "รายเดือน" — ป้ายสั้นบนการ์ด */
export function freqLabel(rule: TaskRecurrenceRule): string {
  return { daily: "รายวัน", weekly: "รายสัปดาห์", monthly: "รายเดือน", yearly: "รายปี" }[rule.freq];
}

export function describeEnd(rule: TaskRecurrenceRule): string {
  if (rule.end.mode === "never") return "ไม่มีวันสิ้นสุด";
  const total = totalOccurrences(rule) ?? 0;
  const last = total > 0 ? occurrenceDate(rule, total) : null;
  return `ครบ ${total} ครั้ง${last ? ` (ถึง ${formatThaiDate(last)})` : ""}`;
}

/** ก๊อปข้อมูลของงานรอบนี้ไปเป็นต้นแบบของรอบถัดไป */
export function templateFromTask(task: Task): TaskRecurrenceTemplate {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    taskMode: task.taskMode,
    assigneeIds: [...task.assigneeIds],
    ...(task.mainAssigneeId ? { mainAssigneeId: task.mainAssigneeId } : {}),
    ...(task.completionRule ? { completionRule: task.completionRule } : {}),
    assignedById: task.assignedById,
    departmentIds: [...task.departmentIds],
    ...(task.dueTime ? { dueTime: task.dueTime } : {}),
    checklist: task.checklist.map((c) => ({ text: c.text, ownerId: c.ownerId ?? task.assigneeIds[0] ?? "" })),
    // เฉพาะไฟล์ตั้งต้นที่ผู้สั่งงานแนบ — ไฟล์ส่งงานของแต่ละรอบไม่ก๊อป
    attachments: task.attachments.filter((a) => a.role !== "submission"),
    ...(task.projectTopicId ? { projectTopicId: task.projectTopicId } : {}),
    showChecklistOnCard: task.showChecklistOnCard,
  };
}

/** งานทุกรอบของชุดเดียวกัน เรียงตามรอบ */
export function seriesTasks(tasks: Task[], seriesId: string): Task[] {
  return tasks
    .filter((t) => t.recurrence?.seriesId === seriesId)
    .sort((a, b) => a.recurrence!.occurrence - b.recurrence!.occurrence);
}

/** รอบล่าสุดของชุด — ตัวที่ถือตั้งค่าที่ใช้สร้างรอบถัดไป */
export function latestOfSeries(tasks: Task[], seriesId: string): Task | undefined {
  const all = seriesTasks(tasks, seriesId);
  return all[all.length - 1];
}

/**
 * สร้างงานรอบที่ n จากรอบล่าสุดของชุด — งานใหม่ทั้งก้อน (ไม่มีคอมเมนต์/คะแนน/สถานะของรอบก่อน)
 * activeUserIds: ส่งมา = กรองผู้รับผิดชอบที่ลาออก/ถูกปิดบัญชีออก
 */
export function buildRoundTask(
  from: Task,
  n: number,
  due: string,
  ids: { taskId: string; checklistId: () => string },
  nowIso: string,
  activeUserIds?: Set<string>
): Task {
  const rec = from.recurrence!;
  // ก๊อปจากรอบล่าสุดเสมอ — แก้ชื่อ/ผู้รับผิดชอบ/เช็คลิสต์ไว้ที่รอบไหน รอบต่อไปก็ใช้ตาม
  const t = templateFromTask(from);
  const assigneeIds = activeUserIds ? t.assigneeIds.filter((id) => activeUserIds.has(id)) : [...t.assigneeIds];
  const lead = Math.max(0, rec.rule.leadDays || 0);
  const today = nowIso.slice(0, 10);
  const start = addDaysYmd(due, -lead);
  const dueIso = `${due}T00:00:00.000Z`;
  return {
    id: ids.taskId,
    title: t.title,
    description: t.description,
    status: "todo",
    priority: t.priority,
    taskMode: t.taskMode,
    assigneeIds,
    ...(t.taskMode === "group" && t.mainAssigneeId && assigneeIds.includes(t.mainAssigneeId) ? { mainAssigneeId: t.mainAssigneeId } : {}),
    ...(t.completionRule ? { completionRule: t.completionRule } : {}),
    assignedById: t.assignedById,
    departmentIds: [...t.departmentIds],
    startDate: `${start < today ? today : start}T00:00:00.000Z`,
    dueDate: dueIso,
    originalDueDate: dueIso,
    ...(t.dueTime ? { dueTime: t.dueTime } : {}),
    attachments: t.attachments.map((a) => ({ ...a })),
    comments: [],
    revisions: [],
    reactions: [],
    checklist: t.checklist
      .filter((c) => !activeUserIds || !c.ownerId || assigneeIds.includes(c.ownerId))
      .map((c) => ({ id: ids.checklistId(), text: c.text, done: false, ownerId: c.ownerId || assigneeIds[0] })),
    completedAssigneeIds: [],
    showChecklistOnCard: t.showChecklistOnCard,
    ...(t.projectTopicId ? { projectTopicId: t.projectTopicId } : {}),
    recurrence: { ...rec, occurrence: n, rule: { ...rec.rule }, template: { ...t } },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export interface SpawnedRound {
  task: Task;
  /** ผู้รับผิดชอบถูกกรองออกหมด (ลาออก) — ต้องแจ้งคนสั่งงานแทน */
  noAssignees: boolean;
}

/**
 * หารอบที่ถึงเวลาขึ้นบอร์ดแล้ว (วันนี้ ≥ กำหนดส่ง − leadDays) แต่ยังไม่ได้สร้าง — ชุดละไม่เกิน 1 รอบต่อครั้ง
 * รอบที่กำหนดส่งผ่านไปแล้ว (เช่น ระบบปิดไปนาน) ไม่สร้างย้อนหลัง ข้ามไปรอบแรกที่ยังไม่เลยกำหนด
 * ⇒ ไม่มีใครโดนหักคะแนนเพราะงานที่ไม่เคยขึ้นบอร์ด
 */
export function spawnDueRounds(
  tasks: Task[],
  today: string,
  makeIds: () => { taskId: string; checklistId: () => string },
  nowIso: string,
  activeUserIds?: Set<string>
): SpawnedRound[] {
  const latestBySeries = new Map<string, Task>();
  for (const t of tasks) {
    const r = t.recurrence;
    if (!r) continue;
    const cur = latestBySeries.get(r.seriesId);
    if (!cur || r.occurrence > cur.recurrence!.occurrence) latestBySeries.set(r.seriesId, t);
  }
  const out: SpawnedRound[] = [];
  for (const latest of latestBySeries.values()) {
    const rec = latest.recurrence!;
    if (rec.stopped) continue;
    // ตัวที่ i ของ dates = รอบ start + i (ดู occurrenceDates)
    const start = startOf(rec.rule);
    const dates = occurrenceDates(rec.rule, MAX_SCAN);
    const dueOf = (k: number) => (k - start < dates.length ? (rec.rule.dateOverrides?.[String(k)] ?? dates[k - start]) : undefined);
    let n = Math.max(rec.occurrence + 1, start);
    while (dueOf(n) !== undefined && dueOf(n)! < today) n++;
    const due = dueOf(n);
    if (!due) continue;
    if (today < addDaysYmd(due, -Math.max(0, rec.rule.leadDays || 0))) continue;
    const task = buildRoundTask(latest, n, due, makeIds(), nowIso, activeUserIds);
    out.push({ task, noAssignees: task.assigneeIds.length === 0 });
  }
  return out;
}

/** "วันนี้" ตามเวลาไทย (YYYY-MM-DD) — เซิร์ฟเวอร์รันใน UTC */
export function bangkokToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
}

/** ข้าม/หยุดทำซ้ำได้ไหม — คนที่ได้รับงานกดเองไม่ได้ (กันกดข้ามรอบที่ตัวเองไม่ทันส่ง) */
export function canManageSeries(task: Task, viewerId: string, isOwner: boolean, isLeadOfTask: boolean): boolean {
  if (!task.recurrence) return false;
  if (isOwner) return true;
  const assigned = task.assigneeIds.includes(viewerId);
  // งานที่สั่งตัวเองคนเดียว (งานส่วนตัว) — จัดการเองได้
  if (assigned && task.assigneeIds.length === 1 && task.recurrence.template.assignedById === viewerId) return true;
  if (assigned) return false;
  return task.recurrence.template.assignedById === viewerId || isLeadOfTask;
}

export type { TaskRecurrence, TaskRecurrenceRule, TaskRecurrenceTemplate };
