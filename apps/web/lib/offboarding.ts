import "server-only";
import { audit } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { syncUserToWorkforce } from "@/modules/admin/data/user-guards";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";

/**
 * พนักงานพ้นสภาพ → ปิดบัญชีเข้าสู่ระบบ (11/11/2569)
 *
 * เดิมการกด "แจ้งพ้นสภาพ" แค่ใส่วันสุดท้ายในทะเบียน — บัญชีเข้าสู่ระบบยังใช้ได้จนกว่าจะมีคน
 * ไปปิดที่ หลังบ้าน › ผู้ใช้งาน แยกอีกรอบ (ลืมบ่อย = คนที่ออกไปแล้วยังเข้าระบบได้)
 *
 *  - วันสุดท้ายผ่านมาแล้ว/วันนี้เป็นวันสุดท้ายที่ผ่านไปแล้ว → ปิดทันที
 *  - วันสุดท้ายยังไม่ถึง → จดไว้ที่ users.disable_on · บัญชีใช้ได้ถึงสิ้นวันนั้น (เวลาไทย)
 *    พ้นแล้ว loadAuthUser ถือว่าปิดทันที (ไม่ต้องรองานตั้งเวลา — packages/auth/user.ts)
 *    และ sweepDueAccountDisables พลิกสถานะเป็น "ปิดใช้งาน" จริงตอนมีคนในบริษัทเปิดแอป
 *
 * ข้อมูลเดิมของคนนั้น (แชท งาน รายงาน สลิป) ไม่ถูกแตะ — ปิดแค่การเข้าสู่ระบบ
 */

/** บทบาทที่ไม่ปิดให้อัตโนมัติ — ปิดผิดคนคือทั้งบริษัทไม่มีคนอนุมัติ/ดูแล ให้ผู้ดูแลปิดเองที่หลังบ้าน */
const NEVER_AUTO_DISABLE = new Set(["CEO", "SUPER_ADMIN"]);

export interface EmploymentAccount {
  terminatedOn: string | null;
  user: { id: string; name: string; isActive: boolean; disableOn: string | null; protectedRole: boolean } | null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** วันนี้ตามเวลาไทย (YYYY-MM-DD) */
export function bangkokDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** บัญชีผู้ใช้ของพนักงานคนนี้ — ผูกผ่าน principal ของระบบบุคคล ถ้ายังไม่ผูกใช้อีเมลในทะเบียนจับคู่ (กฎเดียวกับสลิปเงินเดือน) */
export async function accountOfEmployment(orgId: string, employmentId: string): Promise<EmploymentAccount | null> {
  if (!/^[0-9a-f-]{36}$/i.test(employmentId)) return null;
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRawUnsafe<{ terminated_on: string | null; email: string | null; subject: string | null }[]>(
      `SELECT e.terminated_on::text AS terminated_on, pe.email,
              (SELECT p.subject FROM workforce.principals p WHERE p.person_id = e.person_id LIMIT 1) AS subject
         FROM workforce.employments e JOIN workforce.people pe ON pe.id = e.person_id
        WHERE e.id = $1::uuid`,
      employmentId,
    ),
  );
  const row = rows[0];
  if (!row) return null;
  const select = { id: true, name: true, isActive: true, disableOn: true, roles: { select: { role: { select: { code: true } } } } } as const;
  let user = row.subject ? await prisma.user.findFirst({ where: { orgId, id: row.subject }, select }) : null;
  if (!user && row.email) {
    user = await prisma.user.findFirst({ where: { orgId, email: { equals: row.email, mode: "insensitive" } }, select });
  }
  return {
    terminatedOn: row.terminated_on,
    user: user
      ? {
          id: user.id,
          name: user.name,
          isActive: user.isActive,
          disableOn: user.disableOn ? ymd(user.disableOn) : null,
          protectedRole: user.roles.some((r) => NEVER_AUTO_DISABLE.has(r.role.code)),
        }
      : null,
  };
}

/** ปิดบัญชีเดี๋ยวนี้ + ออกจากระบบทุกเครื่อง + ปิดสิทธิ์ฝั่งระบบบุคคล + บันทึกประวัติ */
export async function disableAccountNow(orgId: string, userId: string, actorId: string | null, detail: Record<string, unknown>): Promise<void> {
  const done = await prisma.user.updateMany({ where: { orgId, id: userId, isActive: true }, data: { isActive: false, disableOn: null } });
  if (done.count === 0) return;
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await syncUserToWorkforce(userId, orgId, actorId ?? userId);
  await audit({ userId: actorId, action: "USER_DISABLED", targetId: userId, detail: { reason: "employment_terminated", ...detail } });
}

export type OffboardResult = "disabled" | "scheduled" | "no_account" | "already_off" | "protected" | "self";

/**
 * ปิดบัญชีของพนักงานที่พ้นสภาพ — ทันทีถ้าวันสุดท้ายผ่านแล้ว ไม่งั้นตั้งเวลาไว้
 * ไม่ปิดบัญชีตัวเอง (คนกด) และไม่ปิดบทบาทสูงสุดของบริษัทให้อัตโนมัติ
 */
export async function offboardAccount(orgId: string, employmentId: string, lastDay: string, actorId: string): Promise<OffboardResult> {
  const account = await accountOfEmployment(orgId, employmentId);
  if (!account?.user) return "no_account";
  const u = account.user;
  if (!u.isActive) return "already_off";
  if (u.id === actorId) return "self";
  if (u.protectedRole) return "protected";
  if (lastDay < bangkokDay()) {
    await disableAccountNow(orgId, u.id, actorId, { employmentId, lastDay });
    return "disabled";
  }
  await prisma.user.updateMany({ where: { orgId, id: u.id }, data: { disableOn: new Date(`${lastDay}T00:00:00Z`) } });
  await audit({ userId: actorId, action: "USER_UPDATED", targetId: u.id, detail: { scheduledDisableAfter: lastDay, employmentId } });
  return "scheduled";
}

/**
 * พลิกบัญชีที่พ้นวันสุดท้ายแล้วเป็น "ปิดใช้งาน" จริง (หายจากรายชื่อให้แท็ก/มอบหมาย)
 * เครื่องจริงไม่มีงานตั้งเวลาสำหรับเรื่องนี้ จึงพ่วงกับการเปิดแอปของคนในบริษัท — บริษัทละไม่เกิน 1 ครั้ง/10 นาที
 * (ตัวกันการเข้าระบบไม่รอขั้นนี้ — ดู loadAuthUser)
 */
const g = globalThis as unknown as { __sbOffboardSweep?: Map<string, number> };
const lastSweep = (g.__sbOffboardSweep ??= new Map<string, number>());

export function sweepDueAccountDisables(orgId: string): void {
  const now = Date.now();
  if (now - (lastSweep.get(orgId) ?? 0) < 10 * 60_000) return;
  lastSweep.set(orgId, now);
  void (async () => {
    const today = new Date(`${bangkokDay()}T00:00:00Z`);
    const due = await prisma.user.findMany({ where: { orgId, isActive: true, disableOn: { lt: today } }, select: { id: true, disableOn: true } });
    for (const u of due) {
      await disableAccountNow(orgId, u.id, null, { lastDay: u.disableOn ? ymd(u.disableOn) : null, auto: true });
    }
  })().catch((err) => console.error("[offboarding] sweep failed:", err instanceof Error ? err.message : err));
}
