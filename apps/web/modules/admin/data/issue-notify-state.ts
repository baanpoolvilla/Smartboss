import "server-only";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";

/** ชนิดแจ้งเตือนของระบบแจ้งบัค (ดู modules/notifications/derive.ts) */
export const ISSUE_NOTIFICATION_TYPES = ["issue_ticket_new", "issue_ticket_reply_reporter", "issue_ticket_status_reporter"];

/** referenceId เป็น "ticketId" (ฝั่งผู้แจ้ง) หรือ "orgId:ticketId" (ฝั่งทีมรับเรื่อง) */
function ticketIdOf(referenceId: string | null): string | null {
  if (!referenceId) return null;
  return referenceId.includes(":") ? (referenceId.split(":")[1] ?? null) : referenceId;
}

/** เปิดตั๋วดูแล้ว → แจ้งเตือนของตั๋วนี้ที่ยังไม่อ่านของผู้ใช้คนนี้ถือว่าอ่านแล้ว
 * (ตัวเลขแดงที่ tile/เมนูจะได้ลดลงเอง ไม่ต้องกดอ่านทีละอัน) ผูก userId เสมอ */
export async function markTicketNotificationsRead(userId: string, ticketId: string): Promise<void> {
  await crossOrg("notification:recipient-scoped-not-org-scoped", () =>
    prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        type: { in: ISSUE_NOTIFICATION_TYPES },
        OR: [{ referenceId: ticketId }, { referenceId: { endsWith: `:${ticketId}` } }],
      },
      data: { readAt: new Date() },
    })
  );
}

/** ตั๋วที่มีแจ้งเตือนยังไม่อ่านของผู้ใช้คนนี้ — ไว้ขึ้นจุดแดงบนการ์ดในหน้ารายการ */
export async function unreadIssueTicketIds(userId: string): Promise<Set<string>> {
  const rows = await crossOrg("notification:recipient-scoped-not-org-scoped", () =>
    prisma.notification.findMany({
      where: { userId, readAt: null, type: { in: ISSUE_NOTIFICATION_TYPES } },
      select: { referenceId: true },
      take: 500,
    })
  );
  return new Set(rows.map((r) => ticketIdOf(r.referenceId)).filter((x): x is string => !!x));
}
