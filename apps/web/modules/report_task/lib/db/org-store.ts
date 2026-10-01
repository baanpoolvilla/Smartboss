import "server-only";
import { prisma } from "@smartboss/database";
import { announceNotification } from "@/lib/notify-push";
import { publishToOrg, publishToUsers } from "@/lib/realtime/server";

import { fileForStoreKey, type StoreKey } from "./store-registry";

/**
 * ที่เก็บข้อมูลของโมดูลรายงานและงาน — Postgres แยกตามบริษัท
 *
 * มาแทน json-store.ts / tasks-repo.ts ของต้นทาง ที่เขียนลงไฟล์ JSON ใน data/
 * ซึ่งใช้กับระบบหลายบริษัทไม่ได้ (ทุกบริษัทจะเห็นไฟล์เดียวกัน) และเขียนไม่ได้
 * บน serverless
 *
 * สัญญากับฝั่ง client ไม่เปลี่ยนเลย — ยังเป็น "อ่านทั้งก้อน / เขียนทั้งก้อน"
 * พร้อม version สำหรับกันสองแท็บเขียนทับกัน จึงไม่ต้องแก้ UI หรือ store ใด ๆ
 */

/** คีย์ที่อนุญาต = whitelist เดิมของต้นทาง + tasks ที่มี route แยก */
export function isValidStoreKey(key: string): boolean {
  return key === "tasks" || fileForStoreKey(key) !== null;
}

export type { StoreKey };

export interface StoreRead<T> {
  /** null = บริษัทนี้ยังไม่เคยบันทึกคีย์นี้ */
  data: T | null;
  version: number;
}

export async function readStore<T>(orgId: string, key: string): Promise<StoreRead<T>> {
  const row = await prisma.reportTaskStore.findUnique({
    where: { orgId_key: { orgId, key } },
    select: { data: true, version: true },
  });
  return row ? { data: row.data as T, version: row.version } : { data: null, version: 0 };
}

/** แค่เลข version ของคีย์ (0 = ยังไม่เคยบันทึก) — ให้ poll เช็คว่ามีอะไรใหม่ไหม
 * โดยไม่ต้องดึง data ทั้งก้อน (ฟีดรายงานใหญ่หลาย MB) */
export async function readStoreVersion(orgId: string, key: string): Promise<number> {
  const row = await prisma.reportTaskStore.findUnique({
    where: { orgId_key: { orgId, key } },
    select: { version: true },
  });
  return row?.version ?? 0;
}

export type StoreWrite =
  | { ok: true; version: number }
  | { ok: false; conflict: true; currentVersion: number };

/**
 * เขียนทั้งก้อน พร้อมตรวจ optimistic concurrency
 *
 * expectedVersion = null → เขียนทับโดยไม่ตรวจ (ใช้ตอน client ยังไม่เคยอ่าน)
 * ไม่ตรงกับที่เก็บอยู่ → คืน conflict ให้ client โหลดใหม่ (ตอบ 409)
 *
 * ใช้ updateMany ที่มี version ในเงื่อนไข ทำให้การตรวจกับการเขียนเป็นก้าวเดียว
 * ถ้าแยกเป็น read-then-write สองคำขอที่มาพร้อมกันจะผ่านการตรวจทั้งคู่แล้วทับกัน
 */
export async function writeStore(
  orgId: string,
  key: string,
  data: unknown,
  expectedVersion: number | null,
  updatedBy?: string
): Promise<StoreWrite> {
  // แจ้งเตือนของงาน/รายงาน: เทียบก้อนเก่ากับก้อนใหม่ แล้วเด้ง/มีเสียงให้ผู้รับทันที — ทำที่นี่ที่เดียว
  // เพราะมีหลายทางที่บันทึกคีย์นี้ (หน้าเว็บ PUT, ตัวเตือนใกล้ถึงกำหนด, สรุปงาน, คำขอแก้คะแนน ฯลฯ)
  if (key === NOTIFICATIONS_KEY) {
    const before = await readStore<unknown>(orgId, key);
    const pruned = pruneNotifications(data);
    const result = await writeStoreRaw(orgId, key, pruned, expectedVersion, updatedBy);
    if (result.ok) {
      announceNewNotifications(orgId, before.data, pruned);
      // แจ้งเตือนเป็นของรายคน — บอกเฉพาะคนที่ของตัวเองเปลี่ยน ไม่ปลุกทั้งบริษัท
      try {
        const changed = changedNotificationOwners(before.data, pruned);
        if (changed.length > 0) publishToUsers(changed, { type: "store.changed", key, version: result.version });
      } catch {
        // ท่อสดพลาดต้องไม่ทำให้การบันทึกพลาดตาม
      }
    }
    return result;
  }
  const result = await writeStoreRaw(orgId, key, data, expectedVersion, updatedBy);
  if (result.ok) announceStoreChanged(orgId, key, result.version);
  return result;
}

/**
 * บอกทุกแท็บในบริษัททันทีว่าคีย์นี้เปลี่ยนเป็นรุ่นไหน (ผ่านท่อสด /api/realtime) —
 * ส่งแค่ชื่อคีย์กับเลขรุ่น ไม่มีข้อมูล แท็บที่ถือรุ่นเก่ากว่าค่อยดึงเอง (ServerStoreSync)
 * แทนการให้ทุกแท็บถามซ้ำทุก 4 วินาที — ส่งไม่ถึงก็ไม่เป็นไร poll สำรองยังเก็บตกให้
 */
function announceStoreChanged(orgId: string, key: string, version: number) {
  try {
    publishToOrg(orgId, { type: "store.changed", key, version });
  } catch {
    // ท่อสดพลาดต้องไม่ทำให้การบันทึกพลาดตาม
  }
}

const NOTIFICATIONS_KEY = "notifications";

/** เก็บแจ้งเตือนไว้กี่วัน / กี่รายการต่อคน — ก่อนหน้านี้ไม่เคยลบเลย ก้อนโตถึง 1.6 MB */
const NOTIFICATION_RETENTION_DAYS = 60;
const NOTIFICATION_MAX_PER_USER = 300;

interface OwnedNotification {
  id?: unknown;
  userId?: unknown;
  createdAt?: unknown;
  read?: unknown;
}

/** ตัดแจ้งเตือนเก่าเกินกำหนด + เกินโควตาต่อคน (เก็บรายการใหม่สุด) — ของที่ไม่ใช่อาร์เรย์คืนเดิม */
export function pruneNotifications(data: unknown, now: number = Date.now()): unknown {
  if (!Array.isArray(data)) return data;
  const cutoff = now - NOTIFICATION_RETENTION_DAYS * 86_400_000;
  const sorted = [...(data as OwnedNotification[])].sort((a, b) =>
    String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? ""))
  );
  const perUser = new Map<string, number>();
  return sorted.filter((n) => {
    const t = Date.parse(String(n?.createdAt ?? ""));
    if (Number.isFinite(t) && t < cutoff) return false;
    const owner = String(n?.userId ?? "");
    const count = (perUser.get(owner) ?? 0) + 1;
    perUser.set(owner, count);
    return count <= NOTIFICATION_MAX_PER_USER;
  });
}

/** userId ที่แจ้งเตือนของตัวเองเพิ่ม/หาย/เปลี่ยนสถานะอ่าน ระหว่างก้อนเก่ากับใหม่ */
function changedNotificationOwners(beforeData: unknown, afterData: unknown): string[] {
  const sig = (data: unknown) => {
    const m = new Map<string, string>();
    for (const n of Array.isArray(data) ? (data as OwnedNotification[]) : []) {
      if (typeof n?.id === "string") m.set(n.id, `${String(n.userId)}|${n.read === true}`);
    }
    return m;
  };
  const a = sig(beforeData);
  const b = sig(afterData);
  const owners = new Set<string>();
  for (const [id, v] of a) if (b.get(id) !== v) owners.add(v.split("|")[0]!);
  for (const [id, v] of b) if (a.get(id) !== v) owners.add(v.split("|")[0]!);
  return [...owners].filter((u) => u && u !== "undefined");
}

/**
 * บันทึกแจ้งเตือนจากเครื่องของผู้ใช้คนหนึ่ง — เครื่องถือแค่ของตัวเอง (GET ส่งให้เฉพาะ
 * ของเจ้าของ) จึงเขียนทับทั้งก้อนตรง ๆ ไม่ได้ ไม่งั้นของคนอื่นหายหมด รวมให้ที่นี่:
 *   - ของตัวเอง: ใช้ตามที่เครื่องส่งมา (อ่านแล้ว/ลบ/ใหม่)
 *   - ของคนอื่นที่เครื่องเพิ่งสร้าง (มอบหมายงาน แท็ก ตอบกลับ ...): เพิ่มเข้าไป
 *   - ของคนอื่นที่มีอยู่แล้ว: คงไว้ แก้จากเครื่องคนอื่นไม่ได้
 * เครื่องที่ถือรุ่นล่าสุด (expectedVersion ตรง) = ของตัวเองใช้ตามที่ส่งมาทั้งหมด รวมการลบ
 * เครื่องที่ถือรุ่นเก่ากว่า (มีแจ้งเตือนใหม่เข้ามาหลังเครื่องนั้นโหลด หรือเปิดอีกเครื่อง) =
 * ไม่ลบอะไรเลย แค่เพิ่ม/อัปเดต และ "อ่านแล้ว" ไม่ย้อนกลับ — กันแจ้งเตือนที่เครื่องยังไม่เคย
 * เห็นหายไปเพราะเครื่องนั้นส่งรายการเก่ากลับมา ไม่ตอบ 409 ให้เครื่อง (รวมรายคนแล้วไม่มีทาง
 * ทับของคนอื่น) อ่าน-รวม-เขียนพร้อมตรวจรุ่นเอง ชนกันก็ลองใหม่
 */
export async function writeOwnNotifications(
  orgId: string,
  userId: string,
  incoming: unknown,
  expectedVersion: number | null
): Promise<StoreWrite> {
  const sent = (Array.isArray(incoming) ? (incoming as OwnedNotification[]) : []).filter(
    (n) => n && typeof n.id === "string" && typeof n.userId === "string"
  );
  const sentMine = sent.filter((n) => n.userId === userId);
  let last: StoreWrite = { ok: false, conflict: true, currentVersion: 0 };
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await readStore<OwnedNotification[]>(orgId, NOTIFICATIONS_KEY);
    const stored = Array.isArray(current.data) ? current.data : [];
    const storedIds = new Set(stored.map((n) => n?.id));
    const storedMine = stored.filter((n) => n?.userId === userId);

    let myItems: OwnedNotification[];
    if (expectedVersion !== null && expectedVersion === current.version) {
      myItems = sentMine;
    } else {
      const storedById = new Map(storedMine.map((n) => [n.id, n]));
      const sentIds = new Set(sentMine.map((n) => n.id));
      myItems = [
        ...sentMine.map((n) => {
          const prev = storedById.get(n.id);
          return prev?.read === true && n.read !== true ? { ...n, read: true } : n;
        }),
        ...storedMine.filter((n) => !sentIds.has(n.id)),
      ];
    }

    const merged = [
      ...myItems,
      ...sent.filter((n) => n.userId !== userId && !storedIds.has(n.id)),
      ...stored.filter((n) => n?.userId !== userId),
    ];
    last = await writeStore(orgId, NOTIFICATIONS_KEY, merged, current.version || null, userId);
    if (last.ok) return last;
  }
  return last;
}

/** แจ้งเตือนเฉพาะของผู้ใช้คนนี้ — ให้ GET ส่งไปที่เครื่อง (ของคนอื่นไม่ออกจากเซิร์ฟเวอร์) */
export function ownNotifications(data: unknown, userId: string): unknown {
  return Array.isArray(data) ? (data as OwnedNotification[]).filter((n) => n?.userId === userId) : data;
}

interface StoredNotification {
  id?: unknown;
  userId?: unknown;
  byUserId?: unknown;
  message?: unknown;
  read?: unknown;
  link?: unknown;
  kind?: unknown;
  topicName?: unknown;
}

/** แถวที่เพิ่งเพิ่มในรอบนี้ → เด้งถึงผู้รับ */
function announceNewNotifications(orgId: string, beforeData: unknown, afterData: unknown) {
  if (!Array.isArray(afterData)) return;
  const known = new Set(
    (Array.isArray(beforeData) ? (beforeData as StoredNotification[]) : []).map((n) => n?.id).filter((id) => typeof id === "string")
  );
  const fresh = (afterData as StoredNotification[])
    .filter(
      (n) =>
        n &&
        typeof n.id === "string" &&
        !known.has(n.id) &&
        typeof n.userId === "string" &&
        // ตัวเองทำถึงตัวเอง = ไม่ต้องเด้ง (ตัวเตือนอัตโนมัติ byUserId = "system" ยังเด้งตามปกติ)
        n.userId !== n.byUserId &&
        n.read !== true &&
        // "room_post" = สรุปทุกโพสต์ให้เจ้าของดูภาพรวม ไม่ใช่เรื่องถึงตัว — อยู่ในกระดิ่งแต่ไม่เด้ง
        n.kind !== "room_post"
    )
    // กันก้อนแปลก ๆ (เช่น เครื่องเก่าบันทึกทับ) ยิงเป็นร้อย — ของจริงต่อครั้งมีไม่กี่แถว
    .slice(0, 100);
  for (const n of fresh) {
    const message = typeof n.message === "string" ? n.message : "มีแจ้งเตือนใหม่";
    void announceNotification(orgId, [n.userId as string], {
      title: typeof n.topicName === "string" && n.topicName ? n.topicName : "SmartBoss",
      body: message.slice(0, 160),
      url: typeof n.link === "string" && n.link.startsWith("/") ? n.link : "/notifications",
      tag: `rn-${n.id as string}`,
    });
  }
}

async function writeStoreRaw(
  orgId: string,
  key: string,
  data: unknown,
  expectedVersion: number | null,
  updatedBy?: string
): Promise<StoreWrite> {
  const value = data as never;

  if (expectedVersion === null || expectedVersion === 0) {
    // ยังไม่มีแถว หรือผู้เรียกยอมให้ทับ — upsert ได้เลย
    const row = await prisma.reportTaskStore.upsert({
      where: { orgId_key: { orgId, key } },
      create: { orgId, key, data: value, version: 1, updatedBy: updatedBy ?? null },
      update: { data: value, version: { increment: 1 }, updatedBy: updatedBy ?? null },
      select: { version: true },
    });
    return { ok: true, version: row.version };
  }

  const updated = await prisma.reportTaskStore.updateMany({
    where: { orgId, key, version: expectedVersion },
    data: { data: value, version: { increment: 1 }, updatedBy: updatedBy ?? null },
  });

  if (updated.count === 0) {
    const current = await readStore(orgId, key);
    return { ok: false, conflict: true, currentVersion: current.version };
  }
  return { ok: true, version: expectedVersion + 1 };
}

/** ล้างคีย์นี้ของบริษัท (ปุ่ม "รีเซ็ตข้อมูล" ในหน้าตั้งค่า) */
export async function clearStore(orgId: string, key: string): Promise<void> {
  await prisma.reportTaskStore.deleteMany({ where: { orgId, key } });
}

/**
 * สร้างแถวใหม่แบบ atomic จริง — สำหรับตอนที่ "ใครมาก่อนชนะ" สำคัญจริงแม้แถว
 * ยังไม่เคยมีมาก่อนเลย (เช่น ตัวนับที่หลายคำขอแย่งจองพร้อมกันตั้งแต่ครั้งแรก)
 *
 * ⚠ `writeStore(orgId, key, data, null)` **ไม่ใช่ CAS ตอนแถวยังไม่มี** — เป็น
 * upsert เฉยๆ (ตั้งใจไว้สำหรับเคสปกติ: client คนเดียวเขียนครั้งแรกหลังยังไม่
 * เคยอ่านมาก่อน) ถ้าหลายคำขอแข่งกันตอนยังไม่มีแถวเลย (`readStore` คืน
 * `version: 0` ให้ทุกคนเหมือนกัน) จะไม่มีใครถูกปฏิเสธเลยสักคำขอ — upsert
 * ทับกันไปเรื่อยๆ เงียบๆ ไม่ throw ไม่ conflict เจอจริงตอนเขียนเทสต์
 * concurrency ของ AI Insight quota (fix-list ข้อ 2): 25 reservation พร้อมกัน
 * ผ่านหมดทั้ง 25 ทั้งที่โควตามีแค่ 10
 *
 * ฟังก์ชันนี้ใช้ unique constraint ของ `(orgId, key)` เป็นตัวตัดสินแทน —
 * `create()` ตรงๆ ชนกันจริงจะได้ P2002 (unique violation) จาก Postgres เอง
 * ไม่ใช่แค่เทียบ version ในแอป
 */
export async function createStoreIfAbsent(
  orgId: string,
  key: string,
  data: unknown,
  updatedBy?: string
): Promise<StoreWrite> {
  try {
    const row = await prisma.reportTaskStore.create({
      data: { orgId, key, data: data as never, version: 1, updatedBy: updatedBy ?? null },
      select: { version: true },
    });
    return { ok: true, version: row.version };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      // อีกคำขอสร้างแถวนี้ไปแล้วก่อนเรา — ให้ผู้เรียกอ่านใหม่แล้วลองทางที่
      // ถูกสำหรับแถวที่มีอยู่แล้ว (writeStore ด้วย version จริง)
      const current = await readStore(orgId, key);
      return { ok: false, conflict: true, currentVersion: current.version };
    }
    throw err;
  }
}
