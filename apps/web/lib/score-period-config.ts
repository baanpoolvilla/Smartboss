import "server-only";

import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { normalizeScorePeriodConfig, scorePeriodReadyAt, type ScorePeriodConfig } from "@/lib/score-period";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";

/**
 * วันตัดรอบคะแนนของบริษัท (score-period.ts) — เก็บใน store ของบริษัท คีย์ "score-period"
 * (ไม่เพิ่มคอลัมน์ใน performance_settings ⇒ ไม่ต้อง migration) · ไม่เคยตั้ง = ตัดทุกวันที่ 25
 */
const KEY = "score-period";

export async function loadScorePeriodConfig(orgId: string): Promise<ScorePeriodConfig> {
  const [{ data }, latestShiftEndMinutes] = await Promise.all([readStore<unknown>(orgId, KEY), loadLatestShiftEnd(orgId)]);
  // กะที่เลิกช้าที่สุดติดไปด้วยทุกครั้ง — เวลาปิดรับของระบบ = เวลาพร้อมใช้ (score-period.ts) ต้องตรงกันทุกหน้า
  // normalizeScorePeriodConfig ไม่เก็บค่านี้ ⇒ บันทึกกลับไม่ติดลง store
  return { ...normalizeScorePeriodConfig(data), latestShiftEndMinutes };
}

export async function saveScorePeriodConfig(orgId: string, config: ScorePeriodConfig, userId: string): Promise<void> {
  const normalized = normalizeScorePeriodConfig(config);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { version, data } = await readStore<unknown>(orgId, KEY);
    const result = await writeStore(orgId, KEY, normalized, data === null ? null : version, userId);
    if (result.ok) return;
  }
  throw new Error("บันทึกวันตัดรอบไม่สำเร็จ ลองใหม่อีกครั้ง");
}

/**
 * เวลาเลิกกะที่ช้าที่สุดของบริษัท จากกะที่ HR ตั้งไว้ในระบบบุคคล (นาทีจากเที่ยงคืน · เกิน 1440 = ข้ามคืน)
 * อ่านไม่ได้ (ยังไม่มีข้อมูลฝั่ง HR) = ถือว่าไม่มีกะ
 */
async function loadLatestShiftEnd(orgId: string): Promise<number | null> {
  return withWorkforceTenant(orgId, (tx) =>
    tx.$queryRaw<{ m: number | null }[]>`
      SELECT max(end_minutes)::int AS m
      FROM workforce.shift_definitions
      WHERE status = 'ACTIVE' AND rest_day = false
    `
  )
    .then((rows) => rows[0]?.m ?? null)
    .catch(() => null);
}

/** เกรดรอบ `month` ของบริษัทพร้อมใช้ตอนไหน (scorePeriodReadyAt) — config จาก loadScorePeriodConfig มีกะติดมาแล้ว */
export async function loadScorePeriodReadyAt(orgId: string, config: ScorePeriodConfig, month: string): Promise<Date> {
  const latest = config.latestShiftEndMinutes !== undefined ? config.latestShiftEndMinutes : await loadLatestShiftEnd(orgId);
  return scorePeriodReadyAt(config, month, latest);
}
