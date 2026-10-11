import { requireAuth } from "@smartboss/auth";
import { getNotificationPrefs, saveNotificationPrefs } from "@/lib/notification-prefs";

export const dynamic = "force-dynamic";

/**
 * ตั้งค่าแจ้งเตือนของผู้ใช้ที่ล็อกอินอยู่ (หน้า /notifications/settings + กระดิ่ง) — ผูกกับ session
 * เท่านั้น ไม่รับ userId จาก client · ค่าที่ส่งมาถูกทำความสะอาดใน normalizePrefs (แชท/บัญชีปิดไม่ได้)
 */
export async function GET() {
  try {
    const session = await requireAuth();
    // ไม่สังกัดบริษัท (ผู้ดูแลระบบสูงสุด) ก็มีค่าตั้งของตัวเองได้ — ค่าตั้งเป็นของคน
    return Response.json({ prefs: await getNotificationPrefs(session.orgId ?? null, session.userId) });
  } catch (err) {
    const status = (err as Error & { status?: number })?.status ?? 500;
    return Response.json({ error: "โหลดตั้งค่าแจ้งเตือนไม่สำเร็จ" }, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireAuth();
    const body = (await request.json().catch(() => null)) as { prefs?: unknown } | null;
    const prefs = await saveNotificationPrefs(session.orgId ?? null, session.userId, body?.prefs);
    return Response.json({ prefs });
  } catch (err) {
    console.error("[notification-prefs] save failed", err);
    const status = (err as Error & { status?: number })?.status ?? 500;
    return Response.json({ error: "บันทึกตั้งค่าแจ้งเตือนไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status });
  }
}
