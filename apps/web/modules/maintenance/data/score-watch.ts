import "server-only";
import { prisma } from "@smartboss/database";

import {
  workOrderVisibilityWhere,
  type WorkOrderAccess,
} from "@/modules/maintenance/data/work-order-access";

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
}

export interface ScoreWatch {
  overdue: ScoreWatchItem[];
  overdueCount: number;
  dueSoon: ScoreWatchItem[];
  dueSoonCount: number;
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

function bangkokMonthStart(): Date {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  return new Date(`${day.slice(0, 7)}-01T00:00:00+07:00`);
}

export async function maintenanceScoreWatch(
  orgId: string,
  access: WorkOrderAccess,
  orgWide: boolean,
): Promise<ScoreWatch> {
  const vis = workOrderVisibilityWhere(access);
  const today = bangkokMidnight();
  const soonEnd = bangkokMidnight(SOON_DAYS);
  const openVisible = { orgId, status: { in: ["open", "in_progress"] }, AND: vis ? [vis] : [] };
  const select = {
    id: true,
    code: true,
    title: true,
    dueDate: true,
    assignedTo: true,
    property: { select: { name: true, caretakerId: true } },
  } as const;

  const [overdueRows, overdueCount, soonRows, dueSoonCount, month] = await Promise.all([
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
        occurredAt: { gte: bangkokMonthStart() },
        ...(orgWide ? {} : { userId: access.userId }),
      },
      _sum: { points: true },
      _count: true,
    }),
  ]);

  const rows = [...overdueRows, ...soonRows];
  const responsibleIds = [
    ...new Set(rows.map((r) => r.assignedTo ?? r.property?.caretakerId).filter((x): x is string => !!x)),
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
            refId: { in: overdueRows.map((r) => r.id) },
          },
          select: { refId: true, points: true },
        })
      : [],
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const dockOf = new Map(docks.map((d) => [d.refId, Number(d.points)]));

  const toItem = (r: (typeof rows)[number]): ScoreWatchItem => {
    const who = r.assignedTo ?? r.property?.caretakerId ?? null;
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      place: r.property?.name ?? null,
      dueDate: r.dueDate!,
      responsibleName: who ? (nameOf.get(who) ?? null) : null,
      docked: dockOf.get(r.id) ?? null,
    };
  };

  return {
    overdue: overdueRows.map(toItem),
    overdueCount,
    dueSoon: soonRows.map(toItem),
    dueSoonCount,
    monthPoints: Number(month._sum.points ?? 0),
    monthDocks: month._count,
    orgWide,
  };
}
