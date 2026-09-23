import { requireAuth } from "@smartboss/auth";
import { listNotifications, listOrgNotifications, markAllRead, markRead, markReadByReference } from "@/modules/maintenance/data/notify";
import { listDirectory } from "@/modules/report_task/lib/db/employee-directory";

export const dynamic = "force-dynamic";

/**
 * แจ้งเตือนงานซ่อมบำรุงของผู้ใช้ที่ล็อกอินอยู่ — ให้ฝั่ง client (bell
 * popover + หน้าเต็ม /notifications) ดึงมารวมกับแจ้งเตือนของ report_task
 * ได้เป็นลิสต์เดียว (ดู modules/notifications/use-unified-notifications.ts)
 *
 * ผูก userId จาก session เท่านั้น ไม่รับ userId จาก client — กัน user คนหนึ่ง
 * ขอดู/มาร์คอ่านแจ้งเตือนของอีกคนโดยการยัด id เข้ามาเอง
 *
 * `?scope=org` เพิ่มภาพรวม "วันนี้ทั้งบริษัทมีอะไรเกิดขึ้นบ้าง" (PM/ใบงานช่าง/
 * HR ของทุกคน) ต่อท้ายมาใน `orgItems` — ตรวจสิทธิ์ "เป็นเจ้าของบริษัทไหม" ที่
 * นี่เองจากฐานข้อมูลจริง (เดียวกับที่ report_task ใช้ตัดสิน isOwner) ไม่เชื่อ
 * flag จาก client เด็ดขาด ถ้าไม่ใช่เจ้าของก็แค่เงียบ ๆ ไม่ส่ง orgItems กลับไป
 * แทนที่จะ error — ป้องกันได้ทั้งคนพยายามยัด query param เข้ามาเอง และไม่ทำ
 * ให้แจ้งเตือนส่วนตัวธรรมดาพังไปด้วยเพราะสิทธิ์ไม่พอสำหรับส่วนเสริมนี้
 */
export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    const items = await listNotifications(session.userId);

    const wantsOrgScope = new URL(request.url).searchParams.get("scope") === "org";
    let orgItems: Awaited<ReturnType<typeof listOrgNotifications>> = [];
    if (wantsOrgScope && session.orgId) {
      const me = (await listDirectory(session.orgId)).find((u) => u.id === session.userId);
      if (me?.isOwner) {
        // แจ้งบัคเป็นเรื่องส่วนตัวของผู้แจ้ง — ไม่ให้เจ้าของบริษัทเห็นหัวข้อตั๋วของคนอื่นผ่านภาพรวมนี้
        // (การดูตั๋วทุกเรื่องย้ายไปอยู่คอนโซลแจ้งบัคของทีมรับเรื่องแล้ว)
        orgItems = (await listOrgNotifications(session.orgId, session.userId)).filter((n) => !n.type.startsWith("issue_ticket"));
      }
    }

    return Response.json({ items, orgItems });
  } catch (err) {
    const status = (err as Error & { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
    if (status === 500) console.error("[notifications/maintenance GET]", err);
    return Response.json({ error: message }, { status });
  }
}

/** body `{ id?: string }` มี id = มาร์คอ่านรายการนั้น, `{ referenceId?: string }` =
 * มาร์คอ่านทุกรายการที่ชี้ไปเรื่องเดียวกัน (เช่น เปิดหน้าใบงานที่แจ้งเตือนพูดถึงตรงๆ),
 * ไม่มีทั้งคู่ = มาร์คอ่านทั้งหมด */
export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const body = (await request.json().catch(() => ({}))) as { id?: unknown; referenceId?: unknown };
    const id = typeof body.id === "string" ? body.id : undefined;
    const referenceId = typeof body.referenceId === "string" ? body.referenceId : undefined;
    if (id) {
      await markRead(session.userId, id);
    } else if (referenceId) {
      await markReadByReference(session.userId, referenceId);
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
