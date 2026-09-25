import "server-only";
import { prisma } from "@smartboss/database";
import { notifyUser, notifyActorName } from "@/modules/maintenance/data/notify";

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
  actorUserId: string | undefined,
  input: { title: string; body?: string; type: string; referenceId?: string }
): Promise<void> {
  try {
    const [approverIds, actorName] = await Promise.all([
      resolveApproverUserIds(orgId, permission),
      notifyActorName(actorUserId),
    ]);
    // ชื่อผู้ยื่นนำหน้าหัวข้อ — กระดิ่งของผู้อนุมัติมักมีคำขอค้างพร้อมกันหลายใบ
    // ซึ่งหัวข้อเหมือนกันเป๊ะทุกใบ ("มีคำขอลาใหม่รออนุมัติ" เรียงกัน 7 บรรทัด)
    // แยกไม่ออกว่าใบไหนของใคร ต้องกดเข้าไปดูทีละใบถึงจะรู้ ("อยากให้บอกด้วยว่า
    // ใครเป็นคนขอ") ชื่อมาก่อนเพราะเป็นส่วนที่ต่างกันจริง ๆ กวาดตาหาได้เร็วสุด
    const title = actorName ? `${actorName} · ${input.title}` : input.title;
    await Promise.all(
      approverIds.filter((id) => id !== actorUserId).map((id) => notifyUser(orgId, id, { ...input, title }))
    );
  } catch (err) {
    console.error("[hr-notify] notifyApprovers failed", err);
  }
}


/* ═══════════════════ แจ้งผลกลับไปหาคนที่ยื่นคำขอ ═══════════════════ */

export type HrRequestKind = "leave" | "correction" | "overtime";

interface RequesterRow {
  subject: string | null;
  status: string | null;
}

/**
 * หา core.users.id ของเจ้าของคำขอ + สถานะล่าสุด — เส้นเดียวกับปฏิทินวันลา
 * (report_task/lib/db/workforce-calendar.ts): employment → person → principal.subject
 * พนักงานที่ยังไม่ผูกบัญชี SmartBoss = ไม่มี subject → ไม่แจ้ง (ไม่ throw)
 */
async function resolveRequester(
  orgId: string,
  kind: HrRequestKind,
  ref: { id?: string; employmentId?: string; workDate?: string }
): Promise<RequesterRow | null> {
  const rows = await withWorkforceTenant(orgId, (tx) => {
    if (kind === "leave") {
      return tx.$queryRaw<RequesterRow[]>`
        SELECT p.subject, lr.status
        FROM workforce.leave_requests lr
        JOIN workforce.employments e ON e.id = lr.employment_id
        LEFT JOIN workforce.principals p ON p.person_id = e.person_id
        WHERE lr.id = ${ref.id}::uuid
        LIMIT 1`;
    }
    if (kind === "correction") {
      return tx.$queryRaw<RequesterRow[]>`
        SELECT p.subject, a.status
        FROM workforce.time_event_adjustments a
        JOIN workforce.employments e ON e.id = a.employment_id
        LEFT JOIN workforce.principals p ON p.person_id = e.person_id
        WHERE a.id = ${ref.id}::uuid
        LIMIT 1`;
    }
    return tx.$queryRaw<RequesterRow[]>`
      SELECT p.subject, NULL::text AS status
      FROM workforce.employments e
      LEFT JOIN workforce.principals p ON p.person_id = e.person_id
      WHERE e.id = ${ref.employmentId}::uuid
      LIMIT 1`;
  });
  return rows[0] ?? null;
}

/**
 * แจ้งผู้ยื่นว่าคำขอของตัวเองได้ผลแล้ว (อนุมัติ/ไม่อนุมัติ) — เรียกหลังตัดสินสำเร็จ
 * ผ่าน notifyUser ⇒ ลงกระดิ่ง + เด้ง/มีเสียงให้ผู้ยื่นทันที (lib/notify-push.ts)
 * ไม่แจ้งถ้าผู้ตัดสินเป็นเจ้าของคำขอเอง · เงียบเมื่อหาเจ้าของไม่เจอ
 */
export async function notifyRequester(
  orgId: string,
  kind: HrRequestKind,
  ref: { id?: string; employmentId?: string; workDate?: string },
  actorUserId: string,
  outcome: "APPROVED" | "REJECTED",
  detail?: { reason?: string; approvedMinutes?: number | null }
): Promise<void> {
  try {
    const [row, actorName] = await Promise.all([resolveRequester(orgId, kind, ref), notifyActorName(actorUserId)]);
    const userId = row?.subject;
    if (!userId || userId === actorUserId) return;

    const approved = outcome === "APPROVED";
    // แก้เวลาต้องอนุมัติสองคน — คนแรกกดแล้วสถานะยังเป็น PENDING = ผ่านขั้นแรก ยังไม่มีผล
    const firstOfTwo = kind === "correction" && approved && row?.status === "PENDING";
    const what = kind === "leave" ? "คำขอลา" : kind === "correction" ? "คำขอแก้เวลาเข้า-ออกงาน" : `OT วันที่ ${ref.workDate ?? ""}`.trim();
    const title = firstOfTwo
      ? `${what}ของคุณผ่านการอนุมัติขั้นแรกแล้ว (รออีก 1 คน)`
      : approved
        ? `${what}ของคุณได้รับอนุมัติแล้ว${kind === "overtime" && detail?.approvedMinutes ? ` (${detail.approvedMinutes} นาที)` : ""}`
        : `${what}ของคุณไม่ได้รับอนุมัติ`;
    const by = actorName ? `โดย ${actorName}` : "";
    const body = [by, detail?.reason ? `เหตุผล: ${detail.reason}` : ""].filter(Boolean).join(" · ") || undefined;

    await notifyUser(orgId, userId, {
      title,
      body,
      type: kind === "leave" ? "hr_leave_decided" : kind === "correction" ? "hr_attendance_correction_decided" : "hr_overtime_decided",
      referenceId: ref.id ?? ref.employmentId ?? null,
    });
  } catch (err) {
    console.error("[hr-notify] notifyRequester failed", err);
  }
}
