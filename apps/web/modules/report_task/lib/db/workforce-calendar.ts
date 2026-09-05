import "server-only";
import { prisma } from "@smartboss/database";

import type { CalendarEvent } from "../../types";

/**
 * ปฏิทินการลาและวันหยุด — อ่านจาก workforce ซึ่งเป็นเจ้าของข้อมูลจริง
 *
 * ทำไม: เดิมโมดูลนี้เก็บการลาของตัวเองใน store `leaves` ทำให้มีข้อมูลการลาสองชุด
 * และ **เงินเดือนคำนวณจากชุดของ workforce เท่านั้น** ⇒ ถ้าใครกรอกลาผิดที่
 * ปฏิทินกับสลิปเงินเดือนจะไม่ตรงกัน โดยไม่มีอะไรเตือน
 *
 * ตอนนี้ปฏิทินอ่านจากแหล่งเดียวกับที่ใช้คิดเงิน — การยื่นลายังทำที่โมดูลบุคคล
 * (/hr) เพราะที่นั่นมีสายอนุมัติและสมุดสิทธิ์การลาที่นี่ไม่มี
 *
 * ── การเข้าถึงข้อมูล ──
 * tenant ของ workforce ใช้ id เดียวกับ core.organizations (ดู wf:sync)
 * จึงตั้ง tenant context ได้ตรง ๆ แล้วให้ RLS ทำงานตามปกติ — ไม่ใช้ทางลัด
 * ข้าม RLS เพราะที่นี่รู้ว่าเป็นบริษัทไหน (ต่างจาก cron ที่ต้องวิ่งข้ามบริษัท)
 */

interface LeaveRow {
  id: string;
  user_id: string | null;
  starts_on: Date;
  ends_on: Date;
  status: string;
  leave_type_name: string | null;
  half_day_start: boolean | null;
  half_day_end: boolean | null;
}

interface HolidayRow {
  id: string;
  holiday_date: Date;
  name: string;
}

/** client ภายใน transaction ของ Prisma — ตัดเมธอดที่เรียกในนั้นไม่ได้ออก */
type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** อ่านโดยตั้ง tenant context ให้ RLS บังคับตามปกติ */
async function withWorkforceTenant<T>(
  orgId: string,
  run: (tx: PrismaTx) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // SET LOCAL ผูกกับ transaction จึงหมดผลเองเมื่อจบ ไม่รั่วไปคำขออื่น
    await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
    await tx.$executeRaw`SELECT set_config('workforce.tenant_id', ${orgId}, true)`;
    return run(tx);
  });
}

const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);

/**
 * วันถัดจากวันสุดท้าย — `CalendarEvent.end` ของโมดูลนี้เป็นแบบ **ไม่รวมวันนั้น**
 * (เหมือน FullCalendar) ทุกที่: วันหยุดในตัวของไทย (data/thai-holidays.ts),
 * ตัวนับวันลา (leave-summary-panel) และตัวยกเว้นการส่งรายงาน
 * (report-feed-exemptions) คิดแบบนั้นหมด
 *
 * ของ workforce เก็บเป็นวันสุดท้ายจริง ๆ (รวมวันนั้น) — เดิมส่งต่อมาดื้อ ๆ
 * ผลคือใบลาวันเดียว (ซึ่งตอนนี้คือทุกใบ เพราะ submitLeaveAction ยิงทีละวัน)
 * ได้ start = end ⇒ ช่วง [start, end) ว่างเปล่า ⇒ **คนที่ลายังถูกนับว่าไม่ส่ง
 * รายงานในวันที่ลา** และวันหยุดบริษัทก็ไม่ยกเว้นให้ใคร ส่วนใบที่กินหลายวัน
 * ก็หายไปวันสุดท้ายบนปฏิทิน
 */
function endExclusive(d: Date): string {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + 1);
  return iso(next);
}

/**
 * การลาที่อนุมัติแล้วในช่วงวันที่กำหนด
 *
 * เอาเฉพาะที่อนุมัติแล้ว — คำขอที่ยังรออนุมัติไม่ควรขึ้นปฏิทินทีมเหมือนเป็นเรื่องแน่นอน
 */
export async function listLeaveEvents(
  orgId: string,
  from: string,
  to: string
): Promise<CalendarEvent[]> {
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRaw<LeaveRow[]>`
      SELECT lr.id,
             p.subject        AS user_id,
             lr.starts_on,
             lr.ends_on,
             lr.status,
             lt.name          AS leave_type_name,
             lr.half_day_start,
             lr.half_day_end
      FROM workforce.leave_requests lr
      LEFT JOIN workforce.employments e ON e.id = lr.employment_id
      LEFT JOIN workforce.principals  p ON p.person_id = e.person_id
      LEFT JOIN workforce.leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.status = 'APPROVED'
        AND lr.starts_on <= ${to}::date
        AND lr.ends_on   >= ${from}::date
      ORDER BY lr.starts_on
      LIMIT 1000
    `
  );

  return rows.map((r) => {
    const half = r.half_day_start || r.half_day_end;
    return {
      id: `wf-leave-${r.id}`,
      title: r.leave_type_name ?? "ลา",
      type: "leave",
      // The HR module owns the actual set of leave types (admins add/rename
      // them in /hr/settings) — using its name as-is here, instead of
      // guessing at a fixed local list, is what lets the calendar's
      // "ประเภทลา" filter and per-type coloring track whatever HR actually
      // has without this module having to mirror HR's config by hand.
      leaveType: r.leave_type_name ?? undefined,
      start: iso(r.starts_on),
      end: endExclusive(r.ends_on),
      allDay: !half,
      ...(r.user_id ? { userId: r.user_id } : {}),
      description: half ? "ลาครึ่งวัน" : undefined,
    } satisfies CalendarEvent;
  });
}

/** วันหยุดของบริษัทตามปฏิทินวันหยุดที่ตั้งไว้ในโมดูลบุคคล */
export async function listHolidayEvents(
  orgId: string,
  from: string,
  to: string
): Promise<CalendarEvent[]> {
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRaw<HolidayRow[]>`
      SELECT hd.id, hd.holiday_date, hd.name
      FROM workforce.holiday_dates hd
      WHERE hd.holiday_date BETWEEN ${from}::date AND ${to}::date
      ORDER BY hd.holiday_date
      LIMIT 1000
    `
  );

  return rows.map((r) => ({
    id: `wf-holiday-${r.id}`,
    title: r.name,
    type: "holiday",
    start: iso(r.holiday_date),
    end: endExclusive(r.holiday_date),
    allDay: true,
  }));
}
