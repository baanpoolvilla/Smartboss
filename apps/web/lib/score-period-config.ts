import "server-only";

import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { normalizeScorePeriodConfig, type ScorePeriodConfig } from "@/lib/score-period";

/**
 * วันตัดรอบคะแนนของบริษัท (score-period.ts) — เก็บใน store ของบริษัท คีย์ "score-period"
 * (ไม่เพิ่มคอลัมน์ใน performance_settings ⇒ ไม่ต้อง migration) · ไม่เคยตั้ง = ตัดทุกวันที่ 25
 */
const KEY = "score-period";

export async function loadScorePeriodConfig(orgId: string): Promise<ScorePeriodConfig> {
  const { data } = await readStore<unknown>(orgId, KEY);
  return normalizeScorePeriodConfig(data);
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
