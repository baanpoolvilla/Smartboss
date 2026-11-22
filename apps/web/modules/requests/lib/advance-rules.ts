/**
 * กติกาเบิกล่วงหน้า ตั้งเองได้รายบริษัท (ผู้ใช้ 22/11/2569 "ยืดหยุ่นกับคนอื่นที่ซื้อระบบเราไป ให้เขาปรับเองใช้เอง")
 *   ใครเบิกได้: ทุกคน / เฉพาะคนงานรายวัน / เฉพาะพนักงานรายเดือน
 *   เพดานแยกคนงานกับพนักงาน: บาท หรือ จำนวนวันของค่าแรง · นับต่อเดือน / ครึ่งเดือน / สัปดาห์ · จำกัดจำนวนครั้งต่อรอบได้
 *   รอบเริ่มวันไหน: วันเริ่มรอบเดือน (1–28 เช่น 26 = 26 ถึง 25 เดือนถัดไป) · วันเริ่มสัปดาห์ (อาทิตย์–เสาร์)
 * ยังไม่เคยตั้ง = แปลงจากค่าเดิม (เพดานเดียวกันทุกคน ต่อเดือน) — ของเดิมไม่เปลี่ยน
 * ฟังก์ชันล้วน ทดสอบได้
 */
import { addDays, daysInMonthOf, round2, type AdvanceCapMode } from "./types";

export type AdvancePeriod = "month" | "half" | "week";
export type AdvanceWho = "all" | "worker" | "staff";

export interface AdvanceGroupRule {
  mode: AdvanceCapMode;
  /** บาท หรือ จำนวนวัน */
  value: number;
  period: AdvancePeriod;
  /** เบิกได้กี่ครั้งต่อรอบ — null = ไม่จำกัด */
  maxCount: number | null;
}

export interface AdvanceRules {
  who: AdvanceWho;
  /** วันเริ่มรอบเดือน 1–28 (1 = ตามเดือนปฏิทิน) */
  monthStartDay: number;
  /** วันเริ่มสัปดาห์ 0 = อาทิตย์ … 6 = เสาร์ */
  weekStart: number;
  worker: AdvanceGroupRule;
  staff: AdvanceGroupRule;
}

export const WEEKDAY_NAMES = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
export const PERIOD_LABEL: Record<AdvancePeriod, string> = { month: "ต่อเดือน", half: "ต่อครึ่งเดือน", week: "ต่อสัปดาห์" };

const MODES: AdvanceCapMode[] = ["none", "baht", "days"];
const PERIODS: AdvancePeriod[] = ["month", "half", "week"];

/** ค่าเดิมก่อนมีกติกานี้: เพดานเดียวกันทุกคน (เฉพาะคนงานได้ถ้าเคยติ๊ก) */
export function legacyAdvanceRules(mode: AdvanceCapMode, value: number, period: "month" | "half" = "month", workersOnly = false): AdvanceRules {
  const rule: AdvanceGroupRule = { mode, value: mode === "none" ? 0 : value, period, maxCount: null };
  return { who: workersOnly ? "worker" : "all", monthStartDay: 1, weekStart: 1, worker: { ...rule }, staff: { ...rule } };
}

function parseGroup(v: unknown): AdvanceGroupRule | null {
  const g = v as Partial<AdvanceGroupRule> | null;
  if (!g || typeof g !== "object") return null;
  const mode = MODES.includes(g.mode as AdvanceCapMode) ? (g.mode as AdvanceCapMode) : null;
  const period = PERIODS.includes(g.period as AdvancePeriod) ? (g.period as AdvancePeriod) : null;
  const value = round2(Number(g.value));
  const max = g.maxCount === null || g.maxCount === undefined || (g.maxCount as unknown) === "" ? null : Math.floor(Number(g.maxCount));
  if (!mode || !period) return null;
  if (mode !== "none" && (!Number.isFinite(value) || value <= 0 || value > 1_000_000)) return null;
  if (max !== null && (!Number.isFinite(max) || max < 1 || max > 100)) return null;
  return { mode, value: mode === "none" ? 0 : value, period, maxCount: max };
}

/** อ่านจากฐานข้อมูล/ฟอร์ม — ไม่ถูกต้อง = null (ใช้ค่าเดิมแทน / ฟอร์มขึ้นเตือน) */
export function parseAdvanceRules(v: unknown): AdvanceRules | null {
  const r = v as Partial<AdvanceRules> | null;
  if (!r || typeof r !== "object") return null;
  const who: AdvanceWho | null = r.who === "all" || r.who === "worker" || r.who === "staff" ? r.who : null;
  const monthStartDay = Math.floor(Number(r.monthStartDay));
  const weekStart = Math.floor(Number(r.weekStart));
  const worker = parseGroup(r.worker);
  const staff = parseGroup(r.staff);
  if (!who || !worker || !staff) return null;
  if (!(monthStartDay >= 1 && monthStartDay <= 28) || !(weekStart >= 0 && weekStart <= 6)) return null;
  return { who, monthStartDay, weekStart, worker, staff };
}

export function canAdvance(rules: AdvanceRules, group: "worker" | "staff"): boolean {
  return rules.who === "all" || rules.who === group;
}

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const parts = (ymd: string) => ymd.split("-").map(Number) as [number, number, number];

/** "1–15 พ.ย. 2569" · "26 ต.ค.–25 พ.ย. 2569" · "29 ธ.ค. 2569–4 ม.ค. 2570" */
export function rangeLabel(from: string, to: string): string {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${TH_MONTHS[m2 - 1]} ${y2 + 543}`;
  if (y1 === y2) return `${d1} ${TH_MONTHS[m1 - 1]}–${d2} ${TH_MONTHS[m2 - 1]} ${y2 + 543}`;
  return `${d1} ${TH_MONTHS[m1 - 1]} ${y1 + 543}–${d2} ${TH_MONTHS[m2 - 1]} ${y2 + 543}`;
}

function monthShift(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** รอบเดือนที่วันนี้อยู่ — เริ่มวันที่ startDay (1 = เดือนปฏิทิน) */
function monthRound(ymd: string, startDay: number): { from: string; to: string } {
  const month = ymd.slice(0, 7);
  const day = Number(ymd.slice(8, 10));
  if (startDay <= 1) return { from: `${month}-01`, to: `${month}-${String(daysInMonthOf(month)).padStart(2, "0")}` };
  const startMonth = day >= startDay ? month : monthShift(month, -1);
  const from = `${startMonth}-${String(startDay).padStart(2, "0")}`;
  const to = addDays(`${monthShift(startMonth, 1)}-${String(startDay).padStart(2, "0")}`, -1);
  return { from, to };
}

/** รอบเพดานของวันที่เบิก (from ถึง to รวมทั้งสองวัน) */
export function advanceRound(ymd: string, period: AdvancePeriod, opts: { monthStartDay: number; weekStart: number }): { from: string; to: string; label: string } {
  let from: string;
  let to: string;
  if (period === "week") {
    const [y, m, d] = parts(ymd);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    from = addDays(ymd, -((dow - opts.weekStart + 7) % 7));
    to = addDays(from, 6);
  } else {
    const mr = monthRound(ymd, opts.monthStartDay);
    if (period === "half") {
      // ครึ่งแรก 15 วันแรกของรอบเดือน · ครึ่งหลัง = ที่เหลือ (รอบเดือนปฏิทิน = 1–15 / 16–สิ้นเดือน)
      const midEnd = addDays(mr.from, 14);
      [from, to] = ymd <= midEnd ? [mr.from, midEnd] : [addDays(midEnd, 1), mr.to];
    } else {
      [from, to] = [mr.from, mr.to];
    }
  }
  return { from, to, label: `รอบ ${rangeLabel(from, to)}` };
}

/** ข้อความสั้นของกติกากลุ่มหนึ่ง — ใช้ในประวัติการตั้งค่า */
export function ruleText(r: AdvanceGroupRule): string {
  const cap = r.mode === "none" ? "ไม่จำกัดยอด" : r.mode === "baht" ? `ไม่เกิน ${r.value.toLocaleString("th-TH")} บาท` : `ไม่เกิน ${r.value} วันของค่าแรง`;
  return `${cap} ${PERIOD_LABEL[r.period]}${r.maxCount ? ` ไม่เกิน ${r.maxCount} ครั้ง` : ""}`;
}
