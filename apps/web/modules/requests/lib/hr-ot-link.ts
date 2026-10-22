import "server-only";
import { hasPermission, type OrgSession } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { nextRequestCode } from "@/lib/document-code";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { REQ_PERMS } from "../permissions";
import { monthlySalaryOn } from "./data";
import { dateOnly, insertEvent, readSettings, withRequestsTenant, withRequestsTenantAfter } from "./db";
import { notifyApprovers, notifyPayers } from "./notify";
import { baht, hoursText, otCalc, round2, routeFor, timesOverlap, type OtRate } from "./types";

/*
 * HR อนุมัติ OT ที่ระบบจับจากเวลาสแกน (แท็บ "OT รออนุมัติ") → สร้างใบ OT ในเบิกจ่าย & OT ให้เอง
 * (ผู้ใช้ 22/10/2569 — "พอได้อนุมัติให้สร้างใบ OT คนนั้นอัตโนมัติ") แอดมินไม่ต้องพิมพ์ซ้ำ
 *
 * - ถือว่าการอนุมัติในแท็บ HR = ขั้น HR ของใบนี้แล้ว · เส้นทางที่บริษัทตั้งให้ต่อ CEO (ยอดเกินเกณฑ์ /
 *   CEO ทุกใบ) ยังต้องรอ CEO เหมือนใบที่แอดมินลง
 * - ผูก overtime_requests.id ไว้ (hrOvertimeRequestId) — อนุมัติซ้ำ/กดซ้ำไม่สร้างใบที่สอง
 * - เวลาที่ลงในใบมาจากผลสแกน: วันทำงาน = เลิกกะ → +นาทีที่อนุมัติ · วันหยุด = เวลาเข้า → +นาทีที่อนุมัติ
 *   วันหยุดเกิน 8 ชม. แยกส่วนเกินเป็นอีกใบด้วยอัตรา "นอกเวลา ในวันหยุด"
 * - คนงานรายวันไม่สร้าง — OT คนงานผู้คุมลงในโมดูลคนงานรายวัน (ค่าแรงคิดที่บัญชีคนงาน)
 * - ใบ OT ที่ลงไว้แล้วเวลาทับกัน (คนเดียวกัน วันเดียวกัน) = ไม่สร้าง กันจ่ายซ้ำ
 */

export interface HrOtApproval {
  overtimeRequestId: string;
  employmentId: string;
  workDate: string;
  /** WORKDAY | REST_DAY | PUBLIC_HOLIDAY */
  category: string;
  approvedMinutes: number;
}

export type HrOtLinkResult = { created: string[] } | { skipped: string };

const HOLIDAY_NORMAL_MINUTES = 8 * 60;

function addMinutes(hm: string, minutes: number): string {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** ผู้ใช้ Smartboss ของทะเบียนพนักงานนี้ (principal.subject) + เวลาสแกนวันนั้น */
async function scanOf(orgId: string, employmentId: string, workDate: string) {
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRawUnsafe<{ subject: string | null; in_hm: string | null; out_hm: string | null; sched_out_hm: string | null }[]>(
      `SELECT (SELECT p.subject FROM workforce.employments e JOIN workforce.principals p ON p.person_id = e.person_id
                WHERE e.id = $1::uuid LIMIT 1) AS subject,
              to_char(ar.actual_in_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS in_hm,
              to_char(ar.actual_out_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS out_hm,
              to_char(ar.scheduled_out_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS sched_out_hm
         FROM (SELECT 1) one
         LEFT JOIN workforce.attendance_results ar
           ON ar.employment_id = $1::uuid AND ar.work_date = $2::date AND ar.is_current`,
      employmentId,
      workDate,
    ),
  );
  return rows[0] ?? null;
}

export async function createOtFromHrApproval(session: OrgSession, input: HrOtApproval): Promise<HrOtLinkResult> {
  const orgId = session.orgId;
  const minutes = Math.round(input.approvedMinutes);
  if (!(minutes > 0)) return { skipped: "ไม่มีนาทีที่อนุมัติ" };

  const already = await withRequestsTenant(orgId, (tx) =>
    tx.moneyRequest.findFirst({ where: { orgId, hrOvertimeRequestId: input.overtimeRequestId }, select: { code: true } }),
  );
  if (already) return { skipped: `มีใบ ${already.code} แล้ว` };

  const scan = await scanOf(orgId, input.employmentId, input.workDate);
  if (!scan?.subject) return { skipped: "ไม่พบบัญชีผู้ใช้ของพนักงานคนนี้" };
  const user = await prisma.user.findFirst({
    where: { orgId, id: scan.subject },
    select: { id: true, name: true, roles: { select: { role: { select: { code: true } } } } },
  });
  if (!user) return { skipped: "ไม่พบบัญชีผู้ใช้ของพนักงานคนนี้" };
  if (user.roles.some((r) => r.role.code === "WORKER")) return { skipped: "คนงานรายวัน — OT ลงที่โมดูลคนงานรายวัน" };

  // ช่วงเวลา OT ตามผลสแกน
  const holiday = input.category !== "WORKDAY";
  const start = holiday
    ? (scan.in_hm ?? "08:00")
    : (scan.sched_out_hm ?? (scan.out_hm ? addMinutes(scan.out_hm, -minutes) : "17:00"));
  const settings = await withRequestsTenant(orgId, (tx) => readSettings(tx, orgId));
  const rateOf = (id: string): OtRate => settings.otRates.find((r) => r.id === id) ?? settings.otRates[0]!;
  const parts: { start: string; end: string; minutes: number; rate: OtRate }[] = [];
  if (!holiday) parts.push({ start, end: addMinutes(start, minutes), minutes, rate: rateOf("normal") });
  else {
    const normal = Math.min(minutes, HOLIDAY_NORMAL_MINUTES);
    parts.push({ start, end: addMinutes(start, normal), minutes: normal, rate: rateOf("holiday") });
    if (minutes > normal) {
      const s2 = addMinutes(start, normal);
      parts.push({ start: s2, end: addMinutes(s2, minutes - normal), minutes: minutes - normal, rate: rateOf("holiday_ot") });
    }
  }

  // ใบที่ลงไว้แล้วของคนเดียวกันวันเดียวกัน เวลาทับ = ไม่สร้าง
  const sameDay = await withRequestsTenant(orgId, (tx) =>
    tx.moneyRequest.findMany({
      where: { orgId, kind: "ot", beneficiaryUserId: user.id, workDate: dateOnly(input.workDate), status: { in: ["pending", "approved", "paid"] } },
      select: { code: true, otStart: true, otEnd: true },
    }),
  );
  const clash = sameDay.find((o) => o.otStart && o.otEnd && parts.some((p) => timesOverlap(p.start, p.end, o.otStart!, o.otEnd!)));
  if (clash) return { skipped: `มีใบ ${clash.code} (${clash.otStart}–${clash.otEnd}) ลงไว้แล้ว` };

  const salary = await monthlySalaryOn(orgId, input.employmentId, input.workDate);
  const actor = await prisma.user.findFirst({ where: { id: session.userId }, select: { name: true } });
  const actorName = actor?.name ?? "HR";
  const actorIsCeo = hasPermission(session, REQ_PERMS.approveCeo);
  const categoryText = input.category === "PUBLIC_HOLIDAY" ? "วันนักขัตฤกษ์" : input.category === "REST_DAY" ? "วันหยุด" : "หลังเลิกกะ";

  const created: string[] = [];
  for (const part of parts) {
    const calc = salary ? otCalc("monthly", salary, part.rate.percent, part.minutes) : null;
    const amount = calc?.amount ?? 0;
    const route = routeFor(settings.approvalRoutes.ot, amount);
    // ไม่มีเงินเดือนในระบบ = คิดเงินไม่ได้ → รอ HR กรอกยอด (แก้ใบได้เพราะยังไม่มีใครตัดสิน)
    const done = salary !== null && (actorIsCeo || (route.level === "hr" && !route.needCeo));
    const toCeo = salary !== null && !done;
    const now = new Date();
    const row = await withRequestsTenantAfter(
      orgId,
      (tx) => nextRequestCode(tx, orgId),
      async (tx, code) => {
        const r = await tx.moneyRequest.create({
          data: {
            orgId,
            code,
            kind: "ot",
            status: done ? "approved" : "pending",
            title: `OT ${categoryText} (จากเวลาสแกน)`,
            detail: `HR อนุมัติในแท็บ "OT รออนุมัติ" · ${part.rate.label}${calc ? ` · ${calc.formula}` : ""}`,
            beneficiaryUserId: user.id,
            beneficiaryName: user.name,
            beneficiaryKind: "staff",
            employmentId: input.employmentId,
            workDate: dateOnly(input.workDate),
            otStart: part.start,
            otEnd: part.end,
            otMinutes: part.minutes,
            otPercent: part.rate.percent,
            otRateLabel: part.rate.label,
            otBase: salary,
            otBaseKind: salary ? "monthly" : "manual",
            amount,
            netAmount: amount,
            attachments: [],
            createdBy: session.userId,
            createdByName: actorName,
            approverLevel: toCeo ? "ceo" : "hr",
            needCeo: toCeo && route.needCeo,
            ...(toCeo ? { firstDecidedBy: session.userId, firstDecidedByName: actorName, firstDecidedAt: now, firstDecisionNote: "อนุมัติชั่วโมงในแท็บ OT ของ HR" } : {}),
            ...(done ? { decidedBy: session.userId, decidedByName: actorName, decidedAt: now, decisionNote: "อนุมัติในแท็บ OT ของ HR" } : {}),
            hrOvertimeRequestId: input.overtimeRequestId,
          },
        });
        await insertEvent(tx, orgId, {
          requestId: r.id,
          byUserId: session.userId,
          byName: actorName,
          action: "create",
          summary: `สร้างอัตโนมัติจาก OT ที่ HR อนุมัติ · ${user.name} ${part.start}–${part.end} (${hoursText(part.minutes)}) ${salary ? baht(round2(amount)) : "ยังไม่มีเงินเดือนในระบบ — กรอกค่า OT"}${done ? " · อนุมัติแล้ว" : toCeo ? " · รอ CEO" : ""}`,
        });
        return { id: r.id, code: r.code };
      },
    );
    created.push(row.code);
    const brief = { id: row.id, code: row.code, kind: "ot" as const, title: `OT ${categoryText}`, netAmount: amount, beneficiaryName: user.name };
    if (toCeo) void notifyApprovers(orgId, brief, "ceo", [session.userId, user.id]);
    else if (done) void notifyPayers(orgId, brief, [session.userId, user.id]);
  }
  return { created };
}
