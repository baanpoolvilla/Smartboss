import { workOrderIdOfDockRef, workOrderMemberIds } from "@/modules/maintenance/lib/work-order-members";
import "server-only";
import { prisma, type Prisma } from "@smartboss/database";

import {
  canSeeWorkOrder,
  workOrderVisibilityWhere,
  type WorkOrderAccess,
} from "@/modules/maintenance/data/work-order-access";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { roundDockRefId, roundDockWorkOrderId } from "@/modules/maintenance/lib/pm-rounds";
import { scorePeriodOf, scorePeriodRange } from "@/lib/score-period";
import { loadScorePeriodConfig } from "@/lib/score-period-config";

/**
 * "ใบงานที่มีผลกับคะแนน" บนแดชบอร์ดแจ้งซ่อม — ใบงานเลยกำหนดหักคะแนนผู้รับผิดชอบ (cron.ts
 * dockOverdueMaintenance) แต่เดิมไม่มีที่ไหนบอก ("ไม่รู้หรอกทั้ง CEO user คะแนนพวกนี้โดนหักวันไหนเรื่องไหน")
 *
 * ใบงานใช้กติกาการมองเห็นเดียวกับส่วนอื่นของแดชบอร์ด (workOrderVisibilityWhere)
 * คะแนนที่โดนหัก: ทั้งบริษัทเฉพาะคนที่มีสิทธิ์ดูผลงานรายคน (core.performance.view) — คนอื่นเห็นของตัวเอง
 */
export interface ScoreWatchItem {
  id: string;
  code: string;
  title: string;
  place: string | null;
  dueDate: Date;
  responsibleName: string | null;
  /** คะแนนที่หักใบนี้ไปแล้ว (ติดลบ) — null = ยังไม่โดนหัก (ยังอยู่ในระยะผ่อนผัน/ใบเก่าก่อนเริ่มนับ) */
  docked: number | null;
  /** คำขอแก้คะแนนได้รับอนุมัติแล้ว — คืนคะแนนการหักครั้งนี้ (event work_order_undo) */
  waived?: boolean;
}

export interface ScoreWatch {
  overdue: ScoreWatchItem[];
  overdueCount: number;
  dueSoon: ScoreWatchItem[];
  dueSoonCount: number;
  /** ใบที่ยังไม่ปิด: ยังไม่ถึงกำหนด (เกิน 3 วันข้างหน้า) / ไม่ได้ตั้งวันครบกำหนด — ใช้กับกราฟโดนัท */
  laterCount: number;
  noDueCount: number;
  /** ผลรวมคะแนนที่โดนหักจากงานซ่อม (ใบงาน + PM) เดือนนี้ — ติดลบ */
  monthPoints: number;
  monthDocks: number;
  /** true = ตัวเลขคะแนนเป็นของทั้งบริษัท, false = ของตัวเอง */
  orgWide: boolean;
}

const LIST = 5;
const SOON_DAYS = 3; // วันนี้ พรุ่งนี้ มะรืน

/** เที่ยงคืนวันนี้ตามเวลาไทย (เซิร์ฟเวอร์อาจไม่ได้ตั้ง TZ เป็นไทย) */
function bangkokMidnight(offsetDays = 0): Date {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const d = new Date(`${day}T00:00:00+07:00`);
  d.setTime(d.getTime() + offsetDays * 86_400_000);
  return d;
}

export async function maintenanceScoreWatch(
  orgId: string,
  access: WorkOrderAccess,
  orgWide: boolean,
): Promise<ScoreWatch> {
  const vis = workOrderVisibilityWhere(access);
  const today = bangkokMidnight();
  const soonEnd = bangkokMidnight(SOON_DAYS);
  const period = await loadScorePeriodConfig(orgId);
  // ใบส่วนตัวไม่มีผลกับคะแนน ไม่นับในกล่องนี้
  const openVisible = { orgId, status: { in: ["open", "in_progress"] }, isPrivate: false, AND: vis ? [vis] : [] };
  const select = {
    id: true,
    code: true,
    title: true,
    dueDate: true,
    assignedTo: true,
    groupMemberIds: true,
    property: { select: { name: true, caretakerId: true } },
  } as const;

  const [overdueRows, overdueCount, soonRows, dueSoonCount, month, laterCount, noDueCount] = await Promise.all([
    prisma.workOrder.findMany({
      where: { ...openVisible, dueDate: { lt: today } },
      select,
      orderBy: { dueDate: "asc" },
      take: LIST,
    }),
    prisma.workOrder.count({ where: { ...openVisible, dueDate: { lt: today } } }),
    prisma.workOrder.findMany({
      where: { ...openVisible, dueDate: { gte: today, lt: soonEnd } },
      select,
      orderBy: { dueDate: "asc" },
      take: LIST,
    }),
    prisma.workOrder.count({ where: { ...openVisible, dueDate: { gte: today, lt: soonEnd } } }),
    prisma.performanceEvent.aggregate({
      where: {
        orgId,
        source: "maintenance",
        category: { in: ["workorder_overdue", "pm_missed"] },
        // รอบเกรดปัจจุบัน (ตัดวันที่ 25 — score-period.ts) ไม่ใช่วันที่ 1
        occurredAt: { gte: scorePeriodRange(period, scorePeriodOf(period, new Date())).from },
        ...(orgWide ? {} : { userId: access.userId }),
      },
      _sum: { points: true },
      _count: true,
    }),
    prisma.workOrder.count({ where: { ...openVisible, dueDate: { gte: soonEnd } } }),
    prisma.workOrder.count({ where: { ...openVisible, dueDate: null } }),
  ]);

  const monthUndos = await prisma.performanceEvent.count({
    where: {
      orgId,
      source: "maintenance",
      category: { in: ["workorder_overdue", "pm_missed"] },
      refType: { endsWith: "_undo" },
      occurredAt: { gte: scorePeriodRange(period, scorePeriodOf(period, new Date())).from },
      ...(orgWide ? {} : { userId: access.userId }),
    },
  });
  const rows = [...overdueRows, ...soonRows];
  const responsibleIds = [
    ...new Set(rows.flatMap((r) => [r.assignedTo ?? r.property?.caretakerId, ...r.groupMemberIds]).filter((x): x is string => !!x)),
  ];
  const [users, docks] = await Promise.all([
    responsibleIds.length
      ? prisma.user.findMany({ where: { orgId, id: { in: responsibleIds } }, select: { id: true, name: true } })
      : [],
    overdueRows.length
      ? prisma.performanceEvent.findMany({
          where: {
            orgId,
            source: "maintenance",
            category: "workorder_overdue",
            // ใบกลุ่มแยกแถวรายคน refId = ใบ:คน
            refId: { in: overdueRows.flatMap((r) => [r.id, ...workOrderMemberIds(r).map((u) => `${r.id}:${u}`)]) },
          },
          select: { refId: true, points: true, refType: true },
        })
      : [],
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  // event คืนคะแนน (work_order_undo) อยู่ใต้ refId เดียวกัน — แยกออก ไม่งั้นทับค่าที่หักจนขึ้น +3
  const dockOf = new Map<string, number>();
  for (const d of docks) {
    if (d.refType !== "work_order" || !d.refId) continue;
    const id = workOrderIdOfDockRef(d.refId);
    dockOf.set(id, (dockOf.get(id) ?? 0) + Number(d.points));
  }
  const waivedIds = new Set(docks.filter((d) => d.refType === "work_order_undo" && d.refId).map((d) => workOrderIdOfDockRef(d.refId!)));

  const toItem = (r: (typeof rows)[number]): ScoreWatchItem => {
    const who = r.assignedTo ?? r.property?.caretakerId ?? null;
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      place: r.property?.name ?? null,
      dueDate: r.dueDate!,
      responsibleName: who ? [who, ...r.groupMemberIds].map((u) => nameOf.get(u)).filter(Boolean).join(", ") || null : null,
      docked: dockOf.get(r.id) ?? null,
      waived: waivedIds.has(r.id),
    };
  };

  return {
    overdue: overdueRows.map(toItem),
    overdueCount,
    dueSoon: soonRows.map(toItem),
    dueSoonCount,
    laterCount,
    noDueCount,
    // ยอดรวมนับ event คืนคะแนน (+) ด้วยอยู่แล้ว · จำนวนครั้ง: ตัดทั้งตัวคืนและครั้งที่ถูกคืนออก
    monthPoints: Number(month._sum.points ?? 0),
    monthDocks: Math.max(0, month._count - 2 * monthUndos),
    orgWide,
  };
}


// ───────────── กดโดนัทดูรายการ (ผู้ใช้ 5/11/2569 "อยากรู้ว่าคืองานไหน") ─────────────

export type ScoreWatchGroup = "late" | "soon" | "later" | "none";

export interface ScoreWatchRow {
  id: string;
  code: string;
  title: string;
  place: string | null;
  /** ชื่อผู้รับผิดชอบหลัก + คนที่เหลือในกลุ่มนับเป็น extra */
  who: string | null;
  extra: number;
  dueText: string | null;
  /** จำนวนวันถึงกำหนดตามวันที่ไทย ติดลบ = เลยมาแล้ว · null = ไม่มีวันส่ง */
  days: number | null;
  waitingAccept: boolean;
  isPm: boolean;
  /** คะแนนสุทธิที่หักใบนี้ (ติดลบ) · null = ยังไม่โดน */
  docked: number | null;
  waived: boolean;
}

export interface ScoreWatchDockRow {
  id: string;
  who: string;
  note: string | null;
  points: number;
  when: Date;
  href: string | null;
}

/** เงื่อนไขเดียวกับตัวเลขบนโดนัท — แก้คู่กับ maintenanceScoreWatch รายการกับตัวเลขจะได้ตรงกัน */
function groupDue(group: ScoreWatchGroup): Prisma.WorkOrderWhereInput {
  const today = bangkokMidnight();
  const soonEnd = bangkokMidnight(SOON_DAYS);
  if (group === "late") return { dueDate: { lt: today } };
  if (group === "soon") return { dueDate: { gte: today, lt: soonEnd } };
  if (group === "later") return { dueDate: { gte: soonEnd } };
  return { dueDate: null };
}

function daysFromToday(due: Date): number {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  return Math.round((Date.parse(day(due)) - Date.parse(day(new Date()))) / 86_400_000);
}

export async function scoreWatchRows(orgId: string, access: WorkOrderAccess, group: ScoreWatchGroup): Promise<ScoreWatchRow[]> {
  const vis = workOrderVisibilityWhere(access);
  const rows = await prisma.workOrder.findMany({
    where: { orgId, status: { in: ["open", "in_progress"] }, isPrivate: false, AND: vis ? [vis] : [], ...groupDue(group) },
    select: {
      id: true, code: true, title: true, dueDate: true, status: true, assignedTo: true, groupMemberIds: true,
      pmScheduleId: true, pmScheduleIds: true, pmRoundDate: true,
      property: { select: { name: true, caretakerId: true } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  const leadIds = [...new Set(rows.map((r) => r.assignedTo ?? r.property?.caretakerId).filter((x): x is string => !!x))];
  const users = leadIds.length ? await prisma.user.findMany({ where: { orgId, id: { in: leadIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  // คะแนนมีเฉพาะใบเลยกำหนด — รวมทั้ง "ใบงานเกินกำหนด" และ "ไม่ทำตามรอบ" ของใบรอบ PM (ใบกลุ่มแยกแถวรายคน)
  const docked = new Map<string, number>();
  const waived = new Set<string>();
  if (group === "late" && rows.length > 0) {
    const events = await prisma.performanceEvent.findMany({
      where: {
        orgId,
        source: "maintenance",
        category: { in: ["workorder_overdue", "pm_missed"] },
        OR: rows.flatMap((r) => [
          { refId: r.id },
          { refId: { startsWith: `${r.id}:` } },
          ...(r.pmRoundDate && r.pmScheduleId ? [{ refId: { startsWith: roundDockRefId(r.pmScheduleId, r.pmRoundDate, r.id) } }] : []),
        ]),
      },
      select: { category: true, refId: true, refType: true, points: true },
    });
    for (const e of events) {
      const woId = e.category === "pm_missed" ? roundDockWorkOrderId(e.refId) : workOrderIdOfDockRef(e.refId!);
      if (!woId) continue;
      if (e.refType?.endsWith("_undo")) waived.add(woId);
      docked.set(woId, (docked.get(woId) ?? 0) + Number(e.points));
    }
  }

  return rows.map((r) => {
    const lead = r.assignedTo ?? r.property?.caretakerId ?? null;
    const net = docked.get(r.id);
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      place: r.property?.name ?? null,
      who: lead ? (nameOf.get(lead) ?? null) : null,
      extra: r.groupMemberIds.filter((u) => u !== lead).length,
      dueText: r.dueDate ? fmtThaiDate(r.dueDate) : null,
      days: r.dueDate ? daysFromToday(r.dueDate) : null,
      waitingAccept: r.status === "open",
      isPm: !!r.pmScheduleId || r.pmScheduleIds.length > 0,
      docked: net ? net : null,
      waived: waived.has(r.id),
    };
  });
}

/** คะแนนที่โดนหักรอบนี้ แยกรายการ — ขอบเขตเดียวกับตัวเลขบนโดนัท (ทั้งบริษัท / ของฉัน) · ที่คืนแล้วไม่นับ */
export async function scoreWatchDocks(orgId: string, access: WorkOrderAccess, orgWide: boolean): Promise<ScoreWatchDockRow[]> {
  const period = await loadScorePeriodConfig(orgId);
  const events = await prisma.performanceEvent.findMany({
    where: {
      orgId,
      source: "maintenance",
      category: { in: ["workorder_overdue", "pm_missed"] },
      occurredAt: { gte: scorePeriodRange(period, scorePeriodOf(period, new Date())).from },
      ...(orgWide ? {} : { userId: access.userId }),
    },
    select: { id: true, userId: true, category: true, refId: true, refType: true, points: true, note: true, occurredAt: true },
    orderBy: { occurredAt: "desc" },
  });
  const undone = new Set(events.filter((e) => e.refType?.endsWith("_undo")).map((e) => `${e.category}|${e.refId}`));
  const docks = events.filter((e) => !e.refType?.endsWith("_undo") && !undone.has(`${e.category}|${e.refId}`));
  const woIdOf = (e: (typeof docks)[number]) => (e.category === "pm_missed" ? roundDockWorkOrderId(e.refId) : e.refId ? workOrderIdOfDockRef(e.refId) : null);
  const woIds = [...new Set(docks.map(woIdOf).filter((x): x is string => !!x))];
  const userIds = [...new Set(docks.map((e) => e.userId))];
  const [wos, users] = await Promise.all([
    woIds.length
      ? prisma.workOrder.findMany({
          where: { orgId, id: { in: woIds } },
          select: { id: true, assignedTo: true, groupMemberIds: true, createdBy: true, ccUserIds: true, propertyId: true, additionalPropertyIds: true, isPrivate: true },
        })
      : [],
    userIds.length ? prisma.user.findMany({ where: { orgId, id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  const woById = new Map(wos.map((w) => [w.id, w]));
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return docks.map((e) => {
    const wo = woIdOf(e);
    const row = wo ? woById.get(wo) : undefined;
    return {
      id: e.id,
      who: nameOf.get(e.userId) ?? "-",
      note: e.note,
      points: Number(e.points),
      when: e.occurredAt,
      // เปิดได้เฉพาะใบที่คนนี้มีสิทธิ์ดู · คะแนนแบบเก่าที่ไม่ผูกใบ ไม่มีลิงก์
      href: row && canSeeWorkOrder(access, row) ? `/maintenance/work-orders/${row.id}` : null,
    };
  });
}
