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
 * ผู้รับแจ้งเตือนกลาง: ผู้ดูแลบ้านของบ้านนั้น + ผู้จัดการ/ผู้บริหารทั้งหมด
 * (port จาก _getPropertyCaretaker + _getManagersAndAdmins)
 */
export async function managersAndCaretaker(
  orgId: string,
  propertyId?: string | null
): Promise<string[]> {
  const ids = new Set<string>();

  if (propertyId) {
    const prop = await prisma.property.findFirst({
      where: { orgId, id: propertyId },
      select: { caretakerId: true },
    });
    if (prop?.caretakerId) ids.add(prop.caretakerId);
  }

  const managers = await prisma.user.findMany({
    where: {
      orgId,
      isActive: true,
      roles: {
        some: { role: { code: { in: ["SUPER_ADMIN", "CEO", "MANAGER"] } } },
      },
    },
    select: { id: true },
  });
  for (const m of managers) ids.add(m.id);

  return Array.from(ids);
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
