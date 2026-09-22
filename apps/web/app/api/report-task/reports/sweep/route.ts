import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { loadPerformanceSettings, recordPerformanceEvents, type PerformanceEventInput } from "@/lib/performance";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { listDirectory } from "@/modules/report_task/lib/db/employee-directory";
import { buildDateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";
import { computeReportPenaltyCandidates } from "@/modules/report_task/lib/report-penalty-sweep";
import { todayIso } from "@/modules/report_task/lib/now";
import { thaiHolidayEvents } from "@/modules/report_task/data/thai-holidays";
import type { ReportPost, ReportTopic, SubmitterGroup } from "@/modules/report_task/store/report-feed-store";
import type { RoutineDayOffRule } from "@/modules/report_task/store/routine-dayoff-store";
import { defaultReminderSettings, type ReminderSettings } from "@/modules/report_task/store/reminder-settings-store";
import type { CalendarEvent } from "@/modules/report_task/types";

/**
 * หักคะแนน HR เมื่อพลาด/ส่งช้ารอบส่งรายงาน (category `report_missed`/`report_late`)
 * — เฟส 2 ของ docs/spec-report-submission-rounds.md ข้อ 7 คู่กับ
 * /api/report-task/tasks/sweep (ที่หัก `task_late` อยู่แล้ว) ต่างกันแค่ต้นเรื่อง
 *
 * trigger-only แบบเดียวกับ tasks/sweep: คำนวณและเขียนที่เซิร์ฟเวอร์ครั้งเดียว
 * ทริกเกอร์ได้จากหลายแท็บ/หลายบริษัทพร้อมกันโดยไม่หักซ้ำ (unique
 * org/source/category/refType/refId กันไว้ที่ recordPerformanceEvents)
 *
 * ปิดสองชั้น: `performance_settings.enabled` (สวิตช์รวมทั้งบริษัท) และ
 * `report-penalty-settings` (สวิตช์เฉพาะฟีเจอร์นี้ ค่าเริ่มต้นปิด — ดู
 * store ตัวนั้นว่าทำไมต้องมีสองชั้น)
 */
export const dynamic = "force-dynamic";

// ย้อนดูกี่วัน ต่อรอบ sweep — เท่ากับ ATTENDANCE_LOOKBACK_DAYS (lib/performance.ts)
// เพื่อความสม่ำเสมอ: วัน/รอบที่เก่ากว่านี้ถือว่านิ่งแล้ว ไม่ไล่ย้อนหักคะแนนเก่า
// เป็นสิบ ๆ วันตอนบริษัทเพิ่งเปิดสวิตช์นี้ครั้งแรก
const REPORT_PENALTY_LOOKBACK_DAYS = 45;

interface RoutineDayOffSlice {
  pickedDates: Record<string, string[]>;
  rules: RoutineDayOffRule[];
  ruleExceptions: Record<string, string>;
}

/** refId มาตรฐาน `${day}:${topicId}:${roundId}:${userId}` (ดู report-penalty-sweep.ts) */
function parseRefId(refId: string): { day: string; topicId: string; roundId: string; userId: string } | null {
  const parts = refId.split(":");
  if (parts.length !== 4) return null;
  const [day, topicId, roundId, userId] = parts as [string, string, string, string];
  return { day, topicId, roundId, userId };
}

export async function POST() {
  const session = await requireOrg();
  const orgId = session.orgId;

  const [settings, { data: featureEnabled }, { data: enabledSince }, { data: graceDaysRaw }, { data: reportFeed }, users, { data: leaves }, { data: holidaysSlice }, { data: routine }, { data: reminderSettingsRaw }] =
    await Promise.all([
      loadPerformanceSettings(orgId),
      readStore<boolean>(orgId, "report-penalty-settings"),
      readStore<string>(orgId, "report-penalty-enabled-since"),
      readStore<number>(orgId, "report-penalty-grace-days"),
      readStore<{ topics: ReportTopic[]; posts: ReportPost[]; submitterGroups?: SubmitterGroup[] }>(orgId, "report-feed"),
      listDirectory(orgId),
      readStore<CalendarEvent[]>(orgId, "leaves"),
      readStore<{ holidays: CalendarEvent[] }>(orgId, "holidays"),
      readStore<RoutineDayOffSlice>(orgId, "routine-dayoff"),
      readStore<Partial<ReminderSettings>>(orgId, "reminder-settings"),
    ]);
  // เผื่อเวลาส่งย้อนหลังของรอบรายสัปดาห์/รายเดือน (วัน) — ตั้งได้ที่ ตั้งค่า →
  // ห้อง Report → หักคะแนน HR (report-penalty-settings-store.ts) ค่าเริ่มต้น 3
  const weeklyMonthlyGraceDays = typeof graceDaysRaw === "number" && graceDaysRaw >= 0 ? graceDaysRaw : 3;
  // "เวลาปิดรับรายงานอัตโนมัติ" (hard cutoff) — คนละค่ากับเวลารอบส่งของแต่ละ
  // ห้อง (round.time, ใช้แค่ตัดสิน "สาย" ไม่เคยบล็อกการส่งจริง) ดู
  // report-cutoff.ts's effectiveHardCutoffTime สำหรับตรรกะเต็ม — ไม่มีค่าที่
  // บันทึกไว้ = ยังไม่เคยตั้ง ใช้ค่าเริ่มต้นเดียวกับที่หน้าตั้งค่าใช้
  const submissionLock = { ...defaultReminderSettings.submissionLock, ...reminderSettingsRaw?.submissionLock };

  if (!settings.enabled || featureEnabled !== true) {
    return Response.json({ ok: true, changed: false, skipped: "disabled" });
  }
  // ไม่ควรเกิด (ตั้งค่า setEnabled(true) เขียนคู่กันเสมอ) แต่ถ้าไม่มี anchor
  // จริง ๆ ห้ามหักย้อนหลังเด็ดขาด — จำกัดแค่วันนี้วันเดียวไว้ก่อน (ปลอดภัยสุด)
  const notBeforeDay = enabledSince ?? new Date().toISOString().slice(0, 10);

  const topics = reportFeed?.topics ?? [];
  const posts = reportFeed?.posts ?? [];
  const groups = reportFeed?.submitterGroups ?? [];
  if (topics.length === 0 || users.length === 0) {
    return Response.json({ ok: true, changed: false });
  }

  // เหมือน store-hydrator.tsx's "holidays" apply — วันหยุดของบริษัทที่บันทึกไว้
  // อาจเก่ากว่าโค้ด (ยังไม่มีวันหยุดไทยปีล่าสุด) เติมของที่ขาดกลับเข้าไปเสมอ
  const existingHolidayIds = new Set((holidaysSlice?.holidays ?? []).map((h) => h.id));
  const mergedHolidays = [
    ...(holidaysSlice?.holidays ?? []),
    ...thaiHolidayEvents.filter((h) => !existingHolidayIds.has(h.id)),
  ];

  const exemptions = buildDateExemptions(leaves ?? [], mergedHolidays, {
    pickedDates: routine?.pickedDates ?? {},
    rules: routine?.rules ?? [],
    ruleExceptions: routine?.ruleExceptions ?? {},
  });

  const candidates = computeReportPenaltyCandidates(
    topics,
    posts,
    users,
    groups,
    exemptions,
    submissionLock,
    weeklyMonthlyGraceDays,
    REPORT_PENALTY_LOOKBACK_DAYS,
    notBeforeDay
  );

  // เช็คทุก event ที่เคยบันทึกไว้ในช่วงวันเดียวกับที่ sweep รอบนี้ดูอยู่ (ทั้งของ
  // จริงและตัวยกเลิก) — ไม่ได้กรองเฉพาะ refId ที่ตรงกับ candidates ตอนนี้เท่านั้น
  // เพราะต้องจับกรณี "เคยพลาด/สายแล้วบันทึกไปแล้ว แต่ตอนนี้ไม่ต้องส่งอีกต่อไป
  // แล้ว" ด้วย (ลาย้อนหลัง/วันหยุดที่เพิ่งเพิ่ม ฯลฯ — สถานะกลายเป็น "exempt" จึง
  // ไม่โผล่เป็น candidate เลย ไม่ใช่แค่ "พลาด<->สาย" ที่ candidates เห็นอยู่แล้ว)
  // refId ขึ้นต้นด้วยวันแบบ "YYYY-MM-DD:..." เทียบเป็น string ตรงลำดับตัวอักษร
  // ได้เลย (ISO date เรียงตามตัวอักษร = เรียงตามเวลาจริงพอดี)
  const todayStr = todayIso();
  const dayRangeEvents = await prisma.performanceEvent.findMany({
    where: {
      orgId,
      source: "report_task",
      refType: { in: ["report_round", "report_round_undo"] },
      refId: { gte: notBeforeDay, lte: `${todayStr}:￿` },
    },
    select: { refId: true, category: true, refType: true, points: true },
  });
  const priorByRefId = new Map<string, { category: string; refType: string; points: number }[]>();
  for (const e of dayRangeEvents) {
    const list = priorByRefId.get(e.refId!) ?? [];
    list.push({ category: e.category, refType: e.refType!, points: Number(e.points) });
    priorByRefId.set(e.refId!, list);
  }

  // "สถานะที่ควร active อยู่ตอนนี้" ต่อ refId — มาจาก candidates (พลาด/สาย)
  // ถ้าไม่อยู่ใน candidates เลยแปลว่าสถานะสดตอนนี้ไม่ใช่พลาด/สายแล้ว (เช่น
  // exempt จากลาย้อนหลัง) จึงไม่ควรมี event ไหน active เหลืออยู่เลย (null)
  const targetCategoryByRefId = new Map<string, "report_missed" | "report_late">();
  for (const c of candidates) {
    targetCategoryByRefId.set(c.refId, c.status === "missed" ? "report_missed" : "report_late");
  }

  // วนทุก refId ที่ "ควร active" (จาก candidates) รวมกับทุก refId ที่ "เคยมี
  // event บันทึกไว้แล้ว" (จาก priorByRefId) เป็นชุดเดียว — ครอบคลุมทั้ง 3 เคส
  // ในลูปเดียว ไม่แยกเป็นสอง pass เหมือนเดิม (ของเดิมใช้ prior.find() ซึ่งเจอ
  // event แรกที่ตรง refType เท่านั้น พอมี event ค้างสองสถานะพร้อมกันสำหรับ
  // refId เดียวกัน — เช่น report_missed กับ report_late ทั้งคู่ active
  // พร้อมกัน ซึ่งไม่ควรเกิดแต่เกิดขึ้นจริงจากข้อมูลเก่าก่อนแก้ครั้งก่อน ๆ —
  // จะเห็นแค่ตัวเดียวแล้วปล่อยอีกตัวค้างไว้ กลายเป็น -2 กับ -1 ค้างพร้อมกัน):
  //   1. ยังไม่เคยบันทึกอะไรเลย + ควร active → สร้างใหม่
  //   2. เคยบันทึกไว้ตรงกับที่ควร active อยู่แล้ว → ไม่ต้องทำอะไร
  //   3. เคยบันทึกไว้ "ไม่ตรง" กับที่ควร active (พลาด<->สาย, กลายเป็น exempt,
  //      หรือมีสองสถานะ active ค้างพร้อมกันผิดปกติ) → คืนคะแนนของทุกอันที่ไม่
  //      ตรงเป้าหมาย (ไม่ใช่แค่ตัวแรกที่เจอ) ไม่ลบ event เดิมทิ้ง เก็บ audit
  //      trail อ่านย้อนได้ครบ เหมือน task_reaction_undo ที่อื่นในระบบนี้
  const events: PerformanceEventInput[] = [];
  const allRefIds = new Set([...targetCategoryByRefId.keys(), ...priorByRefId.keys()]);

  for (const refId of allRefIds) {
    const parsed = parseRefId(refId);
    if (!parsed) continue;

    const prior = priorByRefId.get(refId) ?? [];
    const originals = prior.filter((p) => p.refType === "report_round");
    const targetCategory = targetCategoryByRefId.get(refId) ?? null;

    for (const original of originals) {
      if (original.category === targetCategory) continue; // ตรงกับสถานะปัจจุบันอยู่แล้ว
      const alreadyUndone = prior.some((p) => p.category === original.category && p.refType === "report_round_undo");
      if (alreadyUndone) continue;
      events.push({
        orgId,
        userId: parsed.userId,
        source: "report_task",
        category: original.category as "report_missed" | "report_late",
        points: -original.points,
        occurredAt: new Date(),
        refType: "report_round_undo",
        refId,
        note:
          targetCategory === null
            ? "ยกเลิก: วันนั้นมีวันลา/หยุด/ไม่ต้องส่งแล้ว"
            : "ยกเลิก: มีบันทึกคะแนนซ้ำสองสถานะสำหรับรอบเดียวกัน คืนคะแนนของฝั่งที่ไม่ตรงกับสถานะปัจจุบัน",
      });
    }

    if (targetCategory && !originals.some((o) => o.category === targetCategory)) {
      events.push({
        orgId,
        userId: parsed.userId,
        source: "report_task",
        category: targetCategory,
        occurredAt: new Date(`${parsed.day}T00:00:00`),
        refType: "report_round",
        refId,
      });
    }
  }

  if (events.length === 0) {
    return Response.json({ ok: true, changed: false });
  }

  const recorded = await recordPerformanceEvents(events);
  return Response.json({ ok: true, changed: recorded > 0, performanceEvents: recorded });
}

// เผื่อ client ฝั่งไหนยิง GET แทน POST มา (เช่นเดียวกับ tasks/sweep, reminders/sweep)
export async function GET() {
  return POST();
}
