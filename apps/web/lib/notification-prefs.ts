import "server-only";
import { prisma } from "@smartboss/database";
import { DEFAULT_PREFS, isTopicOn, normalizePrefs, type NotifPrefs } from "@/modules/notifications/prefs";

/**
 * อ่าน/บันทึกค่าตั้งแจ้งเตือนรายคน (core.notification_preferences) ฝั่งเซิร์ฟเวอร์ — ใช้ตัดสินก่อนเด้ง/ส่ง
 * Web Push/LINE (maintenance/data/notify.ts's notifyUser, report_task's org-store announce)
 *
 * จำไว้ในหน่วยความจำ 60 วิ ต่อคน — แจ้งเตือนหนึ่งเรื่องอาจส่งหลายสิบคนพร้อมกัน ไม่ต้องอ่านฐานข้อมูลทุกครั้ง
 * บันทึกแล้วล้างของคนนั้นทันที (เซิร์ฟเวอร์ตัวเดียว — ถ้าวันหนึ่งมีหลายตัว ค่าใหม่มีผลช้าสุด 60 วิ)
 *
 * อ่านไม่ได้ (ตารางยังไม่มีเพราะยังไม่รัน migration, ฐานข้อมูลสะดุด) = ถือว่า "เห็นทั้งหมด" เสมอ —
 * แจ้งเตือนต้องไม่หายเงียบเพราะค่าตั้งพัง
 */

const TTL_MS = 60_000;
const store = globalThis as unknown as { __notifPrefsCache?: Map<string, { prefs: NotifPrefs; at: number }> };
const cache = (store.__notifPrefsCache ??= new Map());

function rowToPrefs(row: { level: string; overrides: unknown; since: unknown; bannerDismissedAt: Date | null }): NotifPrefs {
  return normalizePrefs({
    level: row.level,
    overrides: row.overrides,
    since: row.since,
    bannerDismissedAt: row.bannerDismissedAt?.toISOString() ?? null,
  });
}

/** ค่าตั้งของหลายคนพร้อมกัน — คนที่ไม่มีแถว/อ่านไม่ได้ = ค่าเริ่มต้น */
export async function loadNotificationPrefs(orgId: string, userIds: string[]): Promise<Map<string, NotifPrefs>> {
  const out = new Map<string, NotifPrefs>();
  const now = Date.now();
  const missing: string[] = [];
  for (const id of new Set(userIds)) {
    const hit = cache.get(id);
    if (hit && now - hit.at < TTL_MS) out.set(id, hit.prefs);
    else missing.push(id);
  }
  if (missing.length === 0) return out;
  try {
    const rows = await prisma.notificationPreference.findMany({
      where: { orgId, userId: { in: missing } },
      select: { userId: true, level: true, overrides: true, since: true, bannerDismissedAt: true },
    });
    const byId = new Map(rows.map((r) => [r.userId, rowToPrefs(r)]));
    for (const id of missing) {
      const prefs = byId.get(id) ?? DEFAULT_PREFS;
      cache.set(id, { prefs, at: now });
      out.set(id, prefs);
    }
  } catch (err) {
    console.error("[notification-prefs] load failed — falling back to defaults", err);
    for (const id of missing) out.set(id, DEFAULT_PREFS);
  }
  return out;
}

export async function getNotificationPrefs(orgId: string, userId: string): Promise<NotifPrefs> {
  return (await loadNotificationPrefs(orgId, [userId])).get(userId) ?? DEFAULT_PREFS;
}

/** หัวข้อนี้คนนี้เปิดไว้ไหม (ไว้ตัดสินก่อนเด้ง/ส่งออกนอกแอป) — พังเมื่อไรตอบ "เปิด" */
export async function wantsTopic(orgId: string, userId: string, topicId: string): Promise<boolean> {
  try {
    return isTopicOn(await getNotificationPrefs(orgId, userId), topicId);
  } catch {
    return true;
  }
}

export async function saveNotificationPrefs(orgId: string, userId: string, raw: unknown): Promise<NotifPrefs> {
  const prefs = normalizePrefs(raw);
  const data = {
    level: prefs.level,
    overrides: prefs.overrides,
    since: prefs.since,
    bannerDismissedAt: prefs.bannerDismissedAt ? new Date(prefs.bannerDismissedAt) : null,
  };
  await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, orgId, ...data },
    update: { orgId, ...data },
  });
  cache.set(userId, { prefs, at: Date.now() });
  return prefs;
}
