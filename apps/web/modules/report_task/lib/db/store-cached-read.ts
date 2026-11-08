import "server-only";

import { readStore, readStoreVersion, type StoreRead } from "@/modules/report_task/lib/db/org-store";
import { DELTA_KEYS, rememberSnapshot, snapshotAt } from "@/modules/report_task/lib/db/store-delta-log";

/**
 * อ่านคีย์ก้อนใหญ่ (ฟีดรายงาน) โดยใช้ชุดที่จำไว้ในหน่วยความจำถ้ายังเป็นเวอร์ชันล่าสุด — ถามแค่เลขเวอร์ชันจากฐานข้อมูล
 * ไม่ต้องดึง/แปลง JSON หลาย MB ทุกรอบ (ตัวหักคะแนนรายงานอ่านทุก 30 วิ ต่อบริษัท)
 * ผู้เรียกห้ามแก้ไขข้อมูลที่ได้ไป (เป็นชุดเดียวกับที่ store-delta-log ถืออยู่)
 */
export async function readStoreCached<T>(orgId: string, key: string): Promise<StoreRead<T>> {
  if (!DELTA_KEYS.has(key)) return readStore<T>(orgId, key);
  const version = await readStoreVersion(orgId, key);
  const cached = snapshotAt(orgId, key, version);
  if (cached !== undefined) return { data: cached as T, version };
  const fresh = await readStore<T>(orgId, key);
  rememberSnapshot(orgId, key, fresh.version, fresh.data);
  return fresh;
}
