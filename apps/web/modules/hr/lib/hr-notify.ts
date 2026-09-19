import "server-only";
import { prisma } from "@smartboss/database";
import { notifyUser } from "@/modules/maintenance/data/notify";

/**
 * แจ้งเตือนผู้มีสิทธิ์อนุมัติ ตอนมีคำขอ HR ใหม่เข้ามา (ลา/แก้เวลาเข้า-ออกงาน)
 *
 * เดิม HR ไม่เคยแจ้งเตือนใครเลยสักตัว — ผู้อนุมัติต้องเข้าไปเปิดหน้า HR เองถึง
 * จะรู้ว่ามีคำขอค้างรออยู่ ("บางคนอาจจะต้องอนุมัติเวลามีคนขอลา...อยากให้แจ้ง
 * เตือนไปหาคนที่ต้องอนุมัติ") ใช้ core.notifications ตัวเดียวกับที่ maintenance
 * ใช้อยู่แล้ว (ดู notifyUser's own doc — คิวรี by userId ล้วนๆ ไม่กรอง type จึง
 * ใช้ร่วมกับโมดูลไหนก็ได้ ไม่ต้องแก้อะไรฝั่งดึงข้อมูล/กระดิ่งเพิ่มเลย)
 *
 * ── ทำไมต้อง query workforce schema ตรงๆ ──
 * HR รันอยู่บน workforce-api (Nest/Drizzle, คนละฐานข้อมูล/คนละ id space —
 * "employmentId" ไม่ใช่ SmartBoss User.id) สิทธิ์อนุมัติที่แท้จริงก็อยู่ที่นั่น
 * เช่นกัน (workforce.role_permissions ผูกกับ workforce.roles ผ่าน
 * principal_role_assignments) จึงต้อง join ไปหา SmartBoss user id
 * (workforce.principals.subject) เอง — pattern เดียวกับที่
 * report_task/lib/db/workforce-calendar.ts ใช้อ่านปฏิทินการลาอยู่แล้ว
 * (withWorkforceTenant: SET LOCAL ROLE + tenant context ให้ RLS บังคับปกติ)
 */

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function withWorkforceTenant<T>(orgId: string, run: (tx: PrismaTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // SET LOCAL ผูกกับ transaction จึงหมดผลเองเมื่อจบ ไม่รั่วไปคำขออื่น
    await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
    await tx.$executeRaw`SELECT set_config('workforce.tenant_id', ${orgId}, true)`;
    return run(tx);
  });
}

interface ApproverRow {
  subject: string | null;
}

/**
 * ทุกคนที่ถือ workforce permission นี้อยู่ตอนนี้ (assignment ยังไม่หมดอายุ) —
 * permission string เดียวกับที่ workforce-api เองใช้เช็คตอนกดอนุมัติจริง
 * ('workforce.leave.approve', 'workforce.attendance.correct.approve') กัน
 * ไม่ให้แจ้งเตือนไปหาคนที่กดอนุมัติจริงไม่ได้ ไม่มี scope แยกตามแผนก — ทั้ง
 * สองสิทธิ์นี้เป็น flat ทั้งบริษัท (ดู leave.service.ts/attendance.controller.ts)
 * บางคนอาจไม่มีบัญชี SmartBoss ผูกไว้เลย (workforce.principals ไม่มีแถวให้)
 * — คนนั้นก็แค่ไม่ได้อยู่ในผลลัพธ์ ไม่ throw
 */
async function resolveApproverUserIds(orgId: string, permission: string): Promise<string[]> {
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRaw<ApproverRow[]>`
      SELECT DISTINCT p.subject
      FROM workforce.principal_role_assignments pra
      JOIN workforce.role_permissions rp
        ON rp.role_id = pra.role_id AND rp.tenant_id = pra.tenant_id
      JOIN workforce.principals p ON p.id = pra.principal_id
      WHERE rp.permission = ${permission}
        AND (pra.expires_at IS NULL OR pra.expires_at > now())
    `
  );
  return rows.map((r) => r.subject).filter((s): s is string => !!s);
}

/**
 * แจ้งทุกคนที่ถือ `permission` (อนุมัติได้จริงตอนนี้) ว่ามีคำขอใหม่รอ — ข้าม
 * `excludeUserId` (เช่น ถ้าคนยื่นเองก็ถือสิทธิ์อนุมัติอยู่แล้ว ไม่ต้องเตือนตัวเอง)
 *
 * เงียบเมื่อ resolve ไม่สำเร็จ (query workforce พลาด/ยังไม่ provision) — ไม่ให้
 * การแจ้งเตือนที่ทำเสร็จแล้วมาทำให้การยื่นคำขอจริง (ที่ user กำลังรอผลอยู่)
 * ล้มเหลวตามไปด้วย เหมือน notifyUser's ของ sendLine ที่ล้มเหลวเงียบ + log
 */
export async function notifyApprovers(
  orgId: string,
  permission: string,
  excludeUserId: string | undefined,
  input: { title: string; body?: string; type: string; referenceId?: string }
): Promise<void> {
  try {
    const approverIds = (await resolveApproverUserIds(orgId, permission)).filter((id) => id !== excludeUserId);
    await Promise.all(approverIds.map((id) => notifyUser(orgId, id, input)));
  } catch (err) {
    console.error("[hr-notify] notifyApprovers failed", err);
  }
}
