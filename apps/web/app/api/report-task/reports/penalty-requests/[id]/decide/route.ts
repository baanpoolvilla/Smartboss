import { requireOrg, hasRole, isSuperAdmin } from "@smartboss/auth";

import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { decidePenaltyRequest } from "@/modules/report_task/lib/db/report-penalty-requests";
import type { AppNotification } from "@/modules/report_task/store/notification-store";
import { retroSubmitDeadline } from "@/modules/report_task/lib/penalty-request-window";
import { reportDayText } from "@/modules/report_task/lib/penalty-evidence";
import { effectiveRoundsOf } from "@/modules/report_task/lib/submission-rounds";
import type { ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { loadScorePeriodConfig } from "@/lib/score-period-config";

import { ceoTitle } from "@/lib/ceo-title";
/**
 * อนุมัติ/ไม่อนุมัติคำร้องขอแก้ไขคะแนน — **CEO เท่านั้น** (ยืนยันจากผู้ใช้ตรง ๆ
 * ว่าอนุมัติได้คนเดียวคือ CEO ไม่ใช่หัวหน้าแผนกทุกคน) SUPER_ADMIN ผ่านได้
 * เหมือนทุกจุดอื่นในระบบ (ดู guard.ts's isSuperAdmin)
 */
export const dynamic = "force-dynamic";

const NOTIFICATIONS_KEY = "notifications";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const ceo = await ceoTitle();
  const session = await requireOrg();
  if (!hasRole(session, "CEO") && !isSuperAdmin(session)) {
    return Response.json({ error: `อนุมัติได้เฉพาะ ${ceo} เท่านั้น` }, { status: 403 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { decision?: string } | null;
  if (body?.decision !== "approved" && body?.decision !== "rejected") {
    return Response.json({ error: "ระบุผลการพิจารณาไม่ถูกต้อง" }, { status: 400 });
  }

  const result = await decidePenaltyRequest(session.orgId, id, body.decision, session.userId);
  if (result.error !== null) return Response.json({ error: result.error }, { status: 400 });

  const { data: existing, version } = await readStore<AppNotification[]>(session.orgId, NOTIFICATIONS_KEY);
  const r = result.request;
  const deadline = r.awaitingPost
    ? retroSubmitDeadline(r.day, await loadScorePeriodConfig(session.orgId)).getTime() - 60_000
    : 0;
  const deadlineText = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(deadline));
  const topic = r.awaitingPost
    ? (await readStore<{ topics?: ReportTopic[] }>(session.orgId, "report-feed")).data?.topics?.find((t) => t.id === r.topicId)
    : undefined;
  const round = topic ? effectiveRoundsOf(topic).find((x) => x.id === r.roundId) : undefined;
  const where = `${topic ? ` ห้อง ${topic.name}` : ""}${round ? ` รอบ "${round.label}" (${round.time})` : ""}`;
  const message =
    body.decision !== "approved"
      ? `คำร้องขอแก้ไขคะแนนของคุณไม่ได้รับการอนุมัติ`
      : r.awaitingPost
        ? `อนุมัติให้ส่งรีพอตย้อนหลังแล้ว — รีพอตวันที่ ${reportDayText(r.day)}${where} กดเพื่อส่งเลย ส่งได้ถึง ${deadlineText} ส่งแล้วได้คืน ${Math.abs(r.points)} คะแนน`
        : `คำร้องขอแก้ไขคะแนนของคุณได้รับการอนุมัติแล้ว — คืนคะแนนให้แล้ว`;
  const fresh: AppNotification[] = [
    {
      id: `notif-penalty-decided-${result.request.id}`,
      userId: result.request.userId,
      byUserId: session.userId,
      message,
      link: r.awaitingPost ? `/chat-report/report-feed?topic=${encodeURIComponent(r.topicId)}&retro=${encodeURIComponent(r.id)}` : "/hr/my-score",
      createdAt: new Date().toISOString(),
      read: false,
    },
  ];
  await writeStore(session.orgId, NOTIFICATIONS_KEY, [...fresh, ...(existing ?? [])], version, session.userId);

  return Response.json({ ok: true, request: result.request });
}
