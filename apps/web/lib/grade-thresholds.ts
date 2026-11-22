/**
 * เกณฑ์เกรดตามรอบ — เปลี่ยนเกณฑ์แล้วรอบที่ผ่านมาคงเกรดเดิม (ค่าคอมย้อนหลังไม่เปลี่ยนตาม)
 *
 * เก็บชุดเก่าไว้ใน performance_settings.grade_threshold_history = [{ until: "YYYY-MM", thresholds }]
 * รอบ (score-period.ts) ที่ ≤ until ของรายการแรกที่ครอบคลุม ใช้ชุดนั้น · เลยทุกรายการ = ชุดปัจจุบัน
 * ประวัติว่าง (ทุกบริษัทก่อนมีฟีเจอร์นี้) = ทุกรอบใช้ชุดปัจจุบันเหมือนเดิม
 */

export type GradeThresholds = [string, number][];
export interface GradeHistoryEntry {
  until: string;
  thresholds: GradeThresholds;
}

const MONTH = /^\d{4}-\d{2}$/;

export function sortThresholds(map: Record<string, number>): GradeThresholds {
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function toMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** อ่านจากฐานข้อมูล — รูปแบบผิดตัดทิ้ง · เรียงตาม until จากเก่าไปใหม่ */
export function parseGradeHistory(value: unknown): GradeHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const out: GradeHistoryEntry[] = [];
  for (const raw of value) {
    const e = raw as { until?: unknown; thresholds?: unknown };
    if (typeof e?.until !== "string" || !MONTH.test(e.until)) continue;
    const map = toMap(e.thresholds);
    if (Object.keys(map).length === 0) continue;
    out.push({ until: e.until, thresholds: sortThresholds(map) });
  }
  return out.sort((a, b) => a.until.localeCompare(b.until));
}

/** เกณฑ์ที่ใช้กับรอบ `month` */
export function thresholdsForRound(current: GradeThresholds, history: readonly GradeHistoryEntry[], month: string): GradeThresholds {
  for (const e of history) if (month <= e.until) return e.thresholds;
  return current;
}

export function sameThresholds(a: GradeThresholds, b: GradeThresholds): boolean {
  if (a.length !== b.length) return false;
  const m = new Map(a);
  return b.every(([k, v]) => m.get(k) === v);
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * ประวัติหลังบันทึกเกณฑ์ใหม่ที่มีผลตั้งแต่รอบ `effectiveFrom`
 * - เกณฑ์ไม่เปลี่ยน = ประวัติเดิม
 * - effectiveFrom = null = ใช้ทุกรอบรวมย้อนหลัง (แบบเดิมก่อนมีฟีเจอร์นี้) → ล้างประวัติ
 * - รอบก่อน effectiveFrom ได้เกณฑ์เดิมของรอบนั้นทุกรอบ (คำนวณจากประวัติ + ชุดปัจจุบันก่อนแก้)
 */
export function nextGradeHistory(
  oldCurrent: GradeThresholds,
  oldHistory: readonly GradeHistoryEntry[],
  newCurrent: GradeThresholds,
  effectiveFrom: string | null,
): GradeHistoryEntry[] {
  if (effectiveFrom === null) return [];
  if (!MONTH.test(effectiveFrom)) throw new Error("รอบที่เริ่มใช้ไม่ถูกต้อง");
  if (sameThresholds(oldCurrent, newCurrent)) return [...oldHistory];
  const until = prevMonth(effectiveFrom);
  const kept = oldHistory.filter((e) => e.until < until);
  const before = thresholdsForRound(oldCurrent, oldHistory, until);
  const last = kept[kept.length - 1];
  if (last && sameThresholds(last.thresholds, before)) {
    return [...kept.slice(0, -1), { until, thresholds: before }];
  }
  return [...kept, { until, thresholds: before }];
}

export function historyToJson(history: readonly GradeHistoryEntry[]): { until: string; thresholds: Record<string, number> }[] {
  return history.map((e) => ({ until: e.until, thresholds: Object.fromEntries(e.thresholds) }));
}

/** ชุดเกรดบวก — A+ เกิน 100 (ได้คะแนนเพิ่มจากหัวหน้า) · ที่เหลือห่างกัน 5 · ต่ำกว่า D = F */
export const PLUS_GRADE_PRESET: GradeThresholds = [
  ["A+", 101],
  ["A", 90],
  ["B+", 85],
  ["B", 80],
  ["C+", 75],
  ["C", 70],
  ["D+", 65],
  ["D", 60],
];

/**
 * ตัวคูณค่าคอมแบบเกรดเฉลี่ย — เกรดหลักห่างกัน 1 เกรดบวกอยู่ครึ่งทาง (+0.5) ต่ำกว่าทุกเกณฑ์ (F) = 0
 * A+ 4.5 · A 4 · B+ 3.5 · B 3 · C+ 2.5 · C 2 · D+ 1.5 · D 1 · F 0
 * ชุดเดิม A–D ได้ 4/3/2/1 = สัดส่วนเท่าค่าตั้งต้นเดิม (1/0.75/0.5/0.25) เงินที่แบ่งได้จึงเท่าเดิม
 */
export function halfStepWeights(rankedBestFirst: readonly string[], belowAll = "F"): Record<string, number> {
  const out: Record<string, number> = {};
  const ranked = rankedBestFirst.filter((g) => g !== belowAll);
  let prev = 0;
  let prevPlus = false;
  for (let i = ranked.length - 1; i >= 0; i--) {
    const g = ranked[i]!;
    const plus = g.endsWith("+");
    const step = prev === 0 ? 1 : plus || prevPlus ? 0.5 : 1;
    prev += step;
    prevPlus = plus;
    out[g] = prev;
  }
  out[belowAll] = 0;
  return out;
}
