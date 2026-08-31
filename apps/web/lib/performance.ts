import "server-only";
import { prisma } from "@smartboss/database";

/**
 * คะแนนผลงานรายบุคคล — ชั้นกลางที่ทุกโมดูลส่งเหตุการณ์มารวมกัน
 *
 * ทำไมต้องมี: ระบบนี้สร้างมาให้ผู้บริหารเห็นภาพรวมการทำงานของแต่ละคน
 * แต่งานของคน ๆ หนึ่งกระจายอยู่หลายโมดูล — งานในบอร์ด Kanban, ใบแจ้งซ่อม
 * ที่รับผิดชอบ, การมาสาย ถ้าแต่ละโมดูลเก็บคะแนนของตัวเองแยกกัน จะไม่มีที่ไหน
 * ตอบได้ว่า "เดือนนี้คนนี้เป็นอย่างไร"
 *
 * เก็บเป็น "เหตุการณ์" ไม่ใช่ "ยอดสะสม" — คะแนนรวมคำนวณใหม่ได้เสมอ ย้อนดูที่มา
 * ได้ทุกแต้ม และแก้ย้อนหลังได้เมื่อกฎเปลี่ยน
 *
 * ⚠ ตัวเลขทุกตัวที่ใช้ตัดสินว่า "ดีหรือไม่ดี" อยู่ในการตั้งค่ารายบริษัท
 * (core.performance_settings) ค่าใน DEFAULT_* ด้านล่างเป็นแค่ค่าเริ่มต้น
 * สำหรับบริษัทที่ยังไม่เคยตั้ง — **ห้ามอ่านค่าเหล่านี้ไปใช้ตรง ๆ ในโค้ดอื่น**
 * ให้เรียก loadPerformanceSettings(orgId) เสมอ
 */

/** โมดูลต้นทางของเหตุการณ์ */
export type PerformanceSource = "report_task" | "maintenance" | "workforce";

/** ชนิดเหตุการณ์ที่ระบบรู้จัก + ป้ายภาษาไทย (ป้ายไม่ใช่ค่าตั้งค่า) */
export const PERFORMANCE_CATEGORIES = {
  // ── งานในบอร์ด (report_task) ──
  task_late: "ส่งงานเลยกำหนด",
  task_manual_dock: "หักคะแนนโดยหัวหน้า",
  report_missed: "ไม่ส่งรายงานประจำวัน",
  report_late: "ส่งรายงานสาย",

  // ── งานซ่อมบำรุง (maintenance) ──
  workorder_overdue: "ใบงานเกินกำหนด",
  pm_missed: "ไม่ทำบำรุงรักษาตามรอบ",

  // ── ลงเวลา (workforce) ──
  attendance_late: "มาสาย",
  attendance_absent: "ขาดงาน",
} as const;

export type PerformanceCategory = keyof typeof PERFORMANCE_CATEGORIES;

/** ค่าเริ่มต้นสำหรับบริษัทที่ยังไม่เคยตั้งค่า — ติดลบ = หัก */
export const DEFAULT_RULE_POINTS: Record<PerformanceCategory, number> = {
  task_late: -3,
  task_manual_dock: 0, // คะแนนมาจากที่หัวหน้ากรอกเอง
  report_missed: -2,
  report_late: -1,
  workorder_overdue: -3,
  pm_missed: -5,
  attendance_late: -1,
  attendance_absent: -5,
};

export const DEFAULT_GRADE_THRESHOLDS: Record<string, number> = {
  A: 90,
  B: 80,
  C: 70,
  D: 60,
};

export interface PerformanceSettings {
  enabled: boolean;
  baseScore: number;
  lateThresholdMinutes: number;
  absenceThresholdMinutes: number;
  pmGraceDays: number;
  workOrderGraceDays: number;
  attendanceLookbackDays: number;
  rulePoints: Record<PerformanceCategory, number>;
  /** เรียงจากคะแนนสูงไปต่ำแล้ว — ตัวแรกที่ผ่านคือเกรดที่ได้ */
  gradeThresholds: [string, number][];
}

const FALLBACK: PerformanceSettings = {
  enabled: true,
  baseScore: 100,
  lateThresholdMinutes: 15,
  absenceThresholdMinutes: 240,
  pmGraceDays: 7,
  workOrderGraceDays: 0,
  attendanceLookbackDays: 45,
  rulePoints: DEFAULT_RULE_POINTS,
  gradeThresholds: Object.entries(DEFAULT_GRADE_THRESHOLDS).sort((a, b) => b[1] - a[1]),
};

function toNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * การตั้งค่าของบริษัท — ไม่เคยตั้ง = ใช้ค่าเริ่มต้น
 *
 * rulePoints ที่บันทึกไว้จะ **ทับเฉพาะคีย์ที่ระบุ** เหตุการณ์ชนิดใหม่ที่เพิ่ม
 * ทีหลังจึงใช้ค่าเริ่มต้นได้ทันทีโดยไม่ต้องให้ทุกบริษัทมาตั้งใหม่
 */
export async function loadPerformanceSettings(orgId: string): Promise<PerformanceSettings> {
  const row = await prisma.performanceSetting.findUnique({ where: { orgId } });
  if (!row) return FALLBACK;

  const overrides = toNumberMap(row.rulePoints);
  const grades = toNumberMap(row.gradeThresholds);

  return {
    enabled: row.enabled,
    baseScore: row.baseScore,
    lateThresholdMinutes: row.lateThresholdMinutes,
    absenceThresholdMinutes: row.absenceThresholdMinutes,
    pmGraceDays: row.pmGraceDays,
    workOrderGraceDays: row.workOrderGraceDays,
    attendanceLookbackDays: row.attendanceLookbackDays,
    rulePoints: { ...DEFAULT_RULE_POINTS, ...overrides } as Record<
      PerformanceCategory,
      number
    >,
    gradeThresholds:
      Object.keys(grades).length > 0
        ? Object.entries(grades).sort((a, b) => b[1] - a[1])
        : FALLBACK.gradeThresholds,
  };
}

/** โหลดการตั้งค่าของหลายบริษัทพร้อมกัน — ใช้ใน cron ที่วิ่งข้ามบริษัท */
export async function loadPerformanceSettingsMap(
  orgIds: string[]
): Promise<Map<string, PerformanceSettings>> {
  const rows = await prisma.performanceSetting.findMany({
    where: { orgId: { in: orgIds } },
  });
  const byOrg = new Map<string, PerformanceSettings>();
  for (const orgId of orgIds) byOrg.set(orgId, FALLBACK);

  for (const row of rows) {
    const overrides = toNumberMap(row.rulePoints);
    const grades = toNumberMap(row.gradeThresholds);
    byOrg.set(row.orgId, {
      enabled: row.enabled,
      baseScore: row.baseScore,
      lateThresholdMinutes: row.lateThresholdMinutes,
      absenceThresholdMinutes: row.absenceThresholdMinutes,
      pmGraceDays: row.pmGraceDays,
      workOrderGraceDays: row.workOrderGraceDays,
      attendanceLookbackDays: row.attendanceLookbackDays,
      rulePoints: { ...DEFAULT_RULE_POINTS, ...overrides } as Record<
        PerformanceCategory,
        number
      >,
      gradeThresholds:
        Object.keys(grades).length > 0
          ? Object.entries(grades).sort((a, b) => b[1] - a[1])
          : FALLBACK.gradeThresholds,
    });
  }
  return byOrg;
}

export interface PerformanceEventInput {
  orgId: string;
  /** core.users.id */
  userId: string;
  source: PerformanceSource;
  category: PerformanceCategory;
  occurredAt: Date;
  /** ไม่ระบุ = ใช้คะแนนตามการตั้งค่าของบริษัทนั้น */
  points?: number;
  /** ต้นเรื่อง เช่น work_order / pm_schedule / task — ใช้กันหักซ้ำ */
  refType?: string;
  refId?: string;
  note?: string;
  /** มีค่า = คนกดหักเอง, ไม่ระบุ = ระบบคำนวณเอง */
  createdBy?: string;
}

/**
 * บันทึกเหตุการณ์ — เรียกซ้ำด้วยต้นเรื่องเดิมได้ ไม่หักซ้ำ
 *
 * ตัวกวาดงานเลยกำหนดรันทุก 60 วินาที ถ้าไม่กันซ้ำ ใบงานใบเดียวจะโดนหักทุกนาที
 * unique (orgId, source, category, refType, refId) เป็นตัวกัน — เหตุการณ์ที่ไม่มี
 * ต้นเรื่อง (หักมือ) มี refId เป็น null จึงบันทึกซ้ำได้ตามต้องการ
 *
 * ข้ามบริษัทที่ปิดระบบคะแนนไว้ (settings.enabled = false)
 */
export async function recordPerformanceEvents(
  events: PerformanceEventInput[]
): Promise<number> {
  if (events.length === 0) return 0;

  const settingsByOrg = await loadPerformanceSettingsMap([
    ...new Set(events.map((e) => e.orgId)),
  ]);

  const rows = events
    .filter((e) => settingsByOrg.get(e.orgId)?.enabled !== false)
    .map((e) => ({
      orgId: e.orgId,
      userId: e.userId,
      source: e.source,
      category: e.category,
      points: e.points ?? settingsByOrg.get(e.orgId)!.rulePoints[e.category],
      occurredAt: e.occurredAt,
      refType: e.refType ?? null,
      refId: e.refId ?? null,
      note: e.note ?? null,
      createdBy: e.createdBy ?? null,
    }));

  if (rows.length === 0) return 0;
  const result = await prisma.performanceEvent.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
}

/** บันทึกเหตุการณ์เดียว */
export async function recordPerformanceEvent(input: PerformanceEventInput): Promise<void> {
  await recordPerformanceEvents([input]);
}

export interface UserScorecard {
  userId: string;
  name: string;
  email: string;
  /** คะแนนรวมในช่วงที่ขอ (เริ่มจาก baseScore ของบริษัท แล้วบวก/ลบตามเหตุการณ์) */
  score: number;
  grade: string;
  bySource: Record<PerformanceSource, number>;
  /** แยกตามชนิดเหตุการณ์ — ไว้บอกว่าเสียคะแนนเพราะอะไรมากสุด */
  byCategory: { category: string; label: string; points: number; count: number }[];
  eventCount: number;
}

/** เกรดจากคะแนนตามเกณฑ์ของบริษัท — ต่ำกว่าเกณฑ์สุดท้ายได้ F */
export function gradeOf(score: number, thresholds: [string, number][]): string {
  for (const [grade, min] of thresholds) {
    if (score >= min) return grade;
  }
  return "F";
}

/**
 * สรุปคะแนนของทุกคนในบริษัทตามช่วงเวลา — ใช้ในหน้าภาพรวมของผู้บริหาร
 *
 * รวมคนที่ยังไม่มีเหตุการณ์เลยด้วย (คะแนนเต็ม) ไม่งั้นคนที่ทำงานเรียบร้อย
 * จะหายไปจากรายงาน เหลือแต่คนที่มีปัญหา
 */
export async function buildScorecards(
  orgId: string,
  from: Date,
  to: Date
): Promise<{ settings: PerformanceSettings; cards: UserScorecard[] }> {
  const [settings, users, events] = await Promise.all([
    loadPerformanceSettings(orgId),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.performanceEvent.findMany({
      where: { orgId, occurredAt: { gte: from, lte: to } },
      select: { userId: true, source: true, category: true, points: true },
    }),
  ]);

  const byUser = new Map<string, UserScorecard>();
  for (const u of users) {
    byUser.set(u.id, {
      userId: u.id,
      name: u.name,
      email: u.email,
      score: settings.baseScore,
      grade: gradeOf(settings.baseScore, settings.gradeThresholds),
      bySource: { report_task: 0, maintenance: 0, workforce: 0 },
      byCategory: [],
      eventCount: 0,
    });
  }

  const catTotals = new Map<string, Map<string, { points: number; count: number }>>();

  for (const e of events) {
    const card = byUser.get(e.userId);
    if (!card) continue; // ผู้ใช้ถูกปิดใช้งาน/ลบไปแล้ว — ไม่แสดงในรายงาน

    const points = Number(e.points);
    card.score += points;
    card.eventCount += 1;
    if (e.source in card.bySource) {
      card.bySource[e.source as PerformanceSource] += points;
    }

    if (!catTotals.has(e.userId)) catTotals.set(e.userId, new Map());
    const cats = catTotals.get(e.userId)!;
    const prev = cats.get(e.category) ?? { points: 0, count: 0 };
    cats.set(e.category, { points: prev.points + points, count: prev.count + 1 });
  }

  for (const [userId, cats] of catTotals) {
    const card = byUser.get(userId);
    if (!card) continue;
    card.byCategory = [...cats.entries()]
      .map(([category, v]) => ({
        category,
        label:
          PERFORMANCE_CATEGORIES[category as PerformanceCategory] ?? category,
        points: v.points,
        count: v.count,
      }))
      // เรียงจากที่เสียคะแนนมากสุดขึ้นก่อน — เป็นสิ่งที่ผู้บริหารอยากเห็นก่อน
      .sort((a, b) => a.points - b.points);
  }

  for (const card of byUser.values()) {
    card.grade = gradeOf(card.score, settings.gradeThresholds);
  }

  return {
    settings,
    cards: [...byUser.values()].sort((a, b) => a.score - b.score),
  };
}

/** เหตุการณ์ล่าสุดของคนหนึ่งคน — ใช้ในหน้ารายละเอียด */
export async function listUserEvents(orgId: string, userId: string, limit = 100) {
  return prisma.performanceEvent.findMany({
    where: { orgId, userId },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
}
