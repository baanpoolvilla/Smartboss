import "server-only";
import { prisma } from "@smartboss/database";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { withSalaryTenant } from "@/modules/salary/lib/db";
import { withDailyWorkerTenant } from "@/modules/daily_worker/lib/db";
import { listScoreRequests } from "@/lib/score-request-store";
import { CHANGE_CATEGORIES, describeWorkforce, diffDetails, type ChangeCategory, type ChangeDetail } from "./change-log-text";

/**
 * Log การบันทึกระบบบุคคล — ใครทำอะไร เมื่อไร กับข้อมูลของใคร เปลี่ยนจากอะไรเป็นอะไร (ผู้ใช้ 27/11/2569)
 *
 * รวมจากทุกที่ที่ระบบบุคคลเก็บประวัติไว้ (แต่ละที่เก็บแยกกันมาแต่แรก แก้หรือลบไม่ได้):
 *   - workforce.audit_events   ลงเวลา/ลา/OT/พนักงาน/กะ/วันหยุด/ตั้งค่าประเภทลา/เครื่องสแกน (มี before/after)
 *   - salary.events            เงินเดือน รอบเงินเดือน ฐานค่าจ้าง ค่าคอม เงินสะสม ตั้งค่าเงินเดือน
 *   - requests.events          เบิกจ่าย / OT / เงินสดย่อย
 *   - daily_worker.audit_events คนงานรายวัน
 *   - core.audit_logs          เปิดดูสลิป/ข้อมูลเงินเดือน ดาวน์โหลด ตั้งค่าคะแนน
 * อ่านอย่างเดียว ไม่แตะข้อมูลต้นทาง
 */

export interface ChangeEntry {
  id: string;
  at: string;
  actor: string;
  category: ChangeCategory;
  text: string;
  /** พนักงานที่ข้อมูลถูกแก้ — ไม่มี = ทั้งบริษัท/ตั้งค่า */
  target: { id: string; name: string; code: string } | null;
  details: ChangeDetail[];
  reason: string | null;
  device: string | null;
}

export interface ChangeLogQuery {
  from: Date;
  to: Date;
  includeCheckins: boolean;
}

/** ต่อแหล่งต่อครั้ง — กันหน้าโหลดนานถ้าช่วงวันที่กว้างมาก */
const PER_SOURCE = 1500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** resource ของ workforce → ตารางที่มี employment_id (ดูว่าเป็นข้อมูลของใคร) */
const RESOURCE_TABLES: Record<string, string> = {
  attendance_exception: "attendance_exceptions",
  attendance_policy_group_member: "attendance_policy_group_members",
  biometric_enrollment: "biometric_enrollments",
  compensation_rate: "compensation_rates",
  employment_assignment: "employment_assignments",
  leave_balance_ledger: "leave_balance_ledger",
  leave_request: "leave_requests",
  mobile_device_registration: "mobile_device_registrations",
  mobile_risk_assessment: "mobile_risk_assessments",
  overtime_request: "overtime_requests",
  photo_checkin_session: "photo_checkin_sessions",
  raw_time_event: "raw_time_events",
  time_event_adjustment: "time_event_adjustments",
};

function targetSql(): string {
  const cases = Object.entries(RESOURCE_TABLES)
    .map(([type, table]) => `WHEN '${type}' THEN (SELECT x.employment_id FROM workforce.${table} x WHERE x.id = a.resource_id LIMIT 1)`)
    .join("\n          ");
  const fromJson = (side: "after" | "before") =>
    `CASE WHEN a.${side}->>'employment_id' ~* '^[0-9a-f-]{36}$' THEN (a.${side}->>'employment_id')::uuid END`;
  return `COALESCE(
        CASE a.resource_type
          WHEN 'employment' THEN a.resource_id
          WHEN 'person' THEN (SELECT e2.id FROM workforce.employments e2 WHERE e2.person_id = a.resource_id ORDER BY e2.hired_on DESC LIMIT 1)
          ${cases}
        END,
        ${fromJson("after")},
        ${fromJson("before")}
      )`;
}

interface WfRow {
  id: string;
  occurred_at: Date;
  actor_type: string;
  actor_display: string;
  action: string;
  resource_type: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  user_agent: string | null;
  employment_id: string | null;
  first_name: string | null;
  last_name: string | null;
  employee_code: string | null;
  leave_type_name: string | null;
}

async function loadWorkforce(orgId: string, q: ChangeLogQuery): Promise<ChangeEntry[]> {
  const rows = await withWorkforceTenant(orgId, (wtx) =>
    wtx.$queryRawUnsafe<WfRow[]>(
      `SELECT a.id::text AS id, a.occurred_at, a.actor_type, a.actor_display, a.action, a.resource_type, a.reason,
              a.before, a.after, a.metadata, a.user_agent,
              t.employment_id::text AS employment_id, pe.first_name, pe.last_name, e.employee_code,
              lt.name AS leave_type_name
         FROM workforce.audit_events a
         LEFT JOIN LATERAL (SELECT ${targetSql()} AS employment_id) t ON true
         LEFT JOIN workforce.employments e ON e.id = t.employment_id
         LEFT JOIN workforce.people pe ON pe.id = e.person_id
         LEFT JOIN workforce.leave_types lt ON lt.id = COALESCE(
              CASE WHEN a.resource_type = 'leave_type' THEN a.resource_id END,
              CASE WHEN a.resource_type = 'leave_request' THEN (SELECT r.leave_type_id FROM workforce.leave_requests r WHERE r.id = a.resource_id) END,
              CASE WHEN a.resource_type = 'leave_balance_ledger' THEN (SELECT l.leave_type_id FROM workforce.leave_balance_ledger l WHERE l.id = a.resource_id) END,
              CASE WHEN a.after->>'leave_type_id' ~* '^[0-9a-f-]{36}$' THEN (a.after->>'leave_type_id')::uuid END)
        WHERE a.occurred_at >= $1 AND a.occurred_at < $2 AND a.outcome = 'SUCCESS'
          ${q.includeCheckins ? "" : "AND a.action NOT IN ('attendance.photo-checkin.commit')"}
        ORDER BY a.occurred_at DESC
        LIMIT ${PER_SOURCE}`,
      q.from,
      q.to,
    ),
  );
  return rows.map((r) => {
    const d = describeWorkforce(r.action, r.before ?? null, r.after ?? null, r.metadata ?? {}, { leaveType: r.leave_type_name });
    const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
    return {
      id: `wf:${r.id}`,
      at: r.occurred_at.toISOString(),
      actor: r.actor_type === "SYSTEM" ? "ระบบ" : r.actor_type === "DEVICE" ? "เครื่องสแกน" : r.actor_display || "—",
      category: d.category,
      text: d.text,
      target: r.employment_id && name ? { id: r.employment_id, name, code: r.employee_code ?? "" } : null,
      details: d.details,
      reason: r.reason,
      device: deviceLabel(r.user_agent),
    };
  });
}

function deviceLabel(ua: string | null): string | null {
  if (!ua) return null;
  const os = /iPhone|iPad/i.test(ua) ? "iPhone" : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : null;
  const app = /Line\//i.test(ua) ? "LINE" : /Edg\//i.test(ua) ? "Edge" : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : null;
  return [os, app].filter(Boolean).join(" · ") || null;
}

/** ชื่อพนักงานจาก employment id (เงินเดือน/คนงานรายวันเก็บแค่ id) */
async function employmentNames(orgId: string, ids: string[]): Promise<Map<string, { name: string; code: string }>> {
  const uniq = [...new Set(ids.filter((x) => UUID_RE.test(x)))];
  if (uniq.length === 0) return new Map();
  const rows = await withWorkforceTenant(orgId, (wtx) =>
    wtx.$queryRawUnsafe<{ id: string; first_name: string; last_name: string; employee_code: string }[]>(
      `SELECT e.id::text AS id, pe.first_name, pe.last_name, e.employee_code
         FROM workforce.employments e JOIN workforce.people pe ON pe.id = e.person_id WHERE e.id = ANY($1::uuid[])`,
      uniq,
    ),
  ).catch(() => []);
  return new Map(rows.map((r) => [r.id, { name: `${r.first_name} ${r.last_name}`.trim(), code: r.employee_code }]));
}

function detailObj(detail: unknown): Record<string, unknown> {
  return detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : {};
}

const SALARY_CATEGORY: Record<string, ChangeCategory> = {
  settings: "settings",
  commission: "commission",
  access: "view",
  export: "view",
};

async function loadSalaryAndRequests(orgId: string, q: ChangeLogQuery): Promise<{ entries: ChangeEntry[]; empIds: string[] }> {
  const { salary, requests } = await withSalaryTenant(orgId, async (tx) => ({
    salary: await tx.salaryEvent.findMany({
      where: { orgId, at: { gte: q.from, lt: q.to } },
      orderBy: { at: "desc" },
      take: PER_SOURCE,
      select: { id: true, at: true, byName: true, action: true, summary: true, detail: true },
    }),
    requests: await tx.moneyRequestEvent.findMany({
      where: { orgId, at: { gte: q.from, lt: q.to } },
      orderBy: { at: "desc" },
      take: PER_SOURCE,
      select: { id: true, at: true, byName: true, action: true, summary: true, detail: true, requestId: true },
    }),
  }));
  // คำขอเงิน → ใบ (เลขที่ · ประเภท · ผู้ได้เงิน) เพื่อขึ้นชื่อพนักงานในช่อง "ข้อมูลของ"
  const reqIds = [...new Set(requests.map((e) => e.requestId).filter((x): x is string => !!x))];
  const reqRows = reqIds.length
    ? await withSalaryTenant(orgId, (tx) => tx.moneyRequest.findMany({ where: { orgId, id: { in: reqIds } }, select: { id: true, code: true, kind: true, employmentId: true, beneficiaryUserId: true } }))
    : [];
  const reqById = new Map(reqRows.map((r) => [r.id, r] as const));
  const benIds = [...new Set(reqRows.map((r) => r.beneficiaryUserId).filter((x): x is string => !!x))];
  const benNames = new Map(benIds.length ? (await prisma.user.findMany({ where: { orgId, id: { in: benIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name] as const) : []);
  const empIds: string[] = [];
  const entries: ChangeEntry[] = [];
  for (const e of salary) {
    const d = detailObj(e.detail);
    const emp = typeof d.employmentId === "string" ? d.employmentId : null;
    if (emp) empIds.push(emp);
    entries.push({
      // แก้ฐานเงินเดือน (rate-save.ts) — ใช้จับคู่ตัดแถวซ้ำกับ compensation.rate.* ของระบบบุคคล
      id: `${typeof d.kind === "string" && d.kind.startsWith("rate_") ? "salrate" : "sal"}:${e.id}`,
      at: e.at.toISOString(),
      actor: e.byName,
      category: SALARY_CATEGORY[e.action] ?? "pay",
      text: e.summary,
      target: emp ? { id: emp, name: "", code: "" } : null,
      details: changeList(d),
      reason: typeof d.reason === "string" ? d.reason : null,
      device: null,
    });
  }
  for (const e of requests) {
    const d = detailObj(e.detail);
    const req = e.requestId ? reqById.get(e.requestId) : undefined;
    const isOt = req ? req.kind === "ot" : /(^|\s)OT(\s|$)|โอที/i.test(e.summary) || d.kind === "ot";
    if (req?.employmentId) empIds.push(req.employmentId);
    const benName = req?.beneficiaryUserId ? benNames.get(req.beneficiaryUserId) : undefined;
    entries.push({
      id: `req:${e.id}`,
      at: e.at.toISOString(),
      actor: e.byName,
      category: e.action === "settings" ? "settings" : isOt ? "ot" : "money",
      text: req && !e.summary.includes(req.code) ? `${req.code} · ${e.summary}` : e.summary,
      target: req?.employmentId ? { id: req.employmentId, name: benName ?? "", code: "" } : benName ? { id: `user:${req!.beneficiaryUserId}`, name: benName, code: "" } : null,
      details: changeList(d),
      reason: typeof d.reason === "string" ? d.reason : null,
      device: null,
    });
  }
  return { entries, empIds };
}

/** detail.before / detail.after (หรือ detail.changes) ที่บางจุดเก็บไว้ → แถวเดิม→ใหม่ */
function changeList(d: Record<string, unknown>): ChangeDetail[] {
  const changes = d.changes;
  if (Array.isArray(changes)) {
    return changes
      .map((c) => detailObj(c))
      .filter((c) => typeof c.label === "string")
      .map((c) => ({ label: String(c.label), before: c.before == null ? null : String(c.before), after: c.after == null ? null : String(c.after) }));
  }
  if (d.before === undefined && d.after === undefined) return [];
  // payBasis → pay_basis ให้ใช้ชื่อช่อง/ค่าภาษาไทยชุดเดียวกับ workforce
  const snake = (o: unknown) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v])) : null);
  return diffDetails(snake(d.before), snake(d.after));
}

async function loadDailyWorker(orgId: string, q: ChangeLogQuery): Promise<{ entries: ChangeEntry[]; empIds: string[] }> {
  const rows = await withDailyWorkerTenant(orgId, (tx) =>
    tx.dailyWorkerAuditEvent.findMany({
      where: { orgId, at: { gte: q.from, lt: q.to } },
      orderBy: { at: "desc" },
      take: PER_SOURCE,
      select: { id: true, at: true, byName: true, action: true, summary: true, detail: true, employmentIds: true },
    }),
  );
  const empIds: string[] = [];
  const entries = rows.map((e): ChangeEntry => {
    const one = e.employmentIds.length === 1 ? e.employmentIds[0]! : null;
    if (one) empIds.push(one);
    const d = detailObj(e.detail);
    return {
      id: `dw:${e.id}`,
      at: e.at.toISOString(),
      actor: e.byName,
      category: e.action === "settings" ? "settings" : "worker",
      text: e.summary,
      target: one ? { id: one, name: "", code: "" } : null,
      details: changeList(d),
      reason: typeof d.reason === "string" ? d.reason : null,
      device: null,
    };
  });
  return { entries, empIds };
}

const CORE_ACTIONS: Record<string, { category: ChangeCategory; text: string }> = {
  PAYSLIP_VIEWED: { category: "view", text: "เปิดดูสลิปเงินเดือน" },
  SALARY_PROFILE_VIEWED: { category: "view", text: "เปิดดูข้อมูลเงินเดือน" },
  SALARY_EXPORTED: { category: "view", text: "ดาวน์โหลดข้อมูลเงินเดือน" },
  HR_LOG_EXPORTED: { category: "view", text: "ดาวน์โหลด Log การบันทึกระบบบุคคล" },
  SALARY_ACCESS_BLOCKED_IP: { category: "view", text: "ถูกกันไม่ให้เข้าหน้าเงินเดือน (เข้าจากนอกเครือข่ายที่อนุญาต)" },
  PERFORMANCE_SETTINGS_UPDATED: { category: "settings", text: "แก้ตั้งค่าคะแนนผลงาน" },
  SCORE_PERIOD_UPDATED: { category: "settings", text: "แก้รอบคะแนน" },
};

/** วันหยุดรายเดือน: -1 = กลับไปใช้จำนวนของประเภท (lib/day-off-quota.ts RESET_TO_TYPE) */
function quotaText(v: unknown): string | null {
  if (typeof v !== "number") return null;
  return v < 0 ? "ตามค่าของประเภท" : `${v} วัน`;
}

async function loadCore(orgId: string, q: ChangeLogQuery): Promise<{ entries: ChangeEntry[]; empIds: string[] }> {
  const users = await prisma.user.findMany({ where: { orgId }, select: { id: true, name: true } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const logs = await prisma.auditLog.findMany({
    where: {
      userId: { in: users.map((u) => u.id) },
      action: { in: [...Object.keys(CORE_ACTIONS), "DAY_OFF_QUOTA_UPDATED", "USER_DISABLED", "USER_UPDATED"] },
      createdAt: { gte: q.from, lt: q.to },
    },
    orderBy: { createdAt: "desc" },
    take: PER_SOURCE,
    select: { id: true, userId: true, action: true, targetId: true, userAgent: true, detail: true, createdAt: true },
  });
  // ชื่อประเภทวันหยุดของวันหยุดรายเดือน
  const typeIds = [...new Set(logs.filter((l) => l.action === "DAY_OFF_QUOTA_UPDATED").map((l) => detailObj(l.detail).leaveTypeId).filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))];
  const typeNames = new Map(
    typeIds.length === 0
      ? []
      : (
          await withWorkforceTenant(orgId, (wtx) => wtx.$queryRawUnsafe<{ id: string; name: string }[]>(`SELECT id::text AS id, name FROM workforce.leave_types WHERE id = ANY($1::uuid[])`, typeIds)).catch(() => [])
        ).map((r) => [r.id, r.name] as const),
  );
  const empIds: string[] = [];
  const entries: ChangeEntry[] = [];
  for (const l of logs) {
    const d = detailObj(l.detail);
    const emp = typeof d.employmentId === "string" ? d.employmentId : null;
    const base = { id: `core:${l.id}`, at: l.createdAt.toISOString(), actor: l.userId ? (nameById.get(l.userId) ?? "—") : "ระบบ", reason: null, device: deviceLabel(l.userAgent) };
    if (l.action === "DAY_OFF_QUOTA_UPDATED") {
      if (emp) empIds.push(emp);
      const type = typeof d.leaveTypeId === "string" ? typeNames.get(d.leaveTypeId) : undefined;
      const month = typeof d.month === "string" ? d.month : "";
      entries.push({
        ...base,
        category: "leave",
        text: d.kind === "standing_cleared" ? "ล้างวันหยุดประจำรายคน (กลับไปใช้ค่าของประเภท)" : `ตั้งวันหยุดรายเดือน${type ? ` "${type}"` : ""} ตั้งแต่เดือน ${month}`,
        target: emp ? { id: emp, name: "", code: "" } : null,
        details: d.kind === "month" ? [{ label: "วันต่อเดือน", before: quotaText(d.before) ?? "ตามค่าของประเภท", after: quotaText(d.after) ?? "ตามค่าของประเภท" }] : [],
        reason: typeof d.note === "string" && d.note ? d.note : null,
      });
      continue;
    }
    if (l.action === "USER_DISABLED" || l.action === "USER_UPDATED") {
      // เฉพาะที่มาจากระบบบุคคล (พนักงานพ้นสภาพ) — การแก้บัญชีผู้ใช้อื่น ๆ อยู่ที่หลังบ้าน
      const fromHr = d.reason === "employment_terminated" || typeof d.scheduledDisableAfter === "string";
      if (!fromHr) continue;
      if (emp) empIds.push(emp);
      const who = l.targetId ? (nameById.get(l.targetId) ?? null) : null;
      entries.push({
        ...base,
        category: "people",
        text:
          l.action === "USER_DISABLED"
            ? "ปิดบัญชีเข้าระบบของพนักงานที่พ้นสภาพ"
            : `ตั้งปิดบัญชีเข้าระบบอัตโนมัติหลังวันที่ ${typeof d.scheduledDisableAfter === "string" ? d.scheduledDisableAfter : ""}`.trim(),
        target: emp ? { id: emp, name: who ?? "", code: "" } : who ? { id: `user:${l.targetId}`, name: who, code: "" } : null,
        details: [],
      });
      continue;
    }
    const meta = CORE_ACTIONS[l.action];
    if (!meta) continue;
    const who = typeof d.name === "string" ? d.name : l.targetId ? (nameById.get(l.targetId) ?? null) : null;
    entries.push({
      ...base,
      category: meta.category,
      text: meta.text,
      target: who ? { id: emp ?? `user:${l.targetId ?? who}`, name: who, code: "" } : null,
      details: [],
    });
  }
  return { entries, empIds };
}

/** คำร้องขอแก้คะแนน (เก็บเป็น JSON ใน report_task store) — ยื่น + ตัดสิน */
async function loadScoreRequests(orgId: string, q: ChangeLogQuery): Promise<ChangeEntry[]> {
  const items = await listScoreRequests(orgId);
  const ids = [...new Set(items.flatMap((r) => [r.userId, r.submittedBy, r.decidedBy].filter((x): x is string => !!x)))];
  const names = new Map((await prisma.user.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const inRange = (iso: string | undefined) => !!iso && iso >= q.from.toISOString() && iso < q.to.toISOString();
  const out: ChangeEntry[] = [];
  for (const r of items) {
    const target = { id: `user:${r.userId}`, name: names.get(r.userId) ?? "—", code: "" };
    const what = `${r.title}${r.target.code ? ` (${r.target.code})` : ""} · ${r.points} คะแนน`;
    if (inRange(r.createdAt)) {
      out.push({ id: `score:${r.id}:c`, at: r.createdAt, actor: names.get(r.submittedBy) ?? "—", category: "commission", text: `ยื่นขอแก้คะแนน: ${what}`, target, details: [], reason: [r.reasonTag, r.reason].filter(Boolean).join(" · ") || null, device: null });
    }
    if (r.decidedAt && inRange(r.decidedAt) && (r.status === "approved" || r.status === "rejected")) {
      out.push({
        id: `score:${r.id}:d`,
        at: r.decidedAt,
        actor: r.decidedBy ? (names.get(r.decidedBy) ?? "—") : "ระบบ",
        category: "commission",
        text: `${r.status === "approved" ? "อนุมัติคืนคะแนน" : "ไม่อนุมัติคำขอแก้คะแนน"}: ${what}`,
        target,
        details: [],
        reason: r.decisionNote ?? null,
        device: null,
      });
    }
  }
  return out;
}

/** ทุกแหล่งรวมกัน ใหม่ก่อนเก่า · แหล่งไหนอ่านไม่ได้ ข้ามไปพร้อมบอก (ไม่ให้ทั้งหน้าล่ม) */
export async function loadChangeLog(orgId: string, q: ChangeLogQuery): Promise<{ entries: ChangeEntry[]; failed: string[] }> {
  const failed: string[] = [];
  const guard = async <T>(label: string, p: Promise<T>, empty: T): Promise<T> => {
    try {
      return await p;
    } catch (error) {
      console.error(`[hr-change-log] ${label}`, error);
      failed.push(label);
      return empty;
    }
  };
  const [wf, sal, dw, core, score] = await Promise.all([
    guard("ลงเวลา/ลา/พนักงาน", loadWorkforce(orgId, q), [] as ChangeEntry[]),
    guard("เงินเดือน/เบิกจ่าย", loadSalaryAndRequests(orgId, q), { entries: [], empIds: [] }),
    guard("คนงานรายวัน", loadDailyWorker(orgId, q), { entries: [], empIds: [] }),
    guard("การเปิดดูข้อมูล/วันหยุดรายเดือน", loadCore(orgId, q), { entries: [], empIds: [] }),
    guard("คำร้องขอแก้คะแนน", loadScoreRequests(orgId, q), [] as ChangeEntry[]),
  ]);
  const names = await employmentNames(orgId, [...sal.empIds, ...dw.empIds, ...core.empIds]);
  const fill = (e: ChangeEntry): ChangeEntry => {
    if (!e.target || e.target.name) return e;
    const n = names.get(e.target.id);
    return n ? { ...e, target: { id: e.target.id, ...n } } : { ...e, target: null };
  };
  // แก้เงินเดือนจากหน้าเงินเดือน เก็บทั้งที่ระบบบุคคล (compensation.rate.*) และ salary.events (มีเดิม→ใหม่ชัดกว่า)
  // ⇒ เหลือแถวของ salary.events แถวเดียว · แก้จากหน้าพนักงานตรง ๆ (ไม่มีคู่) ยังขึ้นตามเดิม
  const rateEvents = sal.entries.filter((e) => e.id.startsWith("salrate:") && e.target);
  const isPaired = (e: ChangeEntry) =>
    e.id.startsWith("wf:") &&
    /^(ตั้ง|แก้)เงินเดือน\/ค่าจ้าง|^แก้รายละเอียดเงินเดือน/.test(e.text) &&
    rateEvents.some((s) => s.target!.id === e.target?.id && Math.abs(Date.parse(s.at) - Date.parse(e.at)) < 3 * 60_000);
  const merged = [...wf.filter((e) => !isPaired(e)), ...sal.entries.map(fill), ...dw.entries.map(fill), ...core.entries.map(fill), ...score].sort((a, b) => b.at.localeCompare(a.at));
  return { entries: collapseRepeats(merged), failed };
}

/** เปิดดูหน้าเดิมซ้ำ ๆ ติดกัน (คนเดิม ข้อมูลของคนเดิม ภายใน 30 นาที) → แถวเดียว "(N ครั้ง)" */
export function collapseRepeats(entries: ChangeEntry[]): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  let count = 1;
  let first: ChangeEntry | null = null;
  const flush = () => {
    if (!first) return;
    out.push(count > 1 ? { ...first, text: `${first.text} (${count} ครั้ง)` } : first);
  };
  for (const e of entries) {
    const same =
      first &&
      e.category === "view" &&
      first.category === "view" &&
      e.actor === first.actor &&
      e.text === first.text &&
      (e.target?.id ?? "") === (first.target?.id ?? "") &&
      Date.parse(first.at) - Date.parse(e.at) < 30 * 60_000;
    if (same) {
      count += 1;
      continue;
    }
    flush();
    first = e;
    count = 1;
  }
  flush();
  return out;
}

export interface ChangeLogFilter {
  category: ChangeCategory | "all";
  actor: string;
  target: string;
  q: string;
}

export function filterChangeLog(entries: ChangeEntry[], f: ChangeLogFilter): ChangeEntry[] {
  const q = f.q.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (f.category === "all" || e.category === f.category) &&
      (!f.actor || e.actor === f.actor) &&
      (!f.target || e.target?.id === f.target) &&
      (!q ||
        [e.text, e.actor, e.target?.name, e.target?.code, e.reason, ...e.details.flatMap((d) => [d.label, d.before, d.after])]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q))),
  );
}

export { CHANGE_CATEGORIES };
