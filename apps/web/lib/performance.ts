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

/*
 * ตรึงไว้ไม่ให้ตั้งค่าต่อบริษัท (ตามคำขอ — สองตัวนี้ถูกเอาออกจากหน้าตั้งค่า)
 * ต่างจากตัวเลขอื่นในไฟล์นี้ตรงที่ไม่มีบริบทให้แต่ละบริษัทอยากได้ค่าต่างกัน:
 *
 *   ABSENCE_THRESHOLD_MINUTES — เส้นแบ่งระหว่าง "สาย" กับ "ขาดงาน" ของวันหนึ่ง
 *   ATTENDANCE_LOOKBACK_DAYS  — cron ย้อนดูข้อมูลกี่วันย้อนหลังในแต่ละรอบ
 *     (ไม่ใช่กติกาตัดสิน แค่ขอบเขตที่ cron มองย้อนกลับไป)
 */
export const ABSENCE_THRESHOLD_MINUTES = 240;
export const ATTENDANCE_LOOKBACK_DAYS = 45;

export interface PerformanceSettings {
  enabled: boolean;
  baseScore: number;
  lateThresholdMinutes: number;
  pmGraceDays: number;
  workOrderGraceDays: number;
  /** เหตุการณ์ก่อนวันนี้ไม่ถูกบันทึกและไม่ถูกนับ — null = นับทั้งหมด */
  scoringStartDate: Date | null;
  rulePoints: Record<PerformanceCategory, number>;
  /** เรียงจากคะแนนสูงไปต่ำแล้ว — ตัวแรกที่ผ่านคือเกรดที่ได้ */
  gradeThresholds: [string, number][];
}

/*
 * lateThresholdMinutes = 0 โดยตั้งใจ — ไม่ใช่ "ไม่ผ่อนผันการมาสาย"
 *
 * late_minutes ที่ได้จากฝั่ง workforce **หักเวลาผ่อนผันของกะออกให้แล้ว**
 * (นโยบายลงเวลาโหมด GRACE: late_minutes = เวลาเข้าจริง − เวลาเข้ากะ − ผ่อนผัน
 * ดู packages/workforce/attendance-engine/src/calculate.ts computeLate)
 * เข้างาน 08:16 โดยกะเริ่ม 08:00 ผ่อนผัน 15 นาที ⇒ late_minutes = 1
 *
 * เดิมค่านี้เป็น 15 ทำให้ผ่อนผันซ้อนสองชั้น (15 ของกะ + 15 ของคะแนน = 30 นาที)
 * ใครเข้างานก่อน 08:30 จึงไม่เคยถูกหักคะแนนเลยแม้ระบบลงเวลาจะบันทึกว่า "มาสาย"
 * ไปแล้วก็ตาม — ค่านี้คือ "ผ่อนผันเพิ่มจากของกะอีกกี่นาที" ปกติต้องเป็น 0
 */
const FALLBACK: PerformanceSettings = {
  enabled: true,
  baseScore: 100,
  lateThresholdMinutes: 0,
  pmGraceDays: 7,
  workOrderGraceDays: 0,
  scoringStartDate: null,
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
    pmGraceDays: row.pmGraceDays,
    workOrderGraceDays: row.workOrderGraceDays,
    scoringStartDate: row.scoringStartDate,
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
      pmGraceDays: row.pmGraceDays,
      workOrderGraceDays: row.workOrderGraceDays,
      scoringStartDate: row.scoringStartDate,
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
    .filter((e) => {
      const st = settingsByOrg.get(e.orgId);
      if (st?.enabled === false) return false;
      // จุดเดียวที่ทุก cron/โมดูลผ่าน — กันทั้ง cron ลงเวลาที่ย้อนดู 45 วัน และ sweep
      // งานที่ส่งเหตุการณ์ของงานเก่าซ้ำทุกครั้งที่มีงานเปลี่ยน ไม่ให้เก็บช่วงก่อนวันเริ่มนับกลับมา
      return !(st?.scoringStartDate && e.occurredAt < st.scoringStartDate);
    })
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
 * สีของเกรดคิดจาก "อันดับ" ไม่ใช่ชื่อ — บริษัทตั้งชื่อเกรดเองได้ (A/B/C หรือ
 * ดีมาก/ดี/พอใช้) ถ้าผูกสีกับตัวอักษรตายตัว เกรดที่ตั้งชื่อเองจะไม่มีสี
 */
export function gradeColor(grade: string, order: string[]): string {
  const i = order.indexOf(grade);
  if (i === -1) return "var(--tone-danger)"; // ต่ำกว่าทุกเกณฑ์
  const ratio = order.length <= 1 ? 0 : i / (order.length - 1);
  if (ratio <= 0.34) return "var(--tone-ok)";
  if (ratio <= 0.67) return "var(--tone-warn)";
  return "var(--tone-danger)";
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
  const settings = await loadPerformanceSettings(orgId);
  const start =
    settings.scoringStartDate && settings.scoringStartDate > from ? settings.scoringStartDate : from;
  const [users, events] = await Promise.all([
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.performanceEvent.findMany({
      where: { orgId, occurredAt: { gte: start, lte: to } },
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

/**
 * เหตุการณ์ของคนหนึ่งคน — ใช้ในหน้ารายละเอียด
 *
 * ไม่ระบุ from/to = ล่าสุดเท่าที่ limit อนุญาต (หน้าโปรไฟล์พนักงาน) ระบุมาเมื่อ
 * ต้องการเฉพาะเหตุการณ์ที่ประกอบเป็นคะแนนของเดือนใดเดือนหนึ่ง (หน้าผลงานรายคน
 * ที่แยกดูทีละเดือน) — ให้ตรงกับช่วงเดียวกับที่ buildScorecards ใช้คิดคะแนน
 * เดือนนั้นเป๊ะ ๆ ไม่งั้นรายการที่เห็นกับยอดรวมที่โชว์จะไม่ตรงกัน
 */
export async function listUserEvents(
  orgId: string,
  userId: string,
  opts: { limit?: number; from?: Date; to?: Date } = {},
) {
  return prisma.performanceEvent.findMany({
    where: {
      orgId,
      userId,
      ...(opts.from || opts.to
        ? {
            occurredAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: opts.limit ?? 100,
  });
}
