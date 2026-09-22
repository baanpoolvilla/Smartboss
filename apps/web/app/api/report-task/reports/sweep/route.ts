import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { loadPerformanceSettings, type PerformanceEventInput } from "@/lib/performance";
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
 * ทริกเกอร์ได้จากหลายแท็บพร้อมกันโดยไม่หักซ้ำ — **ล็อกระดับบริษัทกันชนกันเอง**
 * (`pg_try_advisory_xact_lock`, ดูใน POST ด้านล่าง) เพราะ unique constraint
 * ของ performance_events (`org/source/category/refType/refId`) กันซ้ำได้แค่
 * "หมวดเดียวกัน" เท่านั้น — สองแท็บที่ทริกเกอร์พร้อมกันเป๊ะๆ ตอนสถานะกำลังจะ
 * เปลี่ยน (เช่น เพิ่งเลย hard cutoff ไปหมาดๆ) เห็น "ก่อนเขียน" เหมือนกันทั้งคู่
 * แต่คำนวณ "ตอนนี้" คนละเสี้ยววินาที เลยตัดสินคนละสถานะ (หนึ่งเห็น "สาย" อีกคน
 * เห็น "พลาด") แล้วเขียนทั้งคู่ผ่าน unique constraint ได้เพราะ category ไม่ตรง
 * กัน — กลายเป็น -1 กับ -2 ของรอบเดียวกัน active พร้อมกันจริง (เจอจากการใช้งาน
 * จริง ไม่ใช่แค่ทฤษฎี) ล็อกนี้บังคับให้เขียนได้ทีละแท็บต่อบริษัทเท่านั้น
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

  // "สถานะที่ควร active อยู่ตอนนี้" ต่อ refId — มาจาก candidates (พลาด/สาย)
  // ถ้าไม่อยู่ใน candidates เลยแปลว่าสถานะสดตอนนี้ไม่ใช่พลาด/สายแล้ว (เช่น
  // exempt จากลาย้อนหลัง) จึงไม่ควรมี event ไหน active เหลืออยู่เลย (null)
  const targetCategoryByRefId = new Map<string, "report_missed" | "report_late">();
  for (const c of candidates) {
    targetCategoryByRefId.set(c.refId, c.status === "missed" ? "report_missed" : "report_late");
  }

  const todayStr = todayIso();

  // ตั้งแต่ที่ไป (อ่าน event เดิม + ตัดสิน + เขียน) ต้องอยู่ในทรานแซกชันเดียว
  // ล็อกด้วยกัน — ดูคอมเมนต์บนสุดของไฟล์ว่าทำไม (race ระหว่างสองแท็บ ตัดสิน
  // คนละสถานะสำหรับ refId เดียวกัน แล้วเขียนได้ทั้งคู่เพราะ unique constraint
  // แยกตาม category) แท็บที่แย่งล็อกไม่ได้แค่ข้ามรอบนี้ไปเฉยๆ (ปลอดภัย — sweep
  // ถัดไปใน 60 วิคำนวณใหม่จากข้อมูลล่าสุดเองเสมออยู่แล้ว)
  const result = await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${orgId})) AS locked`;
    if (!lockRows[0]?.locked) {
      return { changed: false, skipped: "locked" as const };
    }

    // เช็คทุก event ที่เคยบันทึกไว้ในช่วงวันเดียวกับที่ sweep รอบนี้ดูอยู่
    // (ทั้งของจริงและตัวยกเลิก) — ไม่ได้กรองเฉพาะ refId ที่ตรงกับ candidates
    // ตอนนี้เท่านั้น เพราะต้องจับกรณี "เคยพลาด/สายแล้วบันทึกไปแล้ว แต่ตอนนี้ไม่
    // ต้องส่งอีกต่อไปแล้ว" ด้วย (ลาย้อนหลัง/วันหยุดที่เพิ่งเพิ่ม ฯลฯ — สถานะ
    // กลายเป็น "exempt" จึงไม่โผล่เป็น candidate เลย ไม่ใช่แค่ "พลาด<->สาย" ที่
    // candidates เห็นอยู่แล้ว) refId ขึ้นต้นด้วยวันแบบ "YYYY-MM-DD:..." เทียบ
    // เป็น string ตรงลำดับตัวอักษรได้เลย (ISO date เรียงตามตัวอักษร = เรียง
    // ตามเวลาจริงพอดี) — อ่านครั้งนี้เกิดหลังได้ล็อกแล้ว ไม่มีแท็บอื่นเขียนแทรก
    // ระหว่างทางได้อีก
    const dayRangeEvents = await tx.performanceEvent.findMany({
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

    // วนทุก refId ที่ "ควร active" (จาก candidates) รวมกับทุก refId ที่ "เคยมี
    // event บันทึกไว้แล้ว" (จาก priorByRefId) เป็นชุดเดียว — ครอบคลุมทั้ง 3
    // เคสในลูปเดียว ไม่แยกเป็นสอง pass เหมือนเดิม (ของเดิมใช้ prior.find() ซึ่ง
    // เจอ event แรกที่ตรง refType เท่านั้น พอมี event ค้างสองสถานะพร้อมกัน
    // สำหรับ refId เดียวกัน — report_missed กับ report_late ทั้งคู่ active
    // พร้อมกัน — จะเห็นแค่ตัวเดียวแล้วปล่อยอีกตัวค้างไว้):
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

    // DEBUG ชั่วคราว — ลบออกทีหลังหลังไล่บั๊กเสร็จ
    const watchRefIds = [...allRefIds].filter((r) => r.includes("214b545e") || r.includes("315a9634"));
    const debug = {
      candidatesCount: candidates.length,
      allRefIdsCount: allRefIds.size,
      eventsPlanned: events.length,
      eventsPlannedList: events,
      watched: watchRefIds.map((refId) => ({
        refId,
        target: targetCategoryByRefId.get(refId) ?? null,
        prior: priorByRefId.get(refId) ?? [],
      })),
    };

    if (events.length === 0) {
      return { changed: false, debug };
    }

    // เขียนตรงในทรานแซกชันนี้เอง ไม่ผ่าน recordPerformanceEvents (ซึ่งเปิด
    // client ใหม่นอกทรานแซกชัน จะหลุดจากล็อกที่เพิ่งถืออยู่) — settings.enabled
    // เช็คแล้วผ่านตั้งแต่ต้นฟังก์ชัน, scoringStartDate กรองย้อนหลังเผื่อบริษัท
    // ตั้งวันเริ่มนับคะแนนไว้เหมือนที่ recordPerformanceEvents ทำ
    const rows = events
      .filter((e) => !settings.scoringStartDate || e.occurredAt >= settings.scoringStartDate)
      .map((e) => ({
        orgId: e.orgId,
        userId: e.userId,
        source: e.source,
        category: e.category,
        points: e.points ?? settings.rulePoints[e.category],
        occurredAt: e.occurredAt,
        refType: e.refType ?? null,
        refId: e.refId ?? null,
        note: e.note ?? null,
        createdBy: e.createdBy ?? null,
      }));
    if (rows.length === 0) return { changed: false, debug };

    const recorded = await tx.performanceEvent.createMany({ data: rows, skipDuplicates: true });
    return { changed: recorded.count > 0, performanceEvents: recorded.count, debug };
  });

  return Response.json({ ok: true, ...result });
}

// เผื่อ client ฝั่งไหนยิง GET แทน POST มา (เช่นเดียวกับ tasks/sweep, reminders/sweep)
export async function GET() {
  return POST();
}
