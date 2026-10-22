"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { wfFetch as wfFetchRaw, WorkforceError } from "@/modules/hr/lib/api";
import { syncUserToWorkforce } from "@/modules/admin/data/user-guards";
import { invalidateAttendanceThrottle } from "@/modules/hr/lib/auto-recalculate";
import { DW_PERMS } from "./permissions";
import { bangkokToday, loadMoney, loadMonth, OT_KEY, OVERRIDE_KEY, updateStoreList } from "./lib/data";
import { insertAudit, logDw, withDailyWorkerTenant } from "./lib/db";
import { baht, hoursLabel, otMinutes, owedOn, type OtEntry, type OverrideEntry } from "./lib/types";

/**
 * Server action ของโมดูลคนงานรายวัน — ตรวจสิทธิ์ Smartboss ทุกตัว (การซ่อนปุ่มไม่ใช่ security control)
 * วันหยุด = ใบ Day-Off ของ workforce (ลงเวลา/รีพอต/หน้า HR รู้จักทันที ไม่ต้องลงสองที่)
 * ฝั่ง workforce ผู้มีสิทธิ์จัดการคนงานได้ HR_OFFICER (mapSmartbossRoles) จึงเขียนใบให้คนอื่นได้
 */

type Result = { ok?: true; done?: number; skipped?: number; error?: string };

/**
 * เรียกระบบบุคคล — ถ้าโดน 403 (สิทธิ์ "จัดการคนงาน" ของคนกดยังไม่ถูกส่งไปฝั่งระบบบุคคล) ส่งสิทธิ์ของคนกดคนเดียว
 * แล้วลองใหม่ครั้งเดียว ไม่ต้องให้แอดมินไปกดบันทึกผู้ใช้หรือรัน wf:sync เอง
 */
function makeWf() {
  // ส่งสิทธิ์ไม่เกินครั้งเดียวต่อการกดหนึ่งครั้ง — คำขอที่ยิงพร้อมกันรอผลเดียวกันแล้วลองใหม่คนละครั้ง
  let syncing: Promise<void> | null = null;
  return async function wfFetch<T>(path: string, options: Parameters<typeof wfFetchRaw>[1] = {}): Promise<T> {
    try {
      return await wfFetchRaw<T>(path, options);
    } catch (error) {
      if (!(error instanceof WorkforceError) || error.status !== 403) throw error;
      syncing ??= requireOrg().then((session) => syncUserToWorkforce(session.userId, session.orgId, session.userId));
      await syncing;
      return wfFetchRaw<T>(path, options);
    }
  };
}

async function guard(permission: string) {
  const session = await requireOrg();
  if (!hasPermission(session, permission)) throw new Error("ไม่มีสิทธิ์ดำเนินการนี้");
  return session;
}

function message(error: unknown): string {
  if (error instanceof WorkforceError) {
    if (error.status === 403) return "ระบบบุคคลยังไม่รู้ว่าคุณมีสิทธิ์นี้ — ให้แอดมินกดบันทึกบทบาทของคุณอีกครั้ง แล้วลองใหม่";
    return error.displayMessage;
  }
  return error instanceof Error ? error.message : "ทำไม่สำเร็จ";
}

async function nameOf(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name ?? "";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** ทำทีละไม่เกิน `size` คำขอพร้อมกัน — คนงานเยอะ ลงทีละหลายสิบช่อง */
async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<boolean>): Promise<number> {
  let ok = 0;
  for (let i = 0; i < items.length; i += size) {
    const results = await Promise.all(items.slice(i, i + size).map((x) => run(x).catch(() => false)));
    ok += results.filter(Boolean).length;
  }
  return ok;
}

/**
 * ลง/ยกเลิกวันหยุดให้คนงานหลายคนหลายวันพร้อมกัน
 * ลงหยุด: ข้ามวันที่ลงเวลามาแล้ว และวันที่มีใบลาอยู่แล้ว · ไม่มีโควตา (ส่งจำนวนวันของเดือนสูงสุด 31)
 * ยกเลิก: ยกเลิกเฉพาะใบ Day-Off (ใบลาประเภทอื่นแก้ที่ระบบบุคคล)
 */
export async function setDaysOffAction(input: { month: string; cells: { employmentId: string; day: number }[]; mode: "off" | "clear" }): Promise<Result> {
  try {
    const wfFetch = makeWf();
    const session = await guard(DW_PERMS.manage);
    if (!/^\d{4}-\d{2}$/.test(input.month) || input.cells.length === 0) return { error: "ยังไม่ได้เลือกช่อง" };
    if (input.cells.length > 600) return { error: "เลือกได้ครั้งละไม่เกิน 600 ช่อง" };
    const data = await loadMonth(session.orgId!, input.month);
    const byEmp = new Map(data.workers.filter((w) => w.employmentId).map((w) => [w.employmentId!, w]));

    if (input.mode === "off") {
      if (!data.dayOffTypeId) return { error: "ยังไม่มีประเภทวันหยุด (Day-Off) ในระบบบุคคล — ให้ HR สร้างประเภทการลาแบบอนุมัติอัตโนมัติก่อน" };
      const todo = input.cells.filter((c) => {
        const cell = byEmp.get(c.employmentId)?.cells[c.day];
        return byEmp.has(c.employmentId) && !cell?.inAt && !cell?.leave;
      });
      const done = await inBatches(todo, 5, async (c) => {
        const date = `${input.month}-${String(c.day).padStart(2, "0")}`;
        const created = await wfFetch<{ id?: string; status?: string }>("/leave-requests", {
          method: "POST",
          body: {
            employment_id: c.employmentId,
            leave_type_id: data.dayOffTypeId,
            starts_on: date,
            ends_on: date,
            total_minutes: 480,
            reason: "ผู้ดูแลลงให้ (คนงานรายวัน)",
            display_label: "หยุด",
            // คนงานไม่มีโควตาวันหยุด — ผู้ดูแลจัดตามงานจริง
            monthly_quota_days_override: 31,
          },
        });
        if (created?.id && created.status === "SUBMITTED") {
          await wfFetch(`/leave-requests/${created.id}/decide`, {
            method: "POST",
            body: { outcome: "APPROVED", reason: "ผู้ดูแลลงให้ (คนงานรายวัน)" },
          });
        }
        return true;
      });
      if (done > 0) {
        await logDw(session.orgId!, {
          byUserId: session.userId,
          byName: await nameOf(session.userId),
          action: "day_off",
          employmentIds: [...new Set(todo.map((c) => c.employmentId))],
          summary: `ลงหยุด ${done} ช่อง`,
          detail: { cells: todo.map((c) => ({ employmentId: c.employmentId, date: `${input.month}-${String(c.day).padStart(2, "0")}` })) },
        });
      }
      revalidatePath("/daily-workers");
      return { ok: true, done, skipped: input.cells.length - done };
    }

    const todo = input.cells
      .map((c) => byEmp.get(c.employmentId)?.cells[c.day]?.leave)
      .filter((l): l is NonNullable<typeof l> => !!l && l.dayOff);
    const ids = [...new Set(todo.map((l) => l.id))];
    const done = await inBatches(ids, 5, async (id) => {
      await wfFetch(`/leave-requests/${id}/cancel-for`, { method: "POST", body: { reason: "ผู้ดูแลยกเลิกวันหยุด (คนงานรายวัน)" } });
      return true;
    });
    if (done > 0) {
      const cleared = input.cells.filter((c) => byEmp.get(c.employmentId)?.cells[c.day]?.leave?.dayOff);
      await logDw(session.orgId!, {
        byUserId: session.userId,
        byName: await nameOf(session.userId),
        action: "day_off_clear",
        employmentIds: [...new Set(cleared.map((c) => c.employmentId))],
        summary: `ยกเลิกวันหยุด ${done} วัน`,
        detail: { cells: cleared.map((c) => ({ employmentId: c.employmentId, date: `${input.month}-${String(c.day).padStart(2, "0")}` })) },
      });
    }
    revalidatePath("/daily-workers");
    return { ok: true, done, skipped: input.cells.length - done };
  } catch (error) {
    return { error: message(error) };
  }
}

/** ลง OT ให้คนงานหลายคนในวันเดียว — ผู้ดูแลใส่เวลาเริ่ม–จบ ระบบคิดชั่วโมงเอง · มีอยู่แล้ว = แทนที่ */
export async function saveOtAction(input: { employmentIds: string[]; date: string; start: string; end: string; note: string }): Promise<Result> {
  try {
    const session = await guard(DW_PERMS.manage);
    if (!DATE_RE.test(input.date) || !TIME_RE.test(input.start) || !TIME_RE.test(input.end)) return { error: "วันที่หรือเวลาไม่ถูกต้อง" };
    if (input.employmentIds.length === 0) return { error: "ยังไม่ได้เลือกคนงาน" };
    const minutes = otMinutes(input.start, input.end);
    if (minutes > 16 * 60) return { error: "OT ยาวเกิน 16 ชั่วโมง ตรวจเวลาอีกครั้ง" };
    const byName = await nameOf(session.userId);
    const at = new Date().toISOString();
    const ids = new Set(input.employmentIds);
    await updateStoreList<OtEntry>(session.orgId!, OT_KEY, session.userId, (list) => [
      ...list.filter((o) => !(o.date === input.date && ids.has(o.employmentId))),
      ...[...ids].map((employmentId) => ({
        id: randomUUID(),
        employmentId,
        date: input.date,
        start: input.start,
        end: input.end,
        minutes,
        note: input.note.trim().slice(0, 200),
        byUserId: session.userId,
        byName,
        at,
      })),
    ]);
    await logDw(session.orgId!, {
      byUserId: session.userId,
      byName,
      action: "ot",
      employmentIds: [...ids],
      workDate: input.date,
      summary: `ลง OT ${input.start}–${input.end} (${hoursLabel(minutes)})${input.note.trim() ? ` · ${input.note.trim().slice(0, 100)}` : ""}`,
    });
    revalidatePath("/daily-workers");
    return { ok: true, done: ids.size };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function deleteOtAction(input: { employmentId: string; date: string }): Promise<Result> {
  try {
    const session = await guard(DW_PERMS.manage);
    await updateStoreList<OtEntry>(session.orgId!, OT_KEY, session.userId, (list) =>
      list.filter((o) => !(o.employmentId === input.employmentId && o.date === input.date)),
    );
    await logDw(session.orgId!, { byUserId: session.userId, byName: await nameOf(session.userId), action: "ot_delete", employmentIds: [input.employmentId], workDate: input.date, summary: "ลบ OT" });
    revalidatePath("/daily-workers");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

/** แก้ "ขาด" เป็น "มา" — ต้องใส่เหตุผล เก็บว่าใครแก้ เมื่อไหร่ */
export async function setOverrideAction(input: { employmentId: string; date: string; reason: string }): Promise<Result> {
  try {
    const session = await guard(DW_PERMS.override);
    const reason = input.reason.trim();
    if (!reason) return { error: "ต้องใส่เหตุผล" };
    if (!DATE_RE.test(input.date)) return { error: "วันที่ไม่ถูกต้อง" };
    const byName = await nameOf(session.userId);
    await updateStoreList<OverrideEntry>(session.orgId!, OVERRIDE_KEY, session.userId, (list) => [
      ...list.filter((o) => !(o.employmentId === input.employmentId && o.date === input.date)),
      { employmentId: input.employmentId, date: input.date, reason: reason.slice(0, 300), byUserId: session.userId, byName, at: new Date().toISOString() },
    ]);
    await logDw(session.orgId!, { byUserId: session.userId, byName, action: "override", employmentIds: [input.employmentId], workDate: input.date, summary: `แก้เป็นมา (แบบเดิม) · ${reason.slice(0, 200)}` });
    revalidatePath("/daily-workers");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function removeOverrideAction(input: { employmentId: string; date: string }): Promise<Result> {
  try {
    const session = await guard(DW_PERMS.override);
    await updateStoreList<OverrideEntry>(session.orgId!, OVERRIDE_KEY, session.userId, (list) =>
      list.filter((o) => !(o.employmentId === input.employmentId && o.date === input.date)),
    );
    await logDw(session.orgId!, { byUserId: session.userId, byName: await nameOf(session.userId), action: "override_remove", employmentIds: [input.employmentId], workDate: input.date, summary: "ยกเลิก \"แก้เป็นมา\" แบบเดิม" });
    revalidatePath("/daily-workers");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/**
 * ผูกกะให้คนงาน (วันหยุดมาจากใบ Day-Off) — ทุกวันกะเดียวกัน หรือแยกรายวัน (`week` จันทร์ → อาทิตย์
 * เช่น อาทิตย์เข้า 09:00) ตารางประจำของระบบบุคคลรองรับรายวันอยู่แล้ว · ใส่หลายคนพร้อมกันได้
 * เริ่มใช้ย้อนหลัง = คำนวณผลลงเวลาของวันที่ผ่านมาใหม่ตามกะใหม่ (สาย/ขาดเปลี่ยนตาม)
 */
export async function assignShiftAction(input: { employmentIds: string[]; week: string[]; from: string }): Promise<Result> {
  try {
    const wfFetch = makeWf();
    const session = await guard(DW_PERMS.manage);
    const ids = [...new Set(input.employmentIds.filter(Boolean))];
    if (ids.length === 0 || input.week.length !== 7 || input.week.some((id) => !id) || !DATE_RE.test(input.from)) return { error: "ข้อมูลไม่ครบ — เลือกกะให้ครบทุกวัน" };
    for (const employmentId of ids) {
      await wfFetch("/recurring-work-patterns", {
        method: "POST",
        body: {
          employment_id: employmentId,
          ...Object.fromEntries(WEEKDAYS.map((d, i) => [`${d}_shift_id`, input.week[i]])),
          effective_from: input.from,
          effective_to: null,
          supersede_current: true,
        },
      });
    }
    // ย้อนหลัง: ผลลงเวลาเดิมยังเทียบกับกะเก่า — คำนวณใหม่ถึงวันนี้ (ไม่สำเร็จก็ไม่ล้ม กะบันทึกแล้ว ระบบคำนวณรอบถัดไปให้เอง)
    const today = bangkokToday();
    let recalcFailed = false;
    if (input.from <= today) {
      invalidateAttendanceThrottle(session.orgId!);
      for (const employmentId of ids) {
        await wfFetch("/attendance-results:recalculate", { method: "POST", body: { employment_id: employmentId, from: input.from, to: today } }).catch(() => {
          recalcFailed = true;
        });
      }
    }
    const perDay = new Set(input.week).size > 1;
    await logDw(session.orgId!, {
      byUserId: session.userId,
      byName: await nameOf(session.userId),
      action: "shift",
      employmentIds: ids,
      workDate: input.from,
      summary: `ผูกกะใหม่${perDay ? " (แยกรายวัน)" : ""}${ids.length > 1 ? ` ${ids.length} คน` : ""} มีผลตั้งแต่ ${input.from}`,
      detail: { week: input.week },
    });
    revalidatePath("/daily-workers");
    return recalcFailed ? { error: "บันทึกกะแล้ว แต่คำนวณวันที่ผ่านมาใหม่ไม่สำเร็จ — ระบบจะคำนวณให้รอบถัดไป" } : { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

/**
 * แก้เวลาเข้า/ออกของคนงานวันหนึ่ง (ไปหน้างานมา สแกนไม่ทัน / ลืมสแกนออก) — ต้องใส่เหตุผล เก็บว่าใครแก้ เมื่อไหร่
 * เวลาที่สแกนจริงยังเก็บไว้ (หน้าจอแสดงคู่กัน) · เว้นช่องไหน = ใช้เวลาที่สแกนจริงของช่องนั้น
 * สิทธิ์เดียวกับ "แก้สถานะ" (ผู้ดูแลบ้าน/HR ตามค่าตั้งต้น) เพราะมีผลกับค่าแรง
 */
export async function setTimeEditAction(input: { employmentId: string; date: string; inAt: string; outAt: string; reason: string }): Promise<Result> {
  try {
    const session = await guard(DW_PERMS.override);
    const reason = input.reason.trim();
    if (!reason) return { error: "ต้องใส่เหตุผล" };
    if (!DATE_RE.test(input.date) || input.date > bangkokToday()) return { error: "วันที่ไม่ถูกต้อง" };
    const inAt = input.inAt.trim() || null;
    const outAt = input.outAt.trim() || null;
    if ((inAt && !TIME_RE.test(inAt)) || (outAt && !TIME_RE.test(outAt))) return { error: "เวลาไม่ถูกต้อง" };
    // ต้องมีเวลาเข้าเสมอ — ใส่แค่เวลาออกในวันที่ไม่ได้สแกนเข้า ระบบจะยังนับ "ไม่มา" (หน้าจอส่งเวลาเข้าเดิมมาด้วยทุกครั้ง)
    if (!inAt) return { error: "ใส่เวลาเข้าด้วย" };
    const byName = await nameOf(session.userId);
    const orgId = session.orgId!;
    const workDate = new Date(`${input.date}T00:00:00Z`);
    // แก้ซ้ำ = ยกเลิกตัวเก่า (เก็บไว้เป็นประวัติ) + เพิ่มแถวใหม่ ใน transaction เดียว
    await withDailyWorkerTenant(orgId, async (tx) => {
      await tx.dailyWorkerTimeEdit.updateMany({
        where: { orgId, employmentId: input.employmentId, workDate, revokedAt: null },
        data: { revokedAt: new Date(), revokedByName: byName },
      });
      await tx.dailyWorkerTimeEdit.create({
        data: { orgId, employmentId: input.employmentId, workDate, inAt, outAt, reason: reason.slice(0, 300), byUserId: session.userId, byName },
      });
      await insertAudit(tx, orgId, {
        byUserId: session.userId,
        byName,
        action: "time_edit",
        employmentIds: [input.employmentId],
        workDate: input.date,
        summary: `แก้เวลา เข้า ${inAt} ออก ${outAt ?? "(ตามสแกน)"} · ${reason.slice(0, 200)}`,
      });
    });
    revalidatePath("/daily-workers");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function removeTimeEditAction(input: { employmentId: string; date: string }): Promise<Result> {
  try {
    const session = await guard(DW_PERMS.override);
    const byName = await nameOf(session.userId);
    const orgId = session.orgId!;
    await withDailyWorkerTenant(orgId, async (tx) => {
      const r = await tx.dailyWorkerTimeEdit.updateMany({
        where: { orgId, employmentId: input.employmentId, workDate: new Date(`${input.date}T00:00:00Z`), revokedAt: null },
        data: { revokedAt: new Date(), revokedByName: byName },
      });
      if (r.count > 0) {
        await insertAudit(tx, orgId, { byUserId: session.userId, byName, action: "time_edit_revoke", employmentIds: [input.employmentId], workDate: input.date, summary: "ยกเลิกการแก้เวลา กลับไปใช้เวลาที่สแกนจริง" });
      }
    });
    revalidatePath("/daily-workers");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

/** % OT กลางของบริษัท (คนงานที่ไม่ได้ตั้ง % เอง) */
export async function saveDwSettingsAction(input: { otPercent: number }): Promise<Result> {
  try {
    const session = await guard(DW_PERMS.pay);
    const p = Number(input.otPercent);
    if (!Number.isFinite(p) || p <= 0 || p > 1000) return { error: "% OT ต้องอยู่ระหว่าง 1–1000" };
    const orgId = session.orgId!;
    const byName = await nameOf(session.userId);
    await withDailyWorkerTenant(orgId, async (tx) => {
      const before = await tx.dailyWorkerSettings.findUnique({ where: { orgId } });
      await tx.dailyWorkerSettings.upsert({
        where: { orgId },
        create: { orgId, otPercent: p, updatedBy: session.userId },
        update: { otPercent: p, updatedBy: session.userId },
      });
      await insertAudit(tx, orgId, {
        byUserId: session.userId,
        byName,
        action: "settings",
        summary: `% OT กลาง ${before ? Number(before.otPercent.toString()) : 150}% → ${p}%`,
      });
    });
    revalidatePath("/daily-workers");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

/**
 * ตั้งค่าแรงรายวัน (+ % OT ของคนนั้น ถ้าต่างจากค่ากลาง) ให้คนงานหลายคนพร้อมกัน — มีผลตั้งแต่วัน `from`
 * วันก่อนหน้ายังคิดเรทเดิม (เก็บเป็นประวัติ ไม่เขียนทับ) · ตั้งซ้ำวันเดิม = แทนที่ของวันนั้น
 */
export async function savePayRateAction(input: { employmentIds: string[]; dailyWage: number; otPercent: number | null; from: string }): Promise<Result> {
  try {
    const session = await guard(DW_PERMS.pay);
    const wage = Number(input.dailyWage);
    if (!Number.isFinite(wage) || wage <= 0 || wage > 100000) return { error: "ค่าแรงต่อวันไม่ถูกต้อง" };
    const ot = input.otPercent === null ? null : Number(input.otPercent);
    if (ot !== null && (!Number.isFinite(ot) || ot <= 0 || ot > 1000)) return { error: "% OT ต้องอยู่ระหว่าง 1–1000" };
    if (!DATE_RE.test(input.from)) return { error: "วันที่เริ่มใช้ไม่ถูกต้อง" };
    if (input.employmentIds.length === 0) return { error: "ยังไม่ได้เลือกคนงาน" };
    const byName = await nameOf(session.userId);
    const orgId = session.orgId!;
    const ids = [...new Set(input.employmentIds)];
    // เพิ่มเป็นประวัติเสมอ ไม่เขียนทับ — วันเดียวกันตั้งซ้ำ ตัวที่ตั้งทีหลังชนะ (rateOn เรียงตามเวลาที่ตั้ง)
    await withDailyWorkerTenant(orgId, async (tx) => {
      await tx.dailyWorkerPayRate.createMany({
        data: ids.map((employmentId) => ({
          orgId,
          employmentId,
          dailyWage: Math.round(wage * 100) / 100,
          otPercent: ot,
          effectiveFrom: new Date(`${input.from}T00:00:00Z`),
          byUserId: session.userId,
          byName,
        })),
      });
      await insertAudit(tx, orgId, {
        byUserId: session.userId,
        byName,
        action: "pay_rate",
        employmentIds: ids,
        workDate: input.from,
        summary: `ตั้งค่าแรง ${baht(Math.round(wage * 100) / 100)} บาท/วัน · OT ${ot === null ? "ใช้ % กลาง" : `${ot}%`} · มีผลตั้งแต่ ${input.from}`,
      });
    });
    revalidatePath("/daily-workers");
    return { ok: true, done: ids.length };
  } catch (error) {
    return { error: message(error) };
  }
}

/**
 * บันทึกการจ่ายเงินให้คนงาน — ผู้ดูแลบ้าน (manage) จ่ายได้ไม่เกินยอดค้าง · จ่ายเกินยอดค้าง = เบิกล่วงหน้า
 * ได้เฉพาะคนที่มีสิทธิ์ตั้งค่าแรง (HR/CEO — ผู้ใช้ตกลง 19/10/2569 "HR เป็นคนทำเรื่องเงิน") และต้องใส่หมายเหตุ
 * เก็บ snapshot ค่าแรงรายวันของเดือนนั้น ณ ตอนจ่าย ไว้บอกทีหลังว่ายอดวันไหนเปลี่ยนหลังจ่าย
 */
export async function recordPaymentAction(input: { employmentId: string; date: string; amount: number; note: string }): Promise<Result> {
  try {
    const session = await requireOrg();
    const canPay = hasPermission(session, DW_PERMS.manage) || hasPermission(session, DW_PERMS.pay);
    if (!canPay) return { error: "ไม่มีสิทธิ์จ่ายเงิน" };
    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return { error: "จำนวนเงินไม่ถูกต้อง" };
    if (!DATE_RE.test(input.date) || input.date > bangkokToday()) return { error: "วันที่ไม่ถูกต้อง" };
    const orgId = session.orgId!;
    const loadedAt = new Date();
    const { money } = await loadMoney(orgId, input.date.slice(0, 7));
    const m = money.get(input.employmentId);
    if (!m) return { error: "ไม่พบคนงาน" };
    const owed = owedOn(m.days, input.date);
    const note = input.note.trim().slice(0, 200);
    const advance = amount > owed + 0.005;
    if (advance) {
      if (!hasPermission(session, DW_PERMS.pay)) {
        return { error: `จ่ายได้ไม่เกินยอดค้าง ${owed.toLocaleString("th-TH")} บาท — จะให้เบิกล่วงหน้าต้องให้ HR เป็นคนบันทึก` };
      }
      if (!note) return { error: "เบิกล่วงหน้าต้องใส่หมายเหตุ" };
    }
    const snapshot: Record<string, number> = {};
    for (const d of m.days) if (d.date <= input.date && d.earned) snapshot[d.date] = d.earned;
    const byName = await nameOf(session.userId);
    // กันสองคนกดจ่ายคนเดียวกันพร้อมกัน (ยอดค้างที่ตรวจไว้จะไม่จริงแล้ว) — ล็อกต่อคนงาน แล้วดูว่ามีใครจ่ายแทรกหลังโหลดยอดไหม
    const raced = await withDailyWorkerTenant(orgId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dw-pay:${orgId}:${input.employmentId}`}))`;
      const after = await tx.dailyWorkerPayment.count({
        where: { orgId, employmentId: input.employmentId, createdAt: { gte: loadedAt }, voidedAt: null },
      });
      if (after > 0) return true;
      await tx.dailyWorkerPayment.create({
        data: {
          orgId,
          employmentId: input.employmentId,
          payDate: new Date(`${input.date}T00:00:00Z`),
          amount,
          kind: advance ? "advance" : "wage",
          note,
          byUserId: session.userId,
          byName,
          snapshot,
        },
      });
      await insertAudit(tx, orgId, {
        byUserId: session.userId,
        byName,
        action: "payment",
        employmentIds: [input.employmentId],
        workDate: input.date,
        summary: `${advance ? "เบิกล่วงหน้า" : "จ่ายค่าแรง"} ${baht(amount)} บาท (ค้างอยู่ ${baht(owed)})${note ? ` · ${note}` : ""}`,
      });
      return false;
    });
    if (raced) return { error: "มีคนเพิ่งบันทึกจ่ายให้คนนี้ไป — รีเฟรชดูยอดล่าสุดก่อน" };
    revalidatePath("/daily-workers");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

/** ยกเลิกรายการจ่าย (กดผิด) — คนบันทึกเองภายในวันนั้น หรือคนที่มีสิทธิ์ตั้งค่าแรง (HR) · ต้องใส่เหตุผล ไม่ลบทิ้ง */
export async function voidPaymentAction(input: { id: string; reason: string }): Promise<Result> {
  try {
    const session = await requireOrg();
    const reason = input.reason.trim();
    if (!reason) return { error: "ต้องใส่เหตุผล" };
    const isHr = hasPermission(session, DW_PERMS.pay);
    const byName = await nameOf(session.userId);
    const orgId = session.orgId!;
    const result = await withDailyWorkerTenant(orgId, async (tx) => {
      const p = await tx.dailyWorkerPayment.findFirst({ where: { orgId, id: input.id, voidedAt: null } });
      if (!p) return "missing" as const;
      const own = p.byUserId === session.userId && p.payDate.toISOString().slice(0, 10) === bangkokToday();
      if (!isHr && !own) return "denied" as const;
      await tx.dailyWorkerPayment.update({ where: { id: p.id }, data: { voidedAt: new Date(), voidedByName: byName, voidReason: reason.slice(0, 200) } });
      await insertAudit(tx, orgId, {
        byUserId: session.userId,
        byName,
        action: "payment_void",
        employmentIds: [p.employmentId],
        workDate: p.payDate.toISOString().slice(0, 10),
        summary: `ยกเลิกรายการ${p.kind === "advance" ? "เบิก" : "จ่าย"} ${baht(Number(p.amount.toString()))} บาท (บันทึกโดย ${p.byName}) · ${reason.slice(0, 200)}`,
      });
      return "ok" as const;
    });
    if (result === "missing") return { error: "ไม่พบรายการ หรือถูกยกเลิกไปแล้ว" };
    if (result === "denied") return { error: "ยกเลิกได้เฉพาะรายการที่ตัวเองบันทึกวันนี้ — อื่น ๆ ให้ HR ยกเลิก" };
    revalidatePath("/daily-workers");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}
