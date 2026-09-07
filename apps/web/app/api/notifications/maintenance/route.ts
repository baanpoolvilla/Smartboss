import { requireAuth } from "@smartboss/auth";
import { listNotifications, markAllRead, markRead } from "@/modules/maintenance/data/notify";

export const dynamic = "force-dynamic";

/**
 * แจ้งเตือนงานซ่อมบำรุงของผู้ใช้ที่ล็อกอินอยู่ — ให้ฝั่ง client (bell
 * popover + หน้าเต็ม /notifications) ดึงมารวมกับแจ้งเตือนของ report_task
 * ได้เป็นลิสต์เดียว (ดู modules/notifications/use-unified-notifications.ts)
 *
 * ผูก userId จาก session เท่านั้น ไม่รับ userId จาก client — กัน user คนหนึ่ง
 * ขอดู/มาร์คอ่านแจ้งเตือนของอีกคนโดยการยัด id เข้ามาเอง
 */
export async function GET() {
  try {
    const session = await requireAuth();
    const items = await listNotifications(session.userId);
    return Response.json({ items });
  } catch (err) {
    const status = (err as Error & { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
    if (status === 500) console.error("[notifications/maintenance GET]", err);
    return Response.json({ error: message }, { status });
  }
}

/** body `{ id?: string }` — มี id = มาร์คอ่านรายการนั้น, ไม่มี = มาร์คอ่านทั้งหมด */
export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const id = typeof body.id === "string" ? body.id : undefined;
    if (id) {
      await markRead(session.userId, id);
    } else {
      await markAllRead(session.userId);
    }
    return Response.json({ ok: true });
  } catch (err) {
    const status = (err as Error & { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
    if (status === 500) console.error("[notifications/maintenance POST]", err);
    return Response.json({ error: message }, { status });
  }
}
