import "server-only";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";

// ─── In-app notifications (core.notifications) ───────────

export interface NotifyInput {
  title: string;
  body?: string | null;
  type?: string;
  referenceId?: string | null;
  /** ส่ง LINE ด้วย (ถ้าบริษัทตั้งค่า + user ผูก LINE) */
  line?: string;
}

/**
 * ชื่อคนที่เป็นต้นเรื่องของการแจ้งเตือน ไว้เอาไปขึ้นต้นหัวข้อ
 *
 * กระดิ่งของคนที่ต้องอนุมัติ/ดูแลงาน มักมีเรื่องค้างพร้อมกันหลายอันที่หัวข้อ
 * เหมือนกันเป๊ะ ("มีคำขอลาใหม่รออนุมัติ" เรียงกัน 7 บรรทัด) ถ้าไม่มีชื่อกำกับ
 * ก็แยกไม่ออกว่าอันไหนของใคร ต้องกดเข้าไปดูทีละอัน ("อยากให้บอกด้วยว่าใคร
 * เป็นคนขอ...รวมถึงอันอื่น ๆ ที่ไม่มีชื่อด้วย")
 *
 * คืน null เมื่อหาไม่เจอ/คิวรีพลาด แล้วให้ผู้เรียกกลับไปใช้หัวข้อแบบไม่มีชื่อ —
 * แจ้งเตือนที่ไม่มีชื่อยังดีกว่าไม่ได้แจ้งเลย
 */
export async function notifyActorName(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return user?.name?.trim() || null;
  } catch {
    return null;
  }
}

/** แจ้งเตือนผู้ใช้ 1 คน (in-app + LINE ถ้ามี line) */
export async function notifyUser(
  orgId: string,
  userId: string | null | undefined,
  input: NotifyInput
) {
  if (!userId) return;
  await prisma.notification.create({
    data: {
      orgId,
      userId,
      title: input.title,
      body: input.body ?? null,
      type: input.type ?? "general",
      referenceId: input.referenceId ?? null,
    },
  });
  if (input.line) await sendLine(orgId, userId, input.line);
}

/** แจ้งเตือนหลายคนพร้อมกัน (ตัดคนซ้ำออก) */
export async function notifyUsers(
  orgId: string,
  userIds: (string | null | undefined)[],
  input: NotifyInput
) {
  const ids = Array.from(new Set(userIds.filter((x): x is string => !!x)));
  for (const id of ids) await notifyUser(orgId, id, input);
}

/**
 * ผู้ดูแลบ้านของทรัพย์สินนั้น (ถ้ามี) — เดิมฟังก์ชันนี้ยิงแจ้งเตือนให้
 * MANAGER/CEO/SUPER_ADMIN "ทุกคน" ในบริษัทด้วย ไม่ว่าจะรับผิดชอบบ้านหลังนั้น
 * จริงไหม ทำให้หัวหน้าคนหนึ่งเห็นแจ้งเตือน PM/ใบงานของทุกบ้านทั้งบริษัทแม้
 * เปิดแท็บ "เฉพาะฉัน" อยู่ — ตัดส่วนนั้นออก เหลือแค่คนรับผิดชอบบ้านนั้นจริง ๆ
 * ผู้เรียกที่ต้องการแจ้งคนอื่นเพิ่ม (ผู้รับมอบหมาย, cc, ผู้สร้างงาน) ให้ส่งมา
 * รวมกันเองที่ต้นทาง (ดู cron.ts, work-orders/actions.ts)
 */
export async function propertyCaretaker(
  orgId: string,
  propertyId?: string | null
): Promise<string[]> {
  if (!propertyId) return [];
  const prop = await prisma.property.findFirst({
    where: { orgId, id: propertyId },
    select: { caretakerId: true },
  });
  return prop?.caretakerId ? [prop.caretakerId] : [];
}

// Notification.orgId คือ metadata ว่า "เรื่องนี้เกี่ยวกับบริษัทไหน" ไม่ใช่เส้น
// แบ่งว่าใครอ่านได้ — เส้นแบ่งจริงคือ userId ที่ทุก query ด้านล่างผูกไว้แล้ว
// (ผู้รับคนเดียว) การกรองซ้ำด้วย orgId ของผู้รับจะพังกับ platform user ที่
// userId ไม่มี orgId ผูกเลย (เช่น super admin — ดู apps/web/lib/nav.ts) จึงห่อ
// ด้วย crossOrg แทนที่จะเติม orgId ผิดความหมาย

export function listNotifications(userId: string) {
  return crossOrg("notification:recipient-scoped-not-org-scoped", () =>
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
  );
}

/**
 * ภาพรวม "วันนี้มีอะไรเกิดขึ้นบ้าง" ทั้งบริษัท — สำหรับเจ้าของบริษัทเท่านั้น
 * (เช็คสิทธิ์ที่ผู้เรียก ดู /api/notifications/maintenance's GET) ต่างจาก
 * listNotifications ข้างบนตรงที่นี่**ไม่ผูก userId** ตั้งใจ — ขอบเขตจริงคือ
 * "ทุกคนในบริษัทนี้" ไม่ใช่ผู้รับคนเดียว จึงกรองด้วย orgId ตรง ๆ แทน (ผ่าน
 * tenant-guard ปกติ ไม่ต้องใช้ crossOrg เพราะนี่คือ query ที่มี orgId จริง ๆ)
 *
 * อ่านอย่างเดียว — เจตนาคือ "รู้ว่าเกิดอะไรขึ้น" ไม่ใช่กล่องแจ้งเตือนของ
 * เจ้าของบริษัทเอง จึงไม่มี readAt/markRead ให้ที่นี่: แถวพวกนี้เป็นของคนอื่น
 * (พนักงานที่ได้รับแจ้งเตือนจริง) การให้เจ้าของบริษัทมากดอ่านแทนจะไปเปลี่ยน
 * สถานะที่เจ้าของแจ้งเตือนจริงเห็นด้วยโดยที่เขาไม่รู้ตัว — ฝั่ง client
 * (use-unified-notifications.ts) จึงต้องไม่เรียก markRead กับแถวจากฟังก์ชันนี้
 * เด็ดขาด
 */
export function listOrgNotifications(orgId: string, excludeUserId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { orgId, userId: { not: excludeUserId } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export function unreadCount(userId: string) {
  return crossOrg("notification:recipient-scoped-not-org-scoped", () =>
    prisma.notification.count({ where: { userId, readAt: null } })
  );
}

export async function markAllRead(userId: string) {
  await crossOrg("notification:recipient-scoped-not-org-scoped", () =>
    prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    })
  );
}

/** ทำเครื่องหมายอ่านทีละรายการ — `where` ผูก userId ไว้ด้วยเสมอ กัน user คนหนึ่ง
 * ยิง id ของอีกคนมาแล้วมาร์คอ่านแจ้งเตือนที่ไม่ใช่ของตัวเอง */
export async function markRead(userId: string, id: string) {
  await crossOrg("notification:recipient-scoped-not-org-scoped", () =>
    prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    })
  );
}

/**
 * มาร์คอ่านทุกแจ้งเตือนของ `userId` ที่ชี้ไปเรื่องเดียวกัน (`referenceId`) —
 * ใช้ตอนเปิดหน้ารายละเอียดของเรื่องนั้นตรงๆ (เช่น หน้าใบงาน) ที่ referenceId
 * ก็คือ id ของหน้านั้นเอง ("เปิดเข้ามาหน้าที่มีแจ้งเตือนแล้ว แจ้งเตือนมันไม่หาย")
 * — ผู้ใช้เห็นเนื้อหาที่แจ้งเตือนพูดถึงอยู่ตรงหน้าแล้ว ไม่ต้องรอให้กดที่กระดิ่งอีก
 */
export async function markReadByReference(userId: string, referenceId: string) {
  await crossOrg("notification:recipient-scoped-not-org-scoped", () =>
    prisma.notification.updateMany({
      where: { referenceId, userId, readAt: null },
      data: { readAt: new Date() },
    })
  );
}

/**
 * ลบแจ้งเตือนทุกอันที่ชี้ไปเรื่องนี้ — เรียกตอนลบเรื่องต้นทาง (ใบงาน/PO/ตั๋ว)
 * ไม่งั้นกระดิ่งค้างชี้ไปหน้าที่ไม่มีอยู่แล้ว ("ลบไปแล้วแต่ทำไมแจ้งเตือนยังขึ้น"
 * — บั๊กคลาสเดียวกับที่ report_task เจอกับ removeTaskNotifications แต่ฝั่งนี้
 * ไม่เคยมีการเก็บกวาดแบบนี้มาก่อนเลยสักจุด: deleteWorkOrderAction/deletePoAction/
 * adminDeleteTicket ลบแถวต้นทางแล้วไม่เคยแตะ core.notifications เลย)
 *
 * ไม่ผูก orgId ตรง ๆ (เหตุผลเดียวกับ markReadByReference ข้างบน — referenceId
 * เป็น cuid ที่ unique ทั้งระบบอยู่แล้ว ไม่มีทางชนข้ามบริษัท/ข้ามชนิดเรื่อง)
 * `type` เป็นตัวเลือกไว้ให้แคบลงอีกชั้นเมื่อจำเป็น (เช่น "issue_ticket_new" ที่
 * referenceId เก็บเป็น "orgId:ticketId" ไม่ใช่ referenceId เปล่า ๆ — ผู้เรียก
 * ต้องรู้ตัวเองว่ารูปแบบไหนใช้กับ type ไหน ดู maintenanceHrefFor ใน derive.ts)
 */
export async function deleteNotificationsByReference(referenceId: string, type?: string | string[]) {
  await crossOrg("notification:recipient-scoped-not-org-scoped", () =>
    prisma.notification.deleteMany({
      where: { referenceId, ...(type ? { type: Array.isArray(type) ? { in: type } : type } : {}) },
    })
  );
}

// ─── LINE Messaging (per-org config) ─────────────────────

export function getLineConfig(orgId: string) {
  return prisma.lineConfig.findUnique({ where: { orgId } });
}

export async function upsertLineConfig(
  orgId: string,
  channelAccessToken: string | null,
  enabled: boolean
) {
  await prisma.lineConfig.upsert({
    where: { orgId },
    update: { channelAccessToken, enabled },
    create: { orgId, channelAccessToken, enabled },
  });
}

export function listLineLogs(orgId: string) {
  return prisma.lineNotificationLog.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

/** ส่ง LINE push ผ่าน Messaging API ของบริษัท — ล้มเหลวเงียบ + log */
export async function sendLine(
  orgId: string,
  userId: string,
  message: string
): Promise<void> {
  try {
    const cfg = await prisma.lineConfig.findUnique({ where: { orgId } });
    if (!cfg?.enabled || !cfg.channelAccessToken) return;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lineUserId: true },
    });
    if (!user?.lineUserId) return;

    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.channelAccessToken}`,
      },
      body: JSON.stringify({
        to: user.lineUserId,
        messages: [{ type: "text", text: message }],
      }),
    });
    await prisma.lineNotificationLog.create({
      data: {
        orgId,
        userId,
        lineUserId: user.lineUserId,
        message,
        success: res.ok,
        error: res.ok ? null : `HTTP ${res.status}`,
      },
    });
  } catch (e) {
    try {
      await prisma.lineNotificationLog.create({
        data: { orgId, userId, message, success: false, error: String(e) },
      });
    } catch {
      /* ignore */
    }
  }
}
