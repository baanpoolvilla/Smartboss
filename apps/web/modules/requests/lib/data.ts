import "server-only";
import { prisma } from "@smartboss/database";

import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { readDwSettings, readOt, readOverrides, readPayRates, readTimeEdits } from "@/modules/daily_worker/lib/data";
import { WORKER_ROLE_CODE } from "@/modules/daily_worker/permissions";
import { usersWithPermission } from "@/modules/maintenance/data/notify";
import { REQ_PERMS } from "../permissions";
import { loadRequests, readSettings, withRequestsTenant, type RequestView } from "./db";
import { routeFor, type ApprovalRoute, type ApproverLevel, type RequestKind } from "./types";

/* ───────────── คน ───────────── */

export interface Person {
  userId: string;
  name: string;
  email: string | null;
  roles: string[];
  isWorker: boolean;
  departmentName: string | null;
}

export async function listPeople(orgId: string): Promise<Person[]> {
  const users = await prisma.user.findMany({
    where: { orgId, isActive: true },
    select: { id: true, name: true, email: true, department: { select: { name: true } }, roles: { select: { role: { select: { code: true } } } } },
    orderBy: { name: "asc" },
  });
  return users.map((u) => {
    const roles = u.roles.map((r) => r.role.code);
    return { userId: u.id, name: u.name, email: u.email, roles, isWorker: roles.includes(WORKER_ROLE_CODE), departmentName: u.department?.name ?? null };
  });
}

/**
 * ผูกผู้ใช้ Smartboss → ทะเบียนพนักงาน (workforce.employments) แบบเดียวกับโมดูลคนงาน:
 * principal.person_id ก่อน ไม่มีค่อยเทียบอีเมล · ไม่เจอ = ไม่มีในทะเบียน (คิดค่า OT จากเงินเดือนไม่ได้)
 */
export async function employmentOf(orgId: string, userId: string, email: string | null): Promise<string | null> {
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT e.id::text AS id
         FROM (SELECT $1::text AS subject, $2::text AS email) u
         LEFT JOIN workforce.principals p ON p.subject = u.subject
         JOIN workforce.people pe ON pe.id = p.person_id OR (u.email <> '' AND lower(pe.email) = lower(u.email))
         JOIN workforce.employments e ON e.person_id = pe.id AND e.status <> 'TERMINATED'
        ORDER BY (pe.id = p.person_id) DESC NULLS LAST, e.hired_on DESC
        LIMIT 1`,
      userId,
      email ?? "",
    ),
  ).catch((error: unknown) => {
    console.error("[requests] employmentOf failed", error);
    return [];
  });
  return rows[0]?.id ?? null;
}

/** เงินเดือน (รายเดือน) ที่มีผลวันนั้น จากระบบบุคคล — ไม่มี = null */
export async function monthlySalaryOn(orgId: string, employmentId: string, date: string): Promise<number | null> {
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRawUnsafe<{ amount: string }[]>(
      `SELECT amount::text AS amount FROM workforce.compensation_rates
        WHERE employment_id = $1::uuid AND pay_basis = 'MONTHLY'
          AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date)
        ORDER BY effective_from DESC LIMIT 1`,
      employmentId,
      date,
    ),
  ).catch(() => []);
  const v = rows[0] ? Number(rows[0].amount) : null;
  return v !== null && Number.isFinite(v) && v > 0 ? v : null;
}

/** ค่าแรงต่อวัน + % OT ของคนงานวันนั้น — กติกาเดียวกับโมดูลคนงาน (เรทในโมดูลก่อน ไม่มีค่อยใช้ HR รายวัน) */
export async function workerRateOn(orgId: string, employmentId: string, date: string): Promise<{ wage: number | null; otPercent: number }> {
  const [rates, settings] = await Promise.all([readPayRates(orgId), readDwSettings(orgId)]);
  const own = rates
    .filter((r) => r.employmentId === employmentId && r.from <= date)
    .sort((a, b) => (a.from === b.from ? b.at.localeCompare(a.at) : b.from.localeCompare(a.from)))[0];
  if (own) return { wage: own.dailyWage, otPercent: own.otPercent ?? settings.otPercent };
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRawUnsafe<{ amount: string }[]>(
      `SELECT amount::text AS amount FROM workforce.compensation_rates
        WHERE employment_id = $1::uuid AND pay_basis = 'DAILY'
          AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date)
        ORDER BY effective_from DESC LIMIT 1`,
      employmentId,
      date,
    ),
  ).catch(() => []);
  const wage = rows[0] ? Number(rows[0].amount) : null;
  return { wage: wage !== null && Number.isFinite(wage) && wage > 0 ? wage : null, otPercent: settings.otPercent };
}

/** OT ที่ผู้ดูแลลงไว้ในโมดูลคนงานแล้ววันนั้น (กันลงซ้ำ) */
export async function workerOtOn(orgId: string, employmentId: string, date: string) {
  const { list } = await readOt(orgId);
  return list.find((o) => o.employmentId === employmentId && o.date === date) ?? null;
}

/**
 * คนงานมาทำงานวันนั้นไหม — ลงเวลาเข้าจริง (raw_time_events / ผลลงเวลา) · ผู้ดูแลกด "แก้เวลา" ใส่เวลาเข้าให้ · หรือ "แก้เป็นมา" แบบเดิม
 * OT คนงานจ่ายเฉพาะวันที่มา (modules/daily_worker judgeDay) — ไม่มีหลักฐานว่ามา = รู้ไม่ได้ว่าทำ OT จริง (ผู้ใช้ 30/10/2569)
 * อ่านระบบลงเวลาไม่ได้ = ถือว่ามา (ไม่กันการลง OT เพราะระบบล่ม)
 */
export async function workerCameOn(orgId: string, employmentId: string, date: string): Promise<boolean> {
  const [{ list }, edits] = await Promise.all([readOverrides(orgId), readTimeEdits(orgId).catch(() => [])]);
  if (list.some((o) => o.employmentId === employmentId && o.date === date)) return true;
  if (edits.some((t) => t.employmentId === employmentId && t.date === date && !!t.inAt)) return true;
  try {
    const rows = await withWorkforceTenant(orgId, (tx) =>
      tx.$queryRawUnsafe<{ came: boolean }[]>(
        `SELECT EXISTS (
                  SELECT 1 FROM workforce.raw_time_events
                   WHERE employment_id = $1::uuid AND status = 'ACCEPTED'
                     AND (captured_at AT TIME ZONE 'Asia/Bangkok')::date = $2::date
                ) OR EXISTS (
                  SELECT 1 FROM workforce.attendance_results
                   WHERE employment_id = $1::uuid AND is_current AND actual_in_at IS NOT NULL AND work_date = $2::date
                ) AS came`,
        employmentId,
        date,
      ),
    );
    return rows[0]?.came ?? true;
  } catch {
    return true;
  }
}

/* ───────────── ผู้อนุมัติ / ผู้จ่าย ───────────── */

/**
 * ใครอนุมัติใบนี้ — ตามเส้นทางที่บริษัทตั้งไว้รายประเภท (หน้าตั้งค่า) + ยอดเงิน
 * ใบที่คนยื่นหรือผู้ได้เงินเป็นผู้อนุมัติระดับ HR เอง (ไม่ใช่ CEO) → ข้ามไป CEO ขั้นเดียว (อนุมัติใบตัวเองไม่ได้)
 * CEO ลงให้คนอื่น (เช่น OT) → HR อนุมัติได้ตามปกติ
 */
export async function approverLevelFor(
  orgId: string,
  kind: RequestKind,
  creatorId: string,
  beneficiaryId: string | null,
  amount: number,
  routes: Record<RequestKind, ApprovalRoute>,
): Promise<{ level: ApproverLevel; needCeo: boolean }> {
  const route = routeFor(routes[kind], amount);
  if (route.level === "ceo") return route;
  const hrApprovers = new Set(await usersWithPermission(orgId, REQ_PERMS.approve));
  const ceoApprovers = new Set(await usersWithPermission(orgId, REQ_PERMS.approveCeo));
  const involved = [creatorId, beneficiaryId].filter((x): x is string => !!x);
  if (involved.some((id) => hrApprovers.has(id) && !ceoApprovers.has(id))) return { level: "ceo", needCeo: false };
  return route;
}

/** คนที่อนุมัติใบนี้ได้จริง (ไม่ใช่คนยื่น ไม่ใช่ผู้ได้เงิน) */
export async function eligibleApprovers(orgId: string, level: ApproverLevel, creatorId: string, beneficiaryId: string | null): Promise<string[]> {
  const ids = await usersWithPermission(orgId, level === "ceo" ? REQ_PERMS.approveCeo : REQ_PERMS.approve);
  const ceo = level === "hr" ? await usersWithPermission(orgId, REQ_PERMS.approveCeo) : [];
  return [...new Set([...ids, ...ceo])].filter((id) => id !== creatorId && id !== beneficiaryId);
}

/* ───────────── บ้าน / ใบงาน ───────────── */

export async function listProperties(orgId: string) {
  return prisma.property.findMany({ where: { orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** ใบงานที่ยังเปิด + ที่เพิ่งปิดใน 30 วัน — ให้ผูกคำขอเข้ากับงานที่ทำ */
export async function listLinkableWorkOrders(orgId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  return prisma.workOrder.findMany({
    where: { orgId, OR: [{ status: { in: ["open", "in_progress"] } }, { completedAt: { gte: since } }] },
    select: { id: true, code: true, title: true, propertyId: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

/* ───────────── รายการ ───────────── */

export interface Viewer {
  userId: string;
  canApprove: boolean;
  canApproveCeo: boolean;
  canPay: boolean;
  isPettyHolder: boolean;
  canViewAll: boolean;
  canFileOthers: boolean;
}

/** ใบที่คนนี้มีสิทธิ์เห็น — ของตัวเอง/ที่ยื่น · ผู้อนุมัติ/ผู้จ่าย/ดูทั้งหมด เห็นทั้งบริษัท */
export async function listVisibleRequests(orgId: string, viewer: Viewer, opts: { from?: string; to?: string } = {}): Promise<RequestView[]> {
  const seesAll = viewer.canViewAll || viewer.canApprove || viewer.canApproveCeo || viewer.canPay || viewer.isPettyHolder;
  const dateWhere = opts.from || opts.to ? { workDate: { ...(opts.from ? { gte: new Date(`${opts.from}T00:00:00Z`) } : {}), ...(opts.to ? { lte: new Date(`${opts.to}T00:00:00Z`) } : {}) } } : {};
  return withRequestsTenant(orgId, (tx) =>
    loadRequests(tx, orgId, seesAll ? dateWhere : { ...dateWhere, OR: [{ createdBy: viewer.userId }, { beneficiaryUserId: viewer.userId }] }, 1000),
  );
}

export function canSee(r: RequestView, viewer: Viewer): boolean {
  if (r.createdBy === viewer.userId || r.beneficiaryUserId === viewer.userId) return true;
  return viewer.canViewAll || viewer.canApprove || viewer.canApproveCeo || viewer.canPay || viewer.isPettyHolder;
}

export function canDecide(r: RequestView, viewer: Viewer): boolean {
  if (r.status !== "pending") return false;
  if (r.createdBy === viewer.userId || r.beneficiaryUserId === viewer.userId) return false;
  return r.approverLevel === "ceo" ? viewer.canApproveCeo : viewer.canApprove || viewer.canApproveCeo;
}

export async function loadSettings(orgId: string) {
  return withRequestsTenant(orgId, (tx) => readSettings(tx, orgId));
}
