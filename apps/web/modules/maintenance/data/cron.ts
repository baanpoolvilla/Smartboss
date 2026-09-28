import "server-only";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";

import { nextWorkOrderCode } from "@/lib/document-code";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { notifyUser, notifyUsers, propertyCaretaker } from "@/modules/maintenance/data/notify";
import {
  loadPerformanceSettingsMap,
  recordPerformanceEvents,
  type PerformanceEventInput,
  type PerformanceSettings,
} from "@/lib/performance";
import {
  addDays,
  isBacklog,
  pmDockRevokeReason,
  workOrderDockRevokeReason,
} from "@/modules/maintenance/lib/dock-validity";

/**
 * สร้างใบงานอัตโนมัติจาก PM ที่ถึงกำหนด (แทน DB trigger เดิมของ ChangYai)
 * ทำงานข้ามทุกบริษัท (platform job) — เรียกจาก cron route
 */
export async function generateWorkOrdersForDuePms(): Promise<{
  due: number;
  created: number;
}> {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const duePms = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.pmSchedule.findMany({
      where: {
        isActive: true,
        awaitingSchedule: false,
        nextDueDate: { lte: today },
      },
    })
  );

  await closeStaleAutoWorkOrders();

  let created = 0;
  for (const pm of duePms) {
    /**
     * ข้ามถ้ามีใบงานที่ยังไม่ปิดผูก PM นี้อยู่แล้ว (กันสร้างซ้ำ)
     *
     * ⚠ ต้องดู `pmScheduleIds` (ใบงานรวมหลาย PM ที่เปิดจากปฏิทิน) ด้วย ไม่ใช่
     * แค่ `pmScheduleId` — ใบงานรวมเก็บ id ไว้ในอาร์เรย์เท่านั้น ส่วน
     * pmScheduleId เป็น null ⇒ เช็คแบบเดิมมองไม่เห็น แล้ว cron จะเปิดใบงาน
     * อัตโนมัติซ้อนขึ้นมาอีกใบทั้งที่คนกำลังทำรอบนั้นอยู่ ("ปิดแล้วเปิดมาใหม่")
     * ใบซ้อนนั้นไม่มีใครปิดเพราะไม่ใช่ใบที่คนทำงานถืออยู่ แล้วมันจะค้างเป็น
     * open ตลอด ⇒ รอบถัดไป ๆ cron เห็นว่า "มีใบค้างอยู่" แล้วข้ามตลอดไป
     * (อาการ "PM ไม่นับรอบต่อไป") — หน้า /maintenance/pm เช็คทั้งสองช่องอยู่
     * แล้ว (ตัวแปร `pending`) ตรงนี้คือที่เดียวที่ยังเช็คไม่ครบ
     */
    const existing = await prisma.workOrder.findFirst({
      where: {
        orgId: pm.orgId,
        status: { in: ["open", "in_progress"] },
        OR: [{ pmScheduleId: pm.id }, { pmScheduleIds: { has: pm.id } }],
      },
    });
    if (existing) continue;

    // ใบงานที่ระบบสร้างเองก็ต้องมีเลขที่เหมือนใบที่คนสร้าง ไม่งั้นช่างอ้างถึงไม่ได้
    const made = await prisma.$transaction(async (tx) => {
      // กันสองรอบของ cron ที่วิ่งทับกัน (หรือคนเปิดใบเองพร้อมกัน) เห็น "ยังไม่มีใบ" พร้อมกัน
      // แล้วสร้างซ้อนสองใบ — ล็อกต่อ PM แล้วเช็คซ้ำในทรานแซกชันเดียวกัน
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pm-auto-wo:${pm.id}`}))`;
      const again = await tx.workOrder.findFirst({
        where: {
          orgId: pm.orgId,
          status: { in: ["open", "in_progress"] },
          OR: [{ pmScheduleId: pm.id }, { pmScheduleIds: { has: pm.id } }],
        },
        select: { id: true },
      });
      if (again) return false;
      const code = await nextWorkOrderCode(tx, pm.orgId);
      await tx.workOrder.create({
        data: {
          orgId: pm.orgId,
          code,
          propertyId: pm.propertyId,
          assetId: pm.assetId,
          assignedTo: pm.assignedTo,
          title: pm.title,
          description: `PM: ${pm.title}\nครบกำหนด ${fmtThaiDate(pm.nextDueDate)}`,
          status: "open",
          priority: "medium",
          pmScheduleId: pm.id,
          ccUserIds: pm.ccUserIds,
          // สืบทอดจากแผน PM — งานที่จ้างเหมารายปีไว้แล้วไม่มีค่าใช้จ่ายแยกต่อครั้ง
          // ถ้าไม่สืบทอด ระบบจะทวงให้บันทึกค่าใช้จ่ายทุกใบจนคนกรอก 0 ไปเรื่อย ๆ
          requiresExpense: pm.requiresExpense,
          autoCreated: true,
        },
      });
      return true;
    });
    if (made) created++;
  }

  return { due: duePms.length, created };
}

/**
 * เก็บกวาดใบงานอัตโนมัติที่ค้าง open ทั้งที่รอบของมันจบไปแล้ว — ของเก่าก่อนมี
 * closeAutoWorkOrdersOfPm (data/pm.ts) ที่ยังโผล่ในรายการใบงานซ้ำ ๆ
 *
 *   PM เดียวมีใบเปิดซ้อนหลายใบ                   → เก็บใบเดียว ที่เหลือยกเลิก
 *   PM ถูกลบ/ปิดใช้งาน                          → ยกเลิก
 *   PM ถูกปิดรอบ (lastCompletedDate) หลังเปิดใบนี้ → ปิดเป็นเสร็จ (รอบนั้นทำแล้ว)
 */
async function closeStaleAutoWorkOrders(): Promise<void> {
  const open = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.workOrder.findMany({
      where: { autoCreated: true, status: { in: ["open", "in_progress"] }, pmScheduleId: { not: null } },
      select: { id: true, orgId: true, pmScheduleId: true, createdAt: true },
    })
  );
  if (open.length === 0) return;

  // ใบซ้อน: PM เดียวมีใบเปิดค้างหลายใบ (cron วิ่งทับกัน / คนเปิดใบเองทับใบอัตโนมัติ)
  // เก็บไว้ใบเดียว — ใบที่คนเปิดเองก่อน ไม่มีก็ใบอัตโนมัติที่เก่าสุด ที่เหลือยกเลิก
  const pmIds = [...new Set(open.map((w) => w.pmScheduleId!))];
  const manual = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.workOrder.findMany({
      where: {
        autoCreated: false,
        status: { in: ["open", "in_progress"] },
        OR: [{ pmScheduleId: { in: pmIds } }, { pmScheduleIds: { hasSome: pmIds } }],
      },
      select: { pmScheduleId: true, pmScheduleIds: true },
    })
  );
  const hasManual = new Set(manual.flatMap((w) => [...(w.pmScheduleId ? [w.pmScheduleId] : []), ...w.pmScheduleIds]));
  const keptAuto = new Set<string>();
  const duplicates: typeof open = [];
  for (const wo of [...open].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (hasManual.has(wo.pmScheduleId!) || keptAuto.has(wo.pmScheduleId!)) duplicates.push(wo);
    else keptAuto.add(wo.pmScheduleId!);
  }
  for (const wo of duplicates) {
    await prisma.workOrder.updateMany({
      where: { orgId: wo.orgId, id: wo.id, status: { in: ["open", "in_progress"] } },
      data: { status: "cancelled", completionNotes: "ยกเลิกอัตโนมัติ — ใบซ้อน PM รอบเดียวกันมีใบงานอื่นเปิดอยู่แล้ว" },
    });
  }
  const dupIds = new Set(duplicates.map((w) => w.id));

  const pms = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.pmSchedule.findMany({
      where: { id: { in: pmIds } },
      select: { id: true, isActive: true, lastCompletedDate: true },
    })
  );
  const pmById = new Map(pms.map((p) => [p.id, p]));

  for (const wo of open) {
    if (dupIds.has(wo.id)) continue;
    const pm = pmById.get(wo.pmScheduleId!);
    // lastCompletedDate เก็บเป็นวันล้วน — เทียบระดับวัน (ปิดรอบวันเดียวกับที่เปิดใบก็นับ)
    const doneAfter =
      pm?.lastCompletedDate &&
      pm.lastCompletedDate.toISOString().slice(0, 10) >= wo.createdAt.toISOString().slice(0, 10);
    if (pm && pm.isActive && !doneAfter) continue;
    await prisma.workOrder.updateMany({
      where: { orgId: wo.orgId, id: wo.id },
      data: doneAfter
        ? {
            status: "completed",
            completedAt: new Date(),
            completionNotes: "ปิดอัตโนมัติ — รอบนี้ถูกปิดที่หน้าแผน PM แล้ว",
            requiresExpense: false,
          }
        : { status: "cancelled", completionNotes: "ยกเลิกอัตโนมัติ — แผน PM ถูกลบหรือปิดใช้งาน" },
    });
  }
}

/** true = วันนี้ควรแจ้งเตือน PM นี้ตามระยะห่างจากกำหนด — ไม่ใช่ "ถึงเกณฑ์แล้วเงียบ
 * ไปเลย", เกณฑ์นี้กันสแปม (เดิมแจ้งซ้ำทุกวันไม่มีเงื่อนไขเลย ยิงทุก PM ที่ยัง
 * ไม่ถึง/เลยกำหนดทุกครั้งที่ cron รัน — พอ cron หยุดทำงานไปพักหนึ่งแล้วกลับมา
 * รันอีกที เลยเทกองแจ้งเตือนที่ค้างไว้ทั้งหมดออกมาพร้อมกันทีเดียว
 * "เหมือนไม่มีแจ้ง...แล้วแจ้งทีเป็นชุดใหญ่ๆ") และกันเงียบหาย (ไม่แจ้งเฉพาะวันที่
 * เพิ่งครบกำหนดแล้วปล่อยเลยไปเรื่อยๆ) — ยืนยันจากเจ้าของระบบ: เตือนล่วงหน้า
 * 7/3/1 วัน + วันที่ถึงกำหนด แล้วพอเลยกำหนดไปแล้ว เตือนซ้ำทุก 3 วัน (1, 4, 7, ...
 * วันที่เลยมา) แทนที่จะแจ้งทุกวันจนกว่าจะปิดงาน
 *
 * ขึ้นกับ cron งานนี้ถูกเรียกทุกวันจริง — ถ้าขาดไปวันใดวันหนึ่งพอดีกับวันที่
 * ตรงเกณฑ์ ก็จะข้ามรอบนั้นไปเงียบๆ (ไม่มีการจำ "เคยแจ้งไปแล้วหรือยัง" แยกต่างหาก
 * ในฐานข้อมูล) แต่ยังดีกว่าเดิมมาก เพราะไม่มีทางเทกองสแปมอีกต่อไป
 */
function shouldNotifyPmToday(daysUntilDue: number): boolean {
  if (daysUntilDue >= 0) return [7, 3, 1, 0].includes(daysUntilDue);
  const overdueDays = -daysUntilDue;
  return (overdueDays - 1) % 3 === 0; // 1, 4, 7, 10 วันที่เลยกำหนดมา
}

/**
 * แจ้งเตือน PM ที่ใกล้ครบกำหนด/เกินกำหนด (ภายใน 7 วัน) — เฉพาะวันที่ตรงเกณฑ์
 * ของ shouldNotifyPmToday เท่านั้น ไม่ใช่ทุกวันที่ยังไม่ถึง/เลยกำหนด
 * ส่งให้ช่างที่รับผิดชอบ + ผู้ดูแลบ้าน (port จาก notifyPmDueSoon)
 */
export async function notifyDuePmSchedules(): Promise<{ notified: number }> {
  const soon = new Date();
  soon.setHours(23, 59, 59, 999);
  soon.setDate(soon.getDate() + 7);

  const pms = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.pmSchedule.findMany({
      where: { isActive: true, awaitingSchedule: false, nextDueDate: { lte: soon } },
    })
  );

  let notified = 0;
  for (const pm of pms) {
    const [property, asset] = await Promise.all([
      prisma.property.findUnique({
        where: { id: pm.propertyId },
        select: { name: true },
      }),
      pm.assetId
        ? prisma.asset.findUnique({
            where: { id: pm.assetId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(pm.nextDueDate);
    due.setHours(0, 0, 0, 0);
    const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);

    if (!shouldNotifyPmToday(days)) continue;

    const statusText =
      days < 0
        ? `⚠️ เกินกำหนด ${-days} วัน`
        : days === 0
          ? "⏰ ถึงกำหนดวันนี้"
          : `⏰ อีก ${days} วัน`;
    const head = days <= 0 ? "🔴" : "🟡";

    const line =
      `${head} แจ้งเตือน PM\n` +
      `📋 ${pm.title}\n` +
      `🏠 บ้าน: ${property?.name ?? "-"}\n` +
      `🔧 อุปกรณ์: ${asset?.name ?? "-"}\n` +
      (pm.description ? `📝 รายละเอียด: ${pm.description}\n` : "") +
      `📅 กำหนด: ${fmtThaiDate(pm.nextDueDate)}\n` +
      statusText;

    const targets = [
      pm.assignedTo,
      ...pm.ccUserIds,
      ...(await propertyCaretaker(pm.orgId, pm.propertyId)),
    ];
    await notifyUsers(pm.orgId, targets, {
      title: `${head} PM ${statusText}: ${pm.title}`,
      body: `บ้าน: ${property?.name ?? "-"} • กำหนด ${fmtThaiDate(pm.nextDueDate)}`,
      type: "pm",
      referenceId: pm.id,
      line,
    });
    notified++;
  }

  return { notified };
}

/**
 * เตือนใบงานที่ปิดแล้วแต่ยังไม่บันทึกค่าใช้จ่าย
 * (port จาก checkAndNotifyMissingExpenses — เดิมรันทุกวัน 17:00)
 */
export async function notifyMissingExpenses(): Promise<{ reminded: number }> {
  const rows = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.expense.findMany({
      where: { workOrderId: { not: null } },
      select: { workOrderId: true },
    })
  );
  const withExpense = rows
    .map((r) => r.workOrderId)
    .filter((x): x is string => !!x);

  const orders = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.workOrder.findMany({
      where: {
        status: "completed",
        // ใบงานที่ตั้งไว้ว่าไม่มีค่าใช้จ่ายต้องไม่ถูกทวง — ไม่งั้นทวงไปก็ไม่มีอะไรให้กรอก
        // แล้วคนจะบันทึก 0 บาทเพื่อให้เตือนหาย ซึ่งทำให้รายงานค่าใช้จ่ายเชื่อไม่ได้
        requiresExpense: true,
        ...(withExpense.length > 0 ? { id: { notIn: withExpense } } : {}),
      },
    })
  );

  // รวมเป็นสรุปรายคนที่รับผิดชอบ (ผู้รับมอบหมาย ไม่งั้นตกเป็นของผู้สร้างงาน)
  // แทนการยิงหาผู้จัดการทั้งบริษัท — เพื่อไม่ให้คนที่ไม่เกี่ยวข้องกับใบงานนั้นเห็น
  // แจ้งเตือนของบ้าน/งานที่ตัวเองไม่ได้รับผิดชอบ ใบงานที่ไม่มีทั้งสองอย่างข้ามไป
  // เพราะไม่มีใครให้เตือน
  const byResponsible = new Map<string, { orgId: string; orders: typeof orders }>();
  for (const o of orders) {
    const responsible = o.assignedTo ?? o.createdBy;
    if (!responsible) continue;
    if (!byResponsible.has(responsible)) byResponsible.set(responsible, { orgId: o.orgId, orders: [] });
    byResponsible.get(responsible)!.orders.push(o);
  }

  let reminded = 0;
  for (const [userId, { orgId, orders: list }] of byResponsible) {
    const titles = list
      .slice(0, 10)
      .map((o) => `- ${o.title}`)
      .join("\n");
    await notifyUser(orgId, userId, {
      title: `🧾 มีใบงาน ${list.length} ใบยังไม่บันทึกค่าใช้จ่าย`,
      body: titles,
      type: "expense",
      line:
        `🧾 เตือนบันทึกค่าใช้จ่าย\n` +
        `มีใบงานเสร็จแล้ว ${list.length} ใบที่ยังไม่บันทึกค่าใช้จ่าย\n${titles}`,
    });
    reminded += list.length;
  }

  return { reminded };
}

/**
 * หักคะแนนงานที่ปล่อยค้าง — ใบงานเลยกำหนด และ PM ที่ไม่ได้ทำตามรอบ
 *
 * นี่คือส่วนที่ทำให้ผู้บริหารเห็นว่าใคร "ปล่อยปละละเลย" — ใบงานที่มอบหมายแล้ว
 * เลยกำหนดโดยยังไม่ปิด และรอบบำรุงรักษาที่ค้างเกินกำหนดนาน จะกลายเป็นคะแนนติดลบ
 * ของผู้รับผิดชอบในหน้าสรุปรายคน (ดู lib/performance.ts)
 *
 * ใบงานที่ไม่มีผู้รับผิดชอบจะตกไปที่ผู้ดูแลบ้านของทรัพย์สินนั้นแทน — งานที่ไม่มี
 * ใครรับผิดชอบคือปัญหาของคนที่ดูแลบ้านหลังนั้นอยู่ดี
 *
 * ปลอดภัยเมื่อรันซ้ำ: recordPerformanceEvents กันหักซ้ำด้วยต้นเรื่องเดียวกัน
 *
 * occurredAt ใช้ "วันที่ตรวจพบ" ไม่ใช่ "วันที่ครบกำหนด" โดยตั้งใจ — ถ้าใช้วันครบกำหนด
 * งานที่ปล่อยค้างไว้นานจะหลุดออกนอกช่วงรายงานทันทีที่เกิน 30 วัน กลายเป็นว่ายิ่งปล่อย
 * นานยิ่งไม่โดนหัก ซึ่งกลับหัวกลับหางกับสิ่งที่ควรเป็น วันครบกำหนดเดิมเก็บไว้ใน note
 */
export async function dockOverdueMaintenance(): Promise<{
  workOrders: number;
  pmSchedules: number;
  recorded: number;
  revoked: number;
}> {
  const now = new Date();
  const events: PerformanceEventInput[] = [];

  // เกณฑ์ผ่อนผัน PM ตั้งค่าได้รายบริษัท — งานนี้วิ่งข้ามบริษัท จึงดึงด้วยเกณฑ์
  // ที่ผ่อนผันน้อยที่สุดก่อน แล้วกรองตามเกณฑ์ของแต่ละบริษัททีหลัง
  const orgs = await prisma.organization.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  const settingsByOrg = await loadPerformanceSettingsMap(orgs.map((o) => o.id));
  const activeSettings = [...settingsByOrg.values()].filter((s) => s.enabled);
  if (activeSettings.length === 0) {
    return { workOrders: 0, pmSchedules: 0, recorded: 0, revoked: 0 };
  }

  // คืนคะแนนที่ไม่ถูกต้องแล้ว "ก่อน" หักรอบนี้ — ใบงานที่ย้ายคนรับผิดชอบจะถูกถอนจาก
  // คนเดิมแล้วหักคนปัจจุบันได้ในรอบเดียวกัน (unique key ไม่มี userId ถ้าหักก่อน
  // แถวของคนเดิมจะกันไว้)
  await cancelTwinWorkOrders();
  const revoked = await revokeInvalidMaintenanceDocks(settingsByOrg);
  const minPmGraceDays = Math.min(...activeSettings.map((s) => s.pmGraceDays));
  const minWorkOrderGraceDays = Math.min(
    ...activeSettings.map((s) => s.workOrderGraceDays),
  );

  // ── ใบงานที่เลยกำหนดเกินระยะผ่อนผันแล้วยังไม่ปิด ──
  // ผ่อนผันได้เหมือน PM (ตั้งค่าได้ที่ /admin/performance/settings) — ค่าเริ่มต้น 0
  // รักษาพฤติกรรมเดิม (หักทันทีที่เลยกำหนด) ของบริษัทที่ยังไม่เคยตั้งค่า
  const workOrderGraceDate = new Date(now);
  workOrderGraceDate.setDate(workOrderGraceDate.getDate() - minWorkOrderGraceDays);

  const overdue = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.workOrder.findMany({
      where: {
        status: { in: ["open", "in_progress"] },
        dueDate: { lt: workOrderGraceDate },
      },
      select: {
        id: true,
        orgId: true,
        title: true,
        dueDate: true,
        assignedTo: true,
        property: { select: { caretakerId: true, name: true } },
      },
    })
  );

  for (const wo of overdue) {
    const woSt = settingsByOrg.get(wo.orgId);
    if (!woSt || !woSt.enabled) continue;

    if (wo.dueDate === null) continue; // where: { lt: ... } กันไว้แล้วจริง ๆ ไม่มีทางเข้า แต่ TS ไม่รู้

    // กรองอีกชั้นด้วยระยะผ่อนผันของบริษัทนั้นจริง ๆ (ข้างบนดึงมาด้วยระยะสั้นสุดก่อน)
    const lapse = addDays(wo.dueDate, woSt.workOrderGraceDays);
    if (lapse >= now) continue;
    // เลยกำหนดไปตั้งแต่ก่อนวันเริ่มนับคะแนน = งานค้างเก่า ไม่ใช่การปล่อยปละในช่วงที่นับ —
    // เดิม occurredAt = วันที่ตรวจพบ (หลังวันเริ่มนับเสมอ) งานค้างเก่าเลยโดนหักทั้งกอง
    if (woSt.scoringStartDate && lapse < woSt.scoringStartDate) continue;
    if (isBacklog(lapse, now)) continue; // ค้างมาก่อนระบบเห็น — ดู BACKLOG_DAYS

    const responsible = wo.assignedTo ?? wo.property?.caretakerId;
    if (!responsible) continue; // ไม่มีใครรับผิดชอบเลย — หักใครไม่ได้
    events.push({
      orgId: wo.orgId,
      userId: responsible,
      source: "maintenance",
      category: "workorder_overdue",
      occurredAt: now,
      refType: "work_order",
      refId: wo.id,
      note: `${wo.title}${wo.property?.name ? ` · ${wo.property.name}` : ""} · ครบกำหนด ${fmtThaiDate(wo.dueDate)}`,
    });
  }

  // ── PM ที่เลยกำหนดเกินระยะผ่อนผัน ──
  // เผื่อเวลาก่อนถือว่าปล่อยปละละเลย เพราะ generateWorkOrdersForDuePms เพิ่งสร้าง
  // ใบงานให้ตอนถึงกำหนด ควรให้เวลาทำก่อน (ตั้งค่าได้ที่ /admin/performance/settings)
  const graceDate = new Date(now);
  graceDate.setDate(graceDate.getDate() - minPmGraceDays);

  const latePms = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.pmSchedule.findMany({
      // awaitingSchedule = ครบจำนวนรอบแล้ว รอนัดวันใหม่ — ปฏิทิน/แดชบอร์ด/ตัวสร้างใบงาน
      // ไม่นับว่าค้าง มีแต่ตรงนี้ที่เคยหัก "ไม่ทำตามรอบ" ทั้งที่ไม่มีรอบให้ทำ
      where: { isActive: true, awaitingSchedule: false, nextDueDate: { lt: graceDate } },
      select: {
        id: true,
        orgId: true,
        title: true,
        nextDueDate: true,
        assignedTo: true,
        property: { select: { caretakerId: true, name: true } },
      },
    })
  );

  // PM ที่มีใบงานเปิดอยู่และใบนั้นมีวันครบกำหนดของตัวเอง — วันของใบงานคือกำหนดจริง
  // (ผู้จัดการนัดไว้แล้ว) ถ้าเลยก็โดน "ใบงานเกินกำหนด" อยู่แล้ว ไม่หัก "ไม่ทำตามรอบ" ซ้อน
  const pmIdsWithDatedWo = new Set<string>();
  if (latePms.length > 0) {
    const ids = latePms.map((p) => p.id);
    const dated = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
      prisma.workOrder.findMany({
        where: {
          status: { in: ["open", "in_progress"] },
          dueDate: { not: null },
          OR: [{ pmScheduleId: { in: ids } }, { pmScheduleIds: { hasSome: ids } }],
        },
        select: { pmScheduleId: true, pmScheduleIds: true },
      })
    );
    for (const w of dated) {
      if (w.pmScheduleId) pmIdsWithDatedWo.add(w.pmScheduleId);
      for (const id of w.pmScheduleIds) pmIdsWithDatedWo.add(id);
    }
  }

  for (const pm of latePms) {
    const st = settingsByOrg.get(pm.orgId);
    if (!st || !st.enabled) continue;
    if (pmIdsWithDatedWo.has(pm.id)) continue;

    // กรองอีกชั้นด้วยระยะผ่อนผันของบริษัทนั้นจริง ๆ
    const lapse = addDays(pm.nextDueDate, st.pmGraceDays);
    if (lapse >= now) continue;
    if (st.scoringStartDate && lapse < st.scoringStartDate) continue;
    if (isBacklog(lapse, now)) continue;

    const responsible = pm.assignedTo ?? pm.property?.caretakerId;
    if (!responsible) continue;
    events.push({
      orgId: pm.orgId,
      userId: responsible,
      source: "maintenance",
      category: "pm_missed",
      occurredAt: now,
      refType: "pm_schedule",
      // รอบเป็นตัวแยก — PM ตัวเดิมค้างคนละรอบต้องหักแยกกัน
      refId: `${pm.id}:${pm.nextDueDate.toISOString().slice(0, 10)}`,
      note: `${pm.title}${pm.property?.name ? ` · ${pm.property.name}` : ""} · ครบกำหนด ${fmtThaiDate(pm.nextDueDate)}`,
    });
  }

  const recorded = await recordPerformanceEvents(events);
  return { workOrders: overdue.length, pmSchedules: latePms.length, recorded, revoked };
}

/** ใบงานที่สร้างห่างกันไม่เกินนี้ โดยคนเดียวกัน บ้านเดียวกัน หัวข้อเดียวกัน = กดบันทึกซ้ำ */
const TWIN_WINDOW_MS = 2 * 60_000;

/**
 * ยกเลิกใบงานแฝด — กดบันทึกสองทีตอนเน็ตช้าได้ใบงานสองใบเหมือนกันเป๊ะ (ก่อนมีตัวกันใน
 * SaveFeedback) คนทำปิดไปใบหนึ่ง อีกใบค้าง open จนเลยกำหนดแล้วโดนหัก "ใบงานเกินกำหนด"
 * ทั้งที่งานเสร็จแล้ว ("ปิดไปแล้วแต่ใบงานซ้ำ")
 *
 * ใบที่ยัง open และมีแฝด: ถ้าแฝดปิดเสร็จแล้ว → ยกเลิกใบนี้ · ถ้าแฝดยังเปิดทั้งคู่ → เก็บใบเก่าสุด
 * ยกเลิกใบที่เหลือ — ใบที่ถูกยกเลิก คะแนนที่หักไปจะถูกคืนใน revokeInvalidMaintenanceDocks
 */
async function cancelTwinWorkOrders(): Promise<void> {
  const open = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.workOrder.findMany({
      where: { status: { in: ["open", "in_progress"] }, autoCreated: false, createdBy: { not: null } },
      select: { id: true, orgId: true, propertyId: true, title: true, createdBy: true, createdAt: true },
    })
  );
  if (open.length === 0) return;
  const siblings = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.workOrder.findMany({
      where: {
        status: { in: ["open", "in_progress", "completed"] },
        autoCreated: false,
        propertyId: { in: [...new Set(open.map((w) => w.propertyId))] },
        createdBy: { in: [...new Set(open.map((w) => w.createdBy!))] },
      },
      select: { id: true, orgId: true, propertyId: true, title: true, createdBy: true, createdAt: true, status: true },
    })
  );

  const key = (w: { orgId: string; propertyId: string; title: string; createdBy: string | null }) =>
    `${w.orgId}|${w.propertyId}|${w.createdBy}|${w.title.trim().toLowerCase()}`;
  const byKey = new Map<string, typeof siblings>();
  for (const s of siblings) byKey.set(key(s), [...(byKey.get(key(s)) ?? []), s]);

  for (const wo of open) {
    const twins = (byKey.get(key(wo)) ?? []).filter(
      (s) => s.id !== wo.id && Math.abs(s.createdAt.getTime() - wo.createdAt.getTime()) <= TWIN_WINDOW_MS,
    );
    const doneTwin = twins.some((s) => s.status === "completed");
    const olderOpenTwin = twins.some(
      (s) => (s.status === "open" || s.status === "in_progress") && (s.createdAt < wo.createdAt || (s.createdAt.getTime() === wo.createdAt.getTime() && s.id < wo.id)),
    );
    if (!doneTwin && !olderOpenTwin) continue;
    await prisma.workOrder.updateMany({
      where: { orgId: wo.orgId, id: wo.id, status: { in: ["open", "in_progress"] } },
      data: {
        status: "cancelled",
        completionNotes: "ยกเลิกอัตโนมัติ — ใบงานซ้ำ (บันทึกซ้ำ) มีอีกใบที่เหมือนกันอยู่แล้ว",
      },
    });
    // ใบที่ยกเลิกไปแล้วต้องไม่ถูกนับเป็นแฝดที่ "ยังเปิด" ของใบถัดไปในรอบเดียวกัน
    const self = siblings.find((s) => s.id === wo.id);
    if (self) self.status = "cancelled";
  }
}

/**
 * คืนคะแนนงานซ่อมที่หักไปแล้วแต่ไม่ถูกต้องอีกต่อไป — เดิมหักแล้วไม่เคยคืนเลย
 * (ต่างจากรายงาน/ลงเวลาที่คืนเองได้) ยกเลิก/ลบใบงาน ย้ายคน เลื่อนกำหนด ก็ยังค้าง
 * เป็นคะแนนติดลบตลอด ("ตัดคะแนนเละเทะ ทั้งที่เค้าเคลียแล้ว")
 *
 * ลบเฉพาะรายการที่ระบบหักเอง (createdBy = null) ไม่แตะที่หัวหน้ากดหักเอง
 * ทุกเงื่อนไขตรงข้ามกับเงื่อนไขการหักด้านบน — ถ้ายังเข้าเกณฑ์หัก (เช่นย้ายคนแล้ว
 * แต่งานยังค้าง) รอบหักถัดไปจะหักคนที่รับผิดชอบตอนนี้แทน ไม่มีการคืน-หักวนไปมา
 *
 *   ใบงานเกินกำหนด  ใบงานถูกลบ/ยกเลิก · กำหนดส่งถูกเลื่อนไปหลังวันที่โดนหัก ·
 *                  ปิดงานทันกำหนด · เลยกำหนดตั้งแต่ก่อนวันเริ่มนับคะแนน ·
 *                  งานยังค้างแต่ย้ายไปคนอื่นแล้ว
 *   ไม่ทำตามรอบ     แผน PM ถูกลบ/ปิดใช้งาน · รอบนั้นเลยกำหนดตั้งแต่ก่อนวันเริ่มนับ ·
 *                  PM อยู่ในสถานะรอนัดรอบใหม่ · รอบยังค้างแต่ย้ายไปคนอื่นแล้ว ·
 *                  ซ้อนกับ "ใบงานเกินกำหนด" ของใบงานที่ผูก PM เดียวกันในรอบนั้น
 */
async function revokeInvalidMaintenanceDocks(
  settingsByOrg: Map<string, PerformanceSettings>,
): Promise<number> {
  const docks = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.performanceEvent.findMany({
      where: {
        source: "maintenance",
        category: { in: ["workorder_overdue", "pm_missed"] },
        createdBy: null,
      },
      select: { id: true, orgId: true, userId: true, category: true, refId: true, occurredAt: true },
    }),
  );
  if (docks.length === 0) return 0;

  const woIds = docks.filter((d) => d.category === "workorder_overdue" && d.refId).map((d) => d.refId!);
  const pmIds = [
    ...new Set(docks.filter((d) => d.category === "pm_missed" && d.refId).map((d) => d.refId!.split(":")[0]!)),
  ];

  const [wos, pms, linkedWos] = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    Promise.all([
      prisma.workOrder.findMany({
        where: { id: { in: woIds } },
        select: {
          id: true, status: true, dueDate: true, completedAt: true, assignedTo: true,
          property: { select: { caretakerId: true } },
        },
      }),
      prisma.pmSchedule.findMany({
        where: { id: { in: pmIds } },
        select: {
          id: true, isActive: true, awaitingSchedule: true, nextDueDate: true, assignedTo: true,
          property: { select: { caretakerId: true } },
        },
      }),
      prisma.workOrder.findMany({
        where: { OR: [{ pmScheduleId: { in: pmIds } }, { pmScheduleIds: { hasSome: pmIds } }] },
        select: { id: true, createdAt: true, completedAt: true, pmScheduleId: true, pmScheduleIds: true },
      }),
    ]),
  );
  const woById = new Map(wos.map((w) => [w.id, w]));
  const pmById = new Map(pms.map((p) => [p.id, p]));
  const woDockedBy = new Map(
    docks.filter((d) => d.category === "workorder_overdue" && d.refId).map((d) => [d.refId!, d.userId]),
  );

  const toRevoke: string[] = [];
  for (const d of docks) {
    const st = settingsByOrg.get(d.orgId);
    if (!st || !st.enabled || !d.refId) continue;

    let reason: string | null;
    if (d.category === "workorder_overdue") {
      const wo = woById.get(d.refId);
      reason = workOrderDockRevokeReason(
        d,
        wo && { ...wo, caretakerId: wo.property?.caretakerId ?? null },
        st,
      );
    } else {
      const pm = pmById.get(d.refId.split(":")[0]!);
      reason = pmDockRevokeReason(
        { ...d, refId: d.refId },
        pm && { ...pm, caretakerId: pm.property?.caretakerId ?? null },
        linkedWos,
        woDockedBy,
        st,
      );
    }
    if (reason) toRevoke.push(d.id);
  }

  if (toRevoke.length === 0) return 0;
  const result = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.performanceEvent.deleteMany({ where: { id: { in: toRevoke }, createdBy: null } }),
  );
  return result.count;
}
