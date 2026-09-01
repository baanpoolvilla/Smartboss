import "server-only";
import { prisma } from "@smartboss/database";

import { nextWorkOrderCode } from "@/lib/document-code";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { notifyUsers, managersAndCaretaker } from "@/modules/maintenance/data/notify";
import {
  loadPerformanceSettingsMap,
  recordPerformanceEvents,
  type PerformanceEventInput,
} from "@/lib/performance";

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

  const duePms = await prisma.pmSchedule.findMany({
    where: {
      isActive: true,
      awaitingSchedule: false,
      nextDueDate: { lte: today },
    },
  });

  let created = 0;
  for (const pm of duePms) {
    // ข้ามถ้ามีใบงานที่ยังไม่ปิดผูก PM นี้อยู่แล้ว (กันสร้างซ้ำ)
    const existing = await prisma.workOrder.findFirst({
      where: {
        orgId: pm.orgId,
        pmScheduleId: pm.id,
        status: { in: ["open", "in_progress"] },
      },
    });
    if (existing) continue;

    // ใบงานที่ระบบสร้างเองก็ต้องมีเลขที่เหมือนใบที่คนสร้าง ไม่งั้นช่างอ้างถึงไม่ได้
    await prisma.$transaction(async (tx) => {
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
    });
    created++;
  }

  return { due: duePms.length, created };
}

/**
 * แจ้งเตือน PM ที่ใกล้ครบกำหนด/เกินกำหนด (ภายใน 7 วัน)
 * ส่งให้ช่างที่รับผิดชอบ + ผู้ดูแลบ้าน + ผู้จัดการ (port จาก notifyPmDueSoon)
 */
export async function notifyDuePmSchedules(): Promise<{ notified: number }> {
  const soon = new Date();
  soon.setHours(23, 59, 59, 999);
  soon.setDate(soon.getDate() + 7);

  const pms = await prisma.pmSchedule.findMany({
    where: { isActive: true, awaitingSchedule: false, nextDueDate: { lte: soon } },
  });

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
      ...(await managersAndCaretaker(pm.orgId, pm.propertyId)),
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
  const rows = await prisma.expense.findMany({
    where: { workOrderId: { not: null } },
    select: { workOrderId: true },
  });
  const withExpense = rows
    .map((r) => r.workOrderId)
    .filter((x): x is string => !!x);

  const orders = await prisma.workOrder.findMany({
    where: {
      status: "completed",
      // ใบงานที่ตั้งไว้ว่าไม่มีค่าใช้จ่ายต้องไม่ถูกทวง — ไม่งั้นทวงไปก็ไม่มีอะไรให้กรอก
      // แล้วคนจะบันทึก 0 บาทเพื่อให้เตือนหาย ซึ่งทำให้รายงานค่าใช้จ่ายเชื่อไม่ได้
      requiresExpense: true,
      ...(withExpense.length > 0 ? { id: { notIn: withExpense } } : {}),
    },
  });

  // รวมเป็นสรุปรายบริษัท เพื่อไม่ให้ยิงแจ้งเตือนทีละใบ
  const byOrg = new Map<string, typeof orders>();
  for (const o of orders) {
    if (!byOrg.has(o.orgId)) byOrg.set(o.orgId, []);
    byOrg.get(o.orgId)!.push(o);
  }

  let reminded = 0;
  for (const [orgId, list] of byOrg) {
    const titles = list
      .slice(0, 10)
      .map((o) => `- ${o.title}`)
      .join("\n");
    await notifyUsers(orgId, await managersAndCaretaker(orgId), {
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
    return { workOrders: 0, pmSchedules: 0, recorded: 0 };
  }
  const minPmGraceDays = Math.min(...activeSettings.map((s) => s.pmGraceDays));
  const minWorkOrderGraceDays = Math.min(
    ...activeSettings.map((s) => s.workOrderGraceDays),
  );

  // ── ใบงานที่เลยกำหนดเกินระยะผ่อนผันแล้วยังไม่ปิด ──
  // ผ่อนผันได้เหมือน PM (ตั้งค่าได้ที่ /admin/performance/settings) — ค่าเริ่มต้น 0
  // รักษาพฤติกรรมเดิม (หักทันทีที่เลยกำหนด) ของบริษัทที่ยังไม่เคยตั้งค่า
  const workOrderGraceDate = new Date(now);
  workOrderGraceDate.setDate(workOrderGraceDate.getDate() - minWorkOrderGraceDays);

  const overdue = await prisma.workOrder.findMany({
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
  });

  for (const wo of overdue) {
    const woSt = settingsByOrg.get(wo.orgId);
    if (!woSt || !woSt.enabled) continue;

    if (wo.dueDate === null) continue; // where: { lt: ... } กันไว้แล้วจริง ๆ ไม่มีทางเข้า แต่ TS ไม่รู้

    // กรองอีกชั้นด้วยระยะผ่อนผันของบริษัทนั้นจริง ๆ (ข้างบนดึงมาด้วยระยะสั้นสุดก่อน)
    const orgWorkOrderGrace = new Date(now);
    orgWorkOrderGrace.setDate(orgWorkOrderGrace.getDate() - woSt.workOrderGraceDays);
    if (wo.dueDate >= orgWorkOrderGrace) continue;

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

  const latePms = await prisma.pmSchedule.findMany({
    where: { isActive: true, nextDueDate: { lt: graceDate } },
    select: {
      id: true,
      orgId: true,
      title: true,
      nextDueDate: true,
      assignedTo: true,
      property: { select: { caretakerId: true, name: true } },
    },
  });

  for (const pm of latePms) {
    const st = settingsByOrg.get(pm.orgId);
    if (!st || !st.enabled) continue;

    // กรองอีกชั้นด้วยระยะผ่อนผันของบริษัทนั้นจริง ๆ
    const orgGrace = new Date(now);
    orgGrace.setDate(orgGrace.getDate() - st.pmGraceDays);
    if (pm.nextDueDate >= orgGrace) continue;

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
  return { workOrders: overdue.length, pmSchedules: latePms.length, recorded };
}
