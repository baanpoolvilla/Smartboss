import "server-only";
import { wfFetch } from "@/modules/hr/lib/api";
import { insertEvent, withSalaryTenant } from "./db";
import { fmtBaht, thaiDate } from "./types";

/**
 * ตั้ง/แก้ฐานค่าจ้าง + เก็บประวัติว่าใครแก้อะไร (ผู้ใช้ 26/11/2569 "แก้เงินเดือนไม่ได้หรอ ต้องแก้ได้สิ และเก็บ log ไว้ด้วย")
 *
 * ระบบบุคคลเก็บเงินเดือนเป็นช่วงวันที่ — ขึ้นเงินเดือน = เปิดช่วงใหม่ (ปิดช่วงเดิมให้) ประวัติเดิมอยู่ครบ
 * เดิมลงวันที่มีผล "วันเดียวกับช่วงล่าสุด" ไม่ได้ (ระบบบุคคลตอบ "cannot supersede…") ⇒ ลงยอดผิดแล้วแก้ไม่ได้เลย
 * ตอนนี้: วันที่มีผลตรงกับช่วงล่าสุด = แก้ยอดของช่วงนั้น (PATCH พร้อมเหตุผล) · วันหลังจากนั้น = ช่วงใหม่เหมือนเดิม
 * ช่วงที่งวดจ่ายแล้วใช้คิดไปแล้ว แก้ย้อนไม่ได้ — ต้องตั้งช่วงใหม่หลังงวดนั้น (ยอดที่จ่ายไปแล้วต้องไม่เปลี่ยน)
 *
 * ประวัติเก็บที่ salary.events (action "employee") พร้อม detail.employmentId ให้ดึงรายคนได้ (rateLog)
 */

type PayBasis = "MONTHLY" | "DAILY" | "HOURLY";

interface RateRow {
  id: string;
  pay_basis: PayBasis;
  amount: string;
  effective_from: string;
  effective_to: string | null;
  version: number;
}

const BASIS_LABEL: Record<PayBasis, string> = { MONTHLY: "รายเดือน", DAILY: "รายวัน", HOURLY: "รายชั่วโมง" };

export class RateSaveError extends Error {}

export async function saveCompensationRate(input: {
  orgId: string;
  actor: { userId: string; name: string };
  employmentId: string;
  payBasis: PayBasis;
  amount: number;
  effectiveFrom: string;
  reason: string;
  note?: string;
}): Promise<{ mode: "new" | "edited"; before: number | null }> {
  const list = await wfFetch<{ items: RateRow[] }>(
    `/compensation-rates?employment_id=${encodeURIComponent(input.employmentId)}&limit=200`,
  );
  const open = list.items.find((r) => r.effective_to === null) ?? null;
  const reason = input.reason.trim();

  if (open && open.effective_from > input.effectiveFrom) {
    throw new RateSaveError(
      `มีเงินเดือนที่มีผลตั้งแต่ ${thaiDate(open.effective_from)} อยู่แล้ว — เลือกวันที่มีผลตั้งแต่วันนั้นเป็นต้นไป (วันเดียวกัน = แก้ยอดของช่วงนั้น)`,
    );
  }

  if (open && open.effective_from === input.effectiveFrom) {
    // แก้ยอดของช่วงเดิม — งวดที่จ่ายแล้วซึ่งใช้ช่วงนี้คิดไปแล้ว ห้ามแก้ย้อน
    const paid = await withSalaryTenant(input.orgId, (tx) =>
      tx.salaryRun.findFirst({
        where: { orgId: input.orgId, status: "paid", endsOn: { gte: new Date(`${open.effective_from}T00:00:00.000Z`) } },
        select: { period: true },
      }),
    );
    if (paid) {
      throw new RateSaveError(
        `งวด ${paid.period} จ่ายไปแล้วด้วยยอดเดิม — แก้ย้อนไม่ได้ ให้ตั้งเงินเดือนใหม่โดยเลือกวันที่มีผลหลังงวดนั้น`,
      );
    }
    const before = Number(open.amount);
    if (before === input.amount && open.pay_basis === input.payBasis) {
      throw new RateSaveError("ยอดเท่าเดิม ไม่มีอะไรเปลี่ยน");
    }
    await wfFetch(`/compensation-rates/${open.id}`, {
      method: "PATCH",
      body: {
        amount: input.amount.toFixed(2),
        pay_basis: input.payBasis,
        reason: reason || "แก้ยอดที่ลงไว้",
        expected_version: open.version,
      },
    });
    await withSalaryTenant(input.orgId, (tx) =>
      insertEvent(tx, input.orgId, {
        byUserId: input.actor.userId,
        byName: input.actor.name,
        action: "employee",
        summary: `แก้เงินเดือน ${fmtBaht(before)} → ${fmtBaht(input.amount)} (ช่วงมีผล ${thaiDate(open.effective_from)})${reason ? ` · ${reason}` : ""}`,
        detail: {
          kind: "rate_edit",
          employmentId: input.employmentId,
          rateId: open.id,
          effectiveFrom: open.effective_from,
          before: { amount: before, payBasis: open.pay_basis },
          after: { amount: input.amount, payBasis: input.payBasis },
          reason,
        },
      }),
    );
    return { mode: "edited", before };
  }

  await wfFetch("/compensation-rates", {
    method: "POST",
    body: {
      employment_id: input.employmentId,
      pay_basis: input.payBasis,
      amount: input.amount.toFixed(2),
      currency: "THB",
      effective_from: input.effectiveFrom,
      note: (input.note ?? reason).trim(),
      supersede_current: true,
    },
  });
  const before = open ? Number(open.amount) : null;
  await withSalaryTenant(input.orgId, (tx) =>
    insertEvent(tx, input.orgId, {
      byUserId: input.actor.userId,
      byName: input.actor.name,
      action: "employee",
      summary: `${before === null ? "ตั้งเงินเดือน" : "ขึ้น/ปรับเงินเดือน"} ${before === null ? "" : `${fmtBaht(before)} → `}${fmtBaht(input.amount)} มีผล ${thaiDate(input.effectiveFrom)}${reason ? ` · ${reason}` : ""}`,
      detail: {
        kind: "rate_set",
        employmentId: input.employmentId,
        effectiveFrom: input.effectiveFrom,
        before: before === null ? null : { amount: before, payBasis: open!.pay_basis },
        after: { amount: input.amount, payBasis: input.payBasis },
        reason,
      },
    }),
  );
  return { mode: "new", before };
}

export interface RateLogRow {
  at: string;
  byName: string;
  summary: string;
}

/** ประวัติการตั้ง/แก้เงินเดือนของคนหนึ่ง (ใหม่สุดก่อน) — เฉพาะที่บันทึกด้วย saveCompensationRate */
export async function rateLog(orgId: string, employmentId: string, take = 30): Promise<RateLogRow[]> {
  const rows = await withSalaryTenant(orgId, (tx) =>
    tx.salaryEvent.findMany({
      where: { orgId, action: "employee", detail: { path: ["employmentId"], equals: employmentId } },
      orderBy: { at: "desc" },
      take,
      select: { at: true, byName: true, summary: true },
    }),
  );
  return rows.map((r) => ({ at: r.at.toISOString(), byName: r.byName, summary: r.summary }));
}

export { BASIS_LABEL };
