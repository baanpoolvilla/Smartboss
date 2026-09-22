import { requireOrg, hasPermission, hasRole, isSuperAdmin } from "@smartboss/auth";

import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { listDirectory } from "@/modules/report_task/lib/db/employee-directory";
import { listCeoUserIds, createPenaltyRequest, listPenaltyRequests } from "@/modules/report_task/lib/db/report-penalty-requests";
import type { AppNotification } from "@/modules/report_task/store/notification-store";

/**
 * คำร้องขอแก้ไข/ขอส่งย้อนหลังของคะแนนรายงาน
 *
 * ยื่น/ดูของตัวเองได้ทุกคน (แค่ต้องเข้าโมดูลบุคคลได้ — HR_PERMS.access) ไม่ว่า
 * จะยื่นจากหน้า "คะแนนของฉัน" (/hr/my-score, ทุกคนเข้าได้) หรือหัวหน้า/HR ยื่น
 * แทนจากหน้าคะแนน & เกรดรวม (/hr/employees?tab=score, core.performance.view
 * เท่านั้น) — เห็น "ของคนอื่น" หรือ "ทั้งหมด" (?all=1) ถึงต้องมี performanceView
 *
 * GET: ?all=1 (เฉพาะ CEO/SUPER_ADMIN เห็นของทุกคน) ไม่งั้นเห็นเฉพาะของตัวเอง
 * POST: ยื่นคำร้องใหม่ — แจ้งเตือนไปหา CEO ทุกคนในบริษัททันที (เข้าคิว
 * /hr/penalty-requests ผ่านลิงก์ในแจ้งเตือน หรือเมนู "คำร้องขอแก้ไขคะแนน")
 */
export const dynamic = "force-dynamic";

const NOTIFICATIONS_KEY = "notifications";

export async function GET(request: Request) {
  const session = await requireOrg();

  const wantsAll = new URL(request.url).searchParams.get("all") === "1";
  const canSeeAll = wantsAll && (hasRole(session, "CEO") || isSuperAdmin(session));
  if (wantsAll && !canSeeAll) {
    return Response.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const [all, users] = await Promise.all([listPenaltyRequests(session.orgId), listDirectory(session.orgId)]);
  const nameById = new Map(users.map((u) => [u.id, u.name] as const));
  const scoped = canSeeAll ? all : all.filter((r) => r.userId === session.userId || r.submittedBy === session.userId);
  const items = scoped.map((r) => ({ ...r, userName: nameById.get(r.userId) ?? r.userId }));
  return Response.json({ items });
}

export async function POST(request: Request) {
  const session = await requireOrg();

  const body = (await request.json().catch(() => null)) as
    | { userId?: string; refId?: string; type?: string; reason?: string }
    | null;
  if (!body?.userId || !body?.refId || !body?.reason || (body.type !== "retroactive" && body.type !== "waive")) {
    return Response.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }

  // ยื่นให้ตัวเองทำได้เสมอ — ยื่นแทน "คนอื่น" ต้องเป็นคนที่เห็นหน้าคะแนนรวมได้
  // (หัวหน้า/HR/CEO) เท่านั้น กันพนักงานทั่วไปยื่นคำร้องปลอมแทนคนอื่น
  if (body.userId !== session.userId && !hasPermission(session, ADMIN_PERMS.performanceView)) {
    return Response.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const result = await createPenaltyRequest(session.orgId, {
    userId: body.userId,
    submittedBy: session.userId,
    refId: body.refId,
    type: body.type,
    reason: body.reason,
  });
  if (result.error !== null) return Response.json({ error: result.error }, { status: 400 });

  const ceoIds = await listCeoUserIds(session.orgId);
  if (ceoIds.length > 0) {
    const { data: existing, version } = await readStore<AppNotification[]>(session.orgId, NOTIFICATIONS_KEY);
    const fresh: AppNotification[] = ceoIds.map((userId) => ({
      id: `notif-penalty-req-${result.request.id}-${userId}`,
      userId,
      byUserId: session.userId,
      message: `มีคำร้องขอแก้ไขคะแนนใหม่ — รอการอนุมัติ`,
      link: "/hr/penalty-requests",
      createdAt: new Date().toISOString(),
      read: false,
    }));
    await writeStore(session.orgId, NOTIFICATIONS_KEY, [...fresh, ...(existing ?? [])], version, session.userId);
  }

  return Response.json({ ok: true, request: result.request });
}
