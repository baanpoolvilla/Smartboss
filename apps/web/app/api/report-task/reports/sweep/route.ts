import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { loadPerformanceSettings, recordPerformanceEvents, type PerformanceEventInput } from "@/lib/performance";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { listDirectory } from "@/modules/report_task/lib/db/employee-directory";
import { buildDateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";
import { computeReportPenaltyCandidates } from "@/modules/report_task/lib/report-penalty-sweep";
import { thaiHolidayEvents } from "@/modules/report_task/data/thai-holidays";
import type { ReportPost, ReportTopic, SubmitterGroup } from "@/modules/report_task/store/report-feed-store";
import type { RoutineDayOffRule } from "@/modules/report_task/store/routine-dayoff-store";
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

export async function POST() {
  const session = await requireOrg();
  const orgId = session.orgId;

  const [settings, { data: featureEnabled }, { data: reportFeed }, users, { data: leaves }, { data: holidaysSlice }, { data: routine }] =
    await Promise.all([
      loadPerformanceSettings(orgId),
      readStore<boolean>(orgId, "report-penalty-settings"),
      readStore<{ topics: ReportTopic[]; posts: ReportPost[]; submitterGroups?: SubmitterGroup[] }>(orgId, "report-feed"),
      listDirectory(orgId),
      readStore<CalendarEvent[]>(orgId, "leaves"),
      readStore<{ holidays: CalendarEvent[] }>(orgId, "holidays"),
      readStore<RoutineDayOffSlice>(orgId, "routine-dayoff"),
    ]);

  if (!settings.enabled || featureEnabled !== true) {
    return Response.json({ ok: true, changed: false, skipped: "disabled" });
  }

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

  const candidates = computeReportPenaltyCandidates(topics, posts, users, groups, exemptions, REPORT_PENALTY_LOOKBACK_DAYS);
  if (candidates.length === 0) {
    return Response.json({ ok: true, changed: false });
  }

  // เช็คว่า refId ไหนเคยมี event บันทึกไปแล้วบ้าง (ทั้งของจริงและตัวยกเลิก) —
  // ต้องอ่านก่อนเขียนเพราะกรณี "เคยพลาดแล้วมาส่งย้อนหลังทีหลัง" (สถานะเปลี่ยน
  // missed -> late) ต้องคืนคะแนนที่เคยหักไปให้ก่อน ไม่ใช่แค่ไม่หักซ้ำเฉย ๆ —
  // ดูคอมเมนต์ในลูปด้านล่าง
  const refIds = candidates.map((c) => c.refId);
  const existing = await prisma.performanceEvent.findMany({
    where: {
      orgId,
      source: "report_task",
      refType: { in: ["report_round", "report_round_undo"] },
      refId: { in: refIds },
    },
    select: { refId: true, category: true, refType: true, points: true },
  });
  const priorByRefId = new Map<string, { category: string; refType: string; points: number }[]>();
  for (const e of existing) {
    const list = priorByRefId.get(e.refId!) ?? [];
    list.push({ category: e.category, refType: e.refType!, points: Number(e.points) });
    priorByRefId.set(e.refId!, list);
  }

  const events: PerformanceEventInput[] = [];
  for (const c of candidates) {
    const targetCategory = c.status === "missed" ? "report_missed" : "report_late";
    const prior = priorByRefId.get(c.refId) ?? [];
    const alreadyRecorded = prior.some((p) => p.category === targetCategory && p.refType === "report_round");
    if (alreadyRecorded) continue;

    // พลาดไปแล้วครั้งก่อน (บันทึก report_missed ไปแล้ว) แต่ตอนนี้มีคนส่งย้อนหลัง
    // มา (สถานะกลายเป็น "late") — คืนคะแนนที่เคยหักไปให้ก่อนแล้วค่อยหักแบบ
    // "ส่งช้า" แทน ไม่ลบ event เดิมทิ้ง (เก็บ audit trail อ่านย้อนได้ครบ เหมือน
    // task_reaction_undo / report_post_reaction_undo ที่อื่นในระบบนี้)
    if (c.status === "late") {
      const priorMissed = prior.find((p) => p.category === "report_missed" && p.refType === "report_round");
      const alreadyUndone = prior.some((p) => p.category === "report_missed" && p.refType === "report_round_undo");
      if (priorMissed && !alreadyUndone) {
        events.push({
          orgId,
          userId: c.userId,
          source: "report_task",
          category: "report_missed",
          points: -priorMissed.points,
          occurredAt: new Date(),
          refType: "report_round_undo",
          refId: c.refId,
          note: "ยกเลิก: ส่งย้อนหลังหลังพลาดกำหนด",
        });
      }
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

  const recorded = await recordPerformanceEvents(events);
  return Response.json({ ok: true, changed: recorded > 0, performanceEvents: recorded });
}

// เผื่อ client ฝั่งไหนยิง GET แทน POST มา (เช่นเดียวกับ tasks/sweep, reminders/sweep)
export async function GET() {
  return POST();
}
