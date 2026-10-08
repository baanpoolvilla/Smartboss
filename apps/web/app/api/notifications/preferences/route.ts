import { requireAuth } from "@smartboss/auth";
import { getNotificationPrefs, saveNotificationPrefs } from "@/lib/notification-prefs";
import { DEFAULT_PREFS } from "@/modules/notifications/prefs";

export const dynamic = "force-dynamic";

/**
 * ตั้งค่าแจ้งเตือนของผู้ใช้ที่ล็อกอินอยู่ (หน้า /notifications/settings + กระดิ่ง) — ผูกกับ session
 * เท่านั้น ไม่รับ userId จาก client · ค่าที่ส่งมาถูกทำความสะอาดใน normalizePrefs (แชท/บัญชีปิดไม่ได้)
 */
export async function GET() {
  try {
    const session = await requireAuth();
    if (!session.orgId) return Response.json({ prefs: DEFAULT_PREFS });
    return Response.json({ prefs: await getNotificationPrefs(session.orgId, session.userId) });
  } catch (err) {
    const status = (err as Error & { status?: number })?.status ?? 500;
    return Response.json({ error: "โหลดตั้งค่าแจ้งเตือนไม่สำเร็จ" }, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireAuth();
    if (!session.orgId) return Response.json({ error: "ยังไม่ได้อยู่ในบริษัท" }, { status: 400 });
    const body = (await request.json().catch(() => null)) as { prefs?: unknown } | null;
    const prefs = await saveNotificationPrefs(session.orgId, session.userId, body?.prefs);
    return Response.json({ prefs });
  } catch (err) {
    console.error("[notification-prefs] save failed", err);
    const status = (err as Error & { status?: number })?.status ?? 500;
    return Response.json({ error: "บันทึกตั้งค่าแจ้งเตือนไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status });
  }
}
