import { requireOrg, hasRole, isSuperAdmin } from "@smartboss/auth";

import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { decidePenaltyRequest } from "@/modules/report_task/lib/db/report-penalty-requests";
import type { AppNotification } from "@/modules/report_task/store/notification-store";

/**
 * อนุมัติ/ไม่อนุมัติคำร้องขอแก้ไขคะแนน — **CEO เท่านั้น** (ยืนยันจากผู้ใช้ตรง ๆ
 * ว่าอนุมัติได้คนเดียวคือ CEO ไม่ใช่หัวหน้าแผนกทุกคน) SUPER_ADMIN ผ่านได้
 * เหมือนทุกจุดอื่นในระบบ (ดู guard.ts's isSuperAdmin)
 */
export const dynamic = "force-dynamic";

const NOTIFICATIONS_KEY = "notifications";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOrg();
  if (!hasRole(session, "CEO") && !isSuperAdmin(session)) {
    return Response.json({ error: "อนุมัติได้เฉพาะ CEO เท่านั้น" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { decision?: string } | null;
  if (body?.decision !== "approved" && body?.decision !== "rejected") {
    return Response.json({ error: "ระบุผลการพิจารณาไม่ถูกต้อง" }, { status: 400 });
  }

  const result = await decidePenaltyRequest(session.orgId, id, body.decision, session.userId);
  if (result.error !== null) return Response.json({ error: result.error }, { status: 400 });

  const { data: existing, version } = await readStore<AppNotification[]>(session.orgId, NOTIFICATIONS_KEY);
  const message =
    body.decision === "approved"
      ? `คำร้องขอแก้ไขคะแนนของคุณได้รับการอนุมัติแล้ว — คืนคะแนนให้แล้ว`
      : `คำร้องขอแก้ไขคะแนนของคุณไม่ได้รับการอนุมัติ`;
  const fresh: AppNotification[] = [
    {
      id: `notif-penalty-decided-${result.request.id}`,
      userId: result.request.userId,
      byUserId: session.userId,
      message,
      link: "/hr/employees?tab=score",
      createdAt: new Date().toISOString(),
      read: false,
    },
  ];
  await writeStore(session.orgId, NOTIFICATIONS_KEY, [...fresh, ...(existing ?? [])], version, session.userId);

  return Response.json({ ok: true, request: result.request });
}
