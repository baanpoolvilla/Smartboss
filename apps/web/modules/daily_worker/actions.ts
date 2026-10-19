"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { wfFetch as wfFetchRaw, WorkforceError } from "@/modules/hr/lib/api";
import { syncUserToWorkforce } from "@/modules/admin/data/user-guards";
import { DW_PERMS } from "./permissions";
import { bangkokToday, loadMonth, OT_KEY, OVERRIDE_KEY, PAY_KEY, SETTINGS_KEY, TIME_EDIT_KEY, updateStoreList } from "./lib/data";
import { writeStore, readStore } from "@/modules/report_task/lib/db/org-store";
import { otMinutes, type DwSettings, type OtEntry, type OverrideEntry, type PayRateEntry, type TimeEditEntry } from "./lib/types";

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
    revalidatePath("/daily-workers");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** ผูกกะให้คนงาน — ทุกวันกะเดียวกัน (วันหยุดมาจากใบ Day-Off) แบบเดียวกับ setRecurringPatternAction ของ HR */
export async function assignShiftAction(input: { employmentId: string; shiftId: string; from: string }): Promise<Result> {
  try {
    const wfFetch = makeWf();
    await guard(DW_PERMS.manage);
    if (!input.employmentId || !input.shiftId || !DATE_RE.test(input.from)) return { error: "ข้อมูลไม่ครบ" };
    await wfFetch("/recurring-work-patterns", {
      method: "POST",
      body: {
        employment_id: input.employmentId,
        ...Object.fromEntries(WEEKDAYS.map((d) => [`${d}_shift_id`, input.shiftId])),
        effective_from: input.from,
        effective_to: null,
        supersede_current: true,
      },
    });
    revalidatePath("/daily-workers");
    return { ok: true };
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
    if (!inAt && !outAt) return { error: "ใส่เวลาเข้าหรือออกอย่างน้อยหนึ่งช่อง" };
    const byName = await nameOf(session.userId);
    await updateStoreList<TimeEditEntry>(session.orgId!, TIME_EDIT_KEY, session.userId, (list) => [
      ...list.filter((e) => !(e.employmentId === input.employmentId && e.date === input.date)),
      { employmentId: input.employmentId, date: input.date, inAt, outAt, reason: reason.slice(0, 300), byUserId: session.userId, byName, at: new Date().toISOString() },
    ]);
    revalidatePath("/daily-workers");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function removeTimeEditAction(input: { employmentId: string; date: string }): Promise<Result> {
  try {
    const session = await guard(DW_PERMS.override);
    await updateStoreList<TimeEditEntry>(session.orgId!, TIME_EDIT_KEY, session.userId, (list) =>
      list.filter((e) => !(e.employmentId === input.employmentId && e.date === input.date)),
    );
    revalidatePath("/daily-workers");
    return { ok: true };
  } catch (error) {
    return { error: message(error) };
  }
}

/** % OT กลางของบริษัท (คนงานที่ไม่ได้ตั้ง % เอง) */
export async function saveDwSettingsAction(input: { otPercent: number }): Promise<Result> {
  try {
    const session = await guard(DW_PERMS.manage);
    const p = Number(input.otPercent);
    if (!Number.isFinite(p) || p <= 0 || p > 1000) return { error: "% OT ต้องอยู่ระหว่าง 1–1000" };
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, version } = await readStore<DwSettings>(session.orgId!, SETTINGS_KEY);
      const r = await writeStore(session.orgId!, SETTINGS_KEY, { ...(data ?? {}), otPercent: p }, data === null ? null : version, session.userId);
      if (r.ok) {
        revalidatePath("/daily-workers");
        return { ok: true };
      }
    }
    return { error: "บันทึกไม่สำเร็จ มีคนแก้พร้อมกัน ลองใหม่อีกครั้ง" };
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
    const session = await guard(DW_PERMS.manage);
    const wage = Number(input.dailyWage);
    if (!Number.isFinite(wage) || wage <= 0 || wage > 100000) return { error: "ค่าแรงต่อวันไม่ถูกต้อง" };
    const ot = input.otPercent === null ? null : Number(input.otPercent);
    if (ot !== null && (!Number.isFinite(ot) || ot <= 0 || ot > 1000)) return { error: "% OT ต้องอยู่ระหว่าง 1–1000" };
    if (!DATE_RE.test(input.from)) return { error: "วันที่เริ่มใช้ไม่ถูกต้อง" };
    if (input.employmentIds.length === 0) return { error: "ยังไม่ได้เลือกคนงาน" };
    const byName = await nameOf(session.userId);
    const at = new Date().toISOString();
    const ids = new Set(input.employmentIds);
    await updateStoreList<PayRateEntry>(session.orgId!, PAY_KEY, session.userId, (list) => [
      ...list.filter((r) => !(ids.has(r.employmentId) && r.from === input.from)),
      ...[...ids].map((employmentId) => ({
        employmentId,
        dailyWage: Math.round(wage * 100) / 100,
        otPercent: ot,
        from: input.from,
        byUserId: session.userId,
        byName,
        at,
      })),
    ]);
    revalidatePath("/daily-workers");
    return { ok: true, done: ids.size };
  } catch (error) {
    return { error: message(error) };
  }
}
