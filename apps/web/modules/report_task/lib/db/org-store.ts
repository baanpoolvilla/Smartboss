import "server-only";
import { prisma } from "@smartboss/database";

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
