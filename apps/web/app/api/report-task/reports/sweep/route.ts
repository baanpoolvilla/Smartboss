import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { loadPerformanceSettings, recordPerformanceEvents, type PerformanceEventInput } from "@/lib/performance";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { listDirectory } from "@/modules/report_task/lib/db/employee-directory";
import { buildDateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";
import { computeReportPenaltyCandidates, roundComplianceStatusServer } from "@/modules/report_task/lib/report-penalty-sweep";
import { effectiveRoundsOf } from "@/modules/report_task/lib/submission-rounds";
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

  const [settings, { data: featureEnabled }, { data: enabledSince }, { data: reportFeed }, users, { data: leaves }, { data: holidaysSlice }, { data: routine }, { data: reminderSettingsRaw }] =
    await Promise.all([
      loadPerformanceSettings(orgId),
      readStore<boolean>(orgId, "report-penalty-settings"),
      readStore<string>(orgId, "report-penalty-enabled-since"),
      readStore<{ topics: ReportTopic[]; posts: ReportPost[]; submitterGroups?: SubmitterGroup[] }>(orgId, "report-feed"),
      listDirectory(orgId),
      readStore<CalendarEvent[]>(orgId, "leaves"),
      readStore<{ holidays: CalendarEvent[] }>(orgId, "holidays"),
      readStore<RoutineDayOffSlice>(orgId, "routine-dayoff"),
      readStore<Partial<ReminderSettings>>(orgId, "reminder-settings"),
    ]);
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

  const events: PerformanceEventInput[] = [];
  for (const c of candidates) {
    const targetCategory = c.status === "missed" ? "report_missed" : "report_late";
    const otherCategory = c.status === "missed" ? "report_late" : "report_missed";
    const prior = priorByRefId.get(c.refId) ?? [];
    const alreadyRecorded = prior.some((p) => p.category === targetCategory && p.refType === "report_round");
    if (alreadyRecorded) continue;

    // สถานะของรอบนี้เปลี่ยนทิศทางจากที่เคยบันทึกไว้ (พลาด <-> สาย) — ทั้งสอง
    // ทิศทางต้องคืนคะแนนของฝั่งเดิมก่อนเสมอ แล้วค่อยหักตามสถานะใหม่ กันไม่ให้
    // -1 (ส่งช้า) กับ -2 (พลาด) ของรอบเดียวกันมาบวกกันเป็น -3:
    //   - พลาดไปแล้ว (-2) แต่มีคนส่งย้อนหลังทัน (กลายเป็น "late") → คืน -2 ก่อน
    //   - เคยส่งช้าไว้ (-1) แต่ภายหลังโพสต์นั้นหายไป (เช่นถูกลบ, กลายเป็น
    //     "missed" จริง) → คืน -1 ก่อน
    // ไม่ลบ event เดิมทิ้ง (เก็บ audit trail อ่านย้อนได้ครบ เหมือน
    // task_reaction_undo / report_post_reaction_undo ที่อื่นในระบบนี้)
    const priorOther = prior.find((p) => p.category === otherCategory && p.refType === "report_round");
    const otherAlreadyUndone = prior.some((p) => p.category === otherCategory && p.refType === "report_round_undo");
    if (priorOther && !otherAlreadyUndone) {
      events.push({
        orgId,
        userId: c.userId,
        source: "report_task",
        category: otherCategory,
        points: -priorOther.points,
        occurredAt: new Date(),
        refType: "report_round_undo",
        refId: c.refId,
        note: c.status === "missed" ? "ยกเลิก: เคยส่งช้าไว้ แต่ภายหลังไม่มีรายงานอยู่จริง" : "ยกเลิก: ส่งย้อนหลังหลังพลาดกำหนด",
      });
    }

    events.push({
      orgId,
      userId: c.userId,
      source: "report_task",
      category: targetCategory,
      occurredAt: new Date(`${c.day}T00:00:00`),
      refType: "report_round",
      refId: c.refId,
    });
  }

  // คืนคะแนนของ event เก่าที่ "ไม่ต้องส่งแล้วจริง ๆ" (สถานะปัจจุบัน = exempt,
  // เช่นมีคนไปยื่น/อนุมัติวันลาย้อนหลังให้วันนั้นทีหลัง — เดิมคะแนนที่เคยหักไป
  // ก่อนใบลาจะอนุมัติจะค้างอยู่ถาวรไม่มีอะไรคืนให้เลย) — วนทุก refId ที่ยังมี
  // ของจริง (report_round) ค้างอยู่และยังไม่เคยถูกคืน แล้วคำนวณสถานะสดอีกที
  // ด้วยข้อมูล/ข้อยกเว้นล่าสุด ถ้าไม่ใช่ "พลาด"/"สาย" อีกต่อไปแล้ว (ลูป
  // candidates ข้างบนจัดการกรณีพลาด<->สายให้ครบแล้ว) ให้คืนคะแนน
  const topicById = new Map(topics.map((t) => [t.id, t] as const));
  for (const [refId, prior] of priorByRefId) {
    const original = prior.find((p) => p.refType === "report_round");
    if (!original) continue;
    const alreadyUndone = prior.some((p) => p.category === original.category && p.refType === "report_round_undo");
    if (alreadyUndone) continue;

    const parsed = parseRefId(refId);
    if (!parsed) continue;
    const topic = topicById.get(parsed.topicId);
    if (!topic) continue; // ห้องถูกลบไปแล้ว — refundDeletedReportRoundEvents (ตอนบันทึก) ดูแลเคสนี้แยกอยู่แล้ว
    const round = effectiveRoundsOf(topic).find((r) => r.id === parsed.roundId);
    if (!round) continue; // รอบถูกลบไปแล้ว — เคสเดียวกับข้างบน

    const liveStatus = roundComplianceStatusServer(topic, parsed.userId, round, parsed.day, posts, groups, users, exemptions, submissionLock);
    if (liveStatus === "missed" || liveStatus === "late") continue; // ยังตรงกับที่บันทึกไว้ หรือ candidates ข้างบนจัดการให้แล้ว

    events.push({
      orgId,
      userId: parsed.userId,
      source: "report_task",
      category: original.category as "report_missed" | "report_late",
      points: -original.points,
      occurredAt: new Date(),
      refType: "report_round_undo",
      refId,
      note: liveStatus === "exempt" ? "ยกเลิก: วันนั้นมีวันลา/หยุด/ไม่ต้องส่งแล้ว" : "ยกเลิก: ไม่ใช่ภาระที่ต้องส่งอีกต่อไป",
    });
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
