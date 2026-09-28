import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { loadPerformanceSettings, type PerformanceEventInput } from "@/lib/performance";
import { createStoreIfAbsent, readStore } from "@/modules/report_task/lib/db/org-store";
import { listDirectory } from "@/modules/report_task/lib/db/employee-directory";
import { buildDateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";
import { listHolidayEvents, listLeaveEvents } from "@/modules/report_task/lib/db/workforce-calendar";
import { computeReportPenaltyCandidates } from "@/modules/report_task/lib/report-penalty-sweep";
import { thaiHolidayEvents } from "@/modules/report_task/data/thai-holidays";
import { localDateStr } from "@/modules/report_task/lib/now";
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

export async function POST(request?: Request) {
  /*
   * ?dryRun=1&since=YYYY-MM-DD — ดูล่วงหน้าว่าถ้าตั้ง "วันเริ่มนับ" เป็นวันนั้น คะแนนจะเปลี่ยน
   * อะไรบ้าง โดย **ไม่เขียนอะไรเลย** (ทั้งคะแนนและค่า enabledSince) ใช้ก่อนรัน
   * scripts/set-report-penalty-start.ts ให้เห็นผลกับทุกคนก่อนตัดสินใจ
   */
  const params = request ? new URL(request.url).searchParams : null;
  const dryRun = params?.get("dryRun") === "1";
  const sinceParam = params?.get("since") ?? "";
  const previewSince = dryRun && /^\d{4}-\d{2}-\d{2}$/.test(sinceParam) ? sinceParam : null;
  const session = await requireOrg();
  const orgId = session.orgId;

  // การลา/Day-Off และวันหยุดบริษัทอยู่ในโมดูลบุคคล (workforce) — ต้องอ่านจาก
  // ที่นั่น เหมือนที่ปฏิทินอ่านผ่าน /api/report-task/store/[key] (WORKFORCE_KEYS)
  // เดิมที่นี่ readStore("leaves"/"holidays") ซึ่งเป็น store เก่าก่อนย้ายไป HR
  // (ว่าง/ค้าง) ⇒ Day-Off ที่ลงใน HR ไม่ถูกยกเว้น คนหยุดยังโดนหัก "ส่งรายงานสาย"
  // ช่วงวันที่: ครอบคลุมทุกวันที่ sweep ย้อนดู (LOOKBACK) บวกเผื่อ
  const rangeFrom = new Date();
  rangeFrom.setDate(rangeFrom.getDate() - REPORT_PENALTY_LOOKBACK_DAYS - 7);
  const rangeTo = new Date();
  rangeTo.setDate(rangeTo.getDate() + 7);
  const fromStr = rangeFrom.toISOString().slice(0, 10);
  const toStr = rangeTo.toISOString().slice(0, 10);

  const [settings, { data: featureEnabled }, { data: enabledSince }, { data: graceDaysRaw }, { data: reportFeed }, users, leaves, workforceHolidays, { data: routine }, { data: reminderSettingsRaw }] =
    await Promise.all([
      loadPerformanceSettings(orgId),
      readStore<boolean>(orgId, "report-penalty-settings"),
      readStore<string>(orgId, "report-penalty-enabled-since"),
      readStore<number>(orgId, "report-penalty-grace-days"),
      readStore<{ topics: ReportTopic[]; posts: ReportPost[]; submitterGroups?: SubmitterGroup[] }>(orgId, "report-feed"),
      listDirectory(orgId),
      listLeaveEvents(orgId, fromStr, toStr),
      listHolidayEvents(orgId, fromStr, toStr),
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
  /*
   * ไม่มี enabledSince (ควรถูกเขียนคู่กับสวิตช์เสมอ แต่เจอจริงว่าบริษัทที่เปิดไว้ก่อน
   * มีค่านี้ไม่มีแถวเลย) ห้ามหักย้อนหลัง จึงเริ่มนับวันนี้ — **และบันทึกเก็บไว้**
   *
   * เดิมแค่ใช้ "วันนี้" ชั่วคราวทุกรอบโดยไม่เคยบันทึก ⇒ เพดานเลื่อนตามวันไปเรื่อย ๆ
   * sweep ตัดสินได้แค่วันปัจจุบัน วันไหนจบลงโดยไม่ส่งไม่เคยถูกตัดสินเป็น "ไม่ส่ง −2"
   * (ต้องรอให้วันผ่านไปก่อน ซึ่งพอถึงตอนนั้นวันนั้นก็หลุดเพดานไปแล้ว) ค้างเป็น "สาย −1"
   * ตลอด (เจอจริง: ไม่ส่งรอบเย็นเลยแต่โดนแค่ −1) บันทึกครั้งเดียวแล้วเพดานอยู่กับที่
   * วันนี้จะถูกตัดสินครบในวันพรุ่งนี้ตามปกติ — createStoreIfAbsent กันหลายแท็บแข่งกันเขียน
   */
  let notBeforeDay = previewSince ?? enabledSince;
  if (!notBeforeDay && dryRun) notBeforeDay = localDateStr(new Date());
  if (!notBeforeDay) {
    notBeforeDay = localDateStr(new Date());
    const created = await createStoreIfAbsent(orgId, "report-penalty-enabled-since", notBeforeDay, session.userId);
    if (!created.ok) {
      const { data: raced } = await readStore<string>(orgId, "report-penalty-enabled-since");
      if (typeof raced === "string") notBeforeDay = raced;
    }
  }
  /*
   * "คืนคะแนน" ย้อนดูได้ไกลกว่า notBeforeDay — ถึงเต็ม LOOKBACK เสมอ
   *
   * notBeforeDay กันแค่ "หักใหม่ย้อนหลัง" (ห้ามหักวันก่อนเปิดฟีเจอร์) แต่เดิมใช้
   * เป็นเพดานของการคืนคะแนนด้วย ⇒ บริษัทที่ไม่มีค่า enabledSince (fallback =
   * วันนี้) sweep ตัดสินได้แค่ "วันนี้" ทุกรอบ ของเมื่อวานที่หักผิดไปแล้ว (เช่นหัก
   * ตอนยังอ่าน Day-Off จาก HR ไม่ได้) ไม่มีวันถูกตรวจซ้ำอีก ค้าง −1 ตลอดไป
   * (เจอจริง: ส่งรายงานสายวันที่ 27/09 ทั้งที่ Day-Off)
   *
   * วันที่อยู่ก่อน notBeforeDay: คืนได้อย่างเดียว เฉพาะเมื่อวันนั้นไม่ควรถูกหัก
   * เลยแล้ว (exempt/ส่งทัน) — ไม่หักใหม่ ไม่สลับ พลาด<->สาย
   */
  const reconcileFloorDay = localDateStr(new Date(Date.now() - REPORT_PENALTY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000));

  const topics = reportFeed?.topics ?? [];
  const posts = reportFeed?.posts ?? [];
  const groups = reportFeed?.submitterGroups ?? [];
  if (topics.length === 0 || users.length === 0) {
    return Response.json({ ok: true, changed: false });
  }

  // เหมือน store-hydrator.tsx's "holidays" apply — วันหยุดของบริษัทที่บันทึกไว้
  // อาจเก่ากว่าโค้ด (ยังไม่มีวันหยุดไทยปีล่าสุด) เติมของที่ขาดกลับเข้าไปเสมอ
  const existingHolidayIds = new Set(workforceHolidays.map((h) => h.id));
  const mergedHolidays = [
    ...workforceHolidays,
    ...thaiHolidayEvents.filter((h) => !existingHolidayIds.has(h.id)),
  ];

  const exemptions = buildDateExemptions(leaves, mergedHolidays, {
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
    // ตัดสินทั้งช่วง lookback เพื่อใช้ "คืน" — การหักใหม่ยังกรองด้วย notBeforeDay ในลูปข้างล่าง
    reconcileFloorDay < notBeforeDay ? reconcileFloorDay : notBeforeDay
  );

  // "สถานะที่ควร active อยู่ตอนนี้" ต่อ refId — มาจาก candidates (พลาด/สาย)
  // ถ้าไม่อยู่ใน candidates เลยแปลว่าสถานะสดตอนนี้ไม่ใช่พลาด/สายแล้ว (เช่น
  // exempt จากลาย้อนหลัง) จึงไม่ควรมี event ไหน active เหลืออยู่เลย (null)
  const targetCategoryByRefId = new Map<string, "report_missed" | "report_late">();
  for (const c of candidates) {
    targetCategoryByRefId.set(c.refId, c.status === "missed" ? "report_missed" : "report_late");
  }

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
    // candidates เห็นอยู่แล้ว) refId ขึ้นต้นด้วยวันแบบ "YYYY-MM-DD:..." — แค่
    // `gte: notBeforeDay` พอ ไม่ต้องมี upper bound เลย (refId ไม่มีทางเกิน
    // วันนี้ตั้งแต่แรกอยู่แล้ว เพราะ candidates เองก็ไม่เดินเกิน todayStr)
    //
    // เดิมใส่ `lte: `${todayStr}:￿`` ไว้เป็น upper bound sentinel —
    // **บั๊กจริงที่เจอจากการใช้งาน**: U+FFFF เป็น Unicode noncharacter
    // อย่างเป็นทางการ ขึ้นอยู่กับ collation ของคอลัมน์ ฐานข้อมูลอาจไม่ได้เทียบ
    // แบบ byte-order ตรงไปตรงมาเหมือนที่ JavaScript ทำ (ทดสอบใน JS แล้วดูถูก
    // ต้องทุกอย่าง แต่ Postgres จริงกลับกรอง refId เกือบทั้งหมดออกเงียบๆ)
    // ผลคือ query นี้ได้แถวว่างเปล่าตลอด ทำให้ sweep คิดว่าไม่มี event เดิมเลย
    // สักตัว แล้วสร้าง "ของใหม่" ซ้ำทับของเดิมที่ยัง active อยู่โดยไม่คืนคะแนน
    // เก่าให้ก่อน (กลายเป็น -1 กับ -2 ค้างพร้อมกันจริงตามที่เจอ)
    const dayRangeEvents = await tx.performanceEvent.findMany({
      where: {
        orgId,
        source: "report_task",
        refType: { in: ["report_round", "report_round_undo"] },
        refId: { gte: reconcileFloorDay < notBeforeDay ? reconcileFloorDay : notBeforeDay },
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
      // ก่อนวันเริ่มนับ: คืนได้อย่างเดียว (ดูคอมเมนต์ reconcileFloorDay)
      const beforeStart = parsed.day < notBeforeDay;

      for (const original of originals) {
        if (original.category === targetCategory) continue; // ตรงกับสถานะปัจจุบันอยู่แล้ว
        if (beforeStart && targetCategory !== null) continue;
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

      if (!beforeStart && targetCategory && !originals.some((o) => o.category === targetCategory)) {
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
      return dryRun ? { changed: false, dryRun: true, since: notBeforeDay, preview: [] } : { changed: false };
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
    if (dryRun) {
      const nameOf = new Map(users.map((u) => [u.id, u.name] as const));
      const topicName = new Map(topics.map((t) => [t.id, t] as const));
      return {
        changed: false,
        dryRun: true,
        since: notBeforeDay,
        preview: rows.map((r) => {
          const parsed = parseRefId(r.refId ?? "");
          const topic = parsed ? topicName.get(parsed.topicId) : undefined;
          const round = topic?.submissionRounds?.find((x) => x.id === parsed?.roundId);
          return {
            day: parsed?.day,
            user: nameOf.get(r.userId) ?? r.userId,
            room: topic?.name ?? parsed?.topicId,
            round: round ? `${round.label} (${round.time})` : parsed?.roundId,
            change: r.refType === "report_round_undo" ? "คืนคะแนน" : "หักใหม่",
            category: r.category === "report_missed" ? "ไม่ส่ง" : "ส่งสาย",
            points: Number(r.points),
          };
        }),
      };
    }
    if (rows.length === 0) return { changed: false };

    const recorded = await tx.performanceEvent.createMany({ data: rows, skipDuplicates: true });
    return { changed: recorded.count > 0, performanceEvents: recorded.count };
  });

  return Response.json({ ok: true, ...result });
}

// เผื่อ client ฝั่งไหนยิง GET แทน POST มา (เช่นเดียวกับ tasks/sweep, reminders/sweep)
export async function GET(request: Request) {
  return POST(request);
}
