import { addDays, isDate, previousPeriod, todayIn, type Period } from "./periods";

/**
 * อ่านพารามิเตอร์ช่วงเวลา — ใช้ทั้ง REST (spec §8) และ query string ของหน้าจอ
 *   from, to     YYYY-MM-DD (ไม่ระบุ = 7 วันล่าสุดถึงเมื่อวาน)
 *   compare      "previous" (ค่าเริ่มต้น ช่วงก่อนหน้ายาวเท่ากัน) | "none" | "YYYY-MM-DD,YYYY-MM-DD"
 */
export interface PeriodQuery {
  period: Period;
  compare: Period | null;
  compareMode: "previous" | "none" | "custom";
}

type Params = { get(name: string): string | null };

export function parsePeriodQuery(params: Params): PeriodQuery {
  const today = todayIn();
  let from = params.get("from");
  let to = params.get("to");
  if (!isDate(from) || !isDate(to) || from > to) {
    to = addDays(today, -1);
    from = addDays(to, -6);
  }
  const period = { from, to };
  const raw = params.get("compare") ?? "previous";
  if (raw === "none") return { period, compare: null, compareMode: "none" };
  const [cf, ct] = raw.split(",");
  if (isDate(cf) && isDate(ct) && cf <= ct) return { period, compare: { from: cf, to: ct }, compareMode: "custom" };
  return { period, compare: previousPeriod(period), compareMode: "previous" };
}

/** แปลง searchParams ของหน้า (Record) ให้อ่านแบบเดียวกับ URLSearchParams */
export function recordParams(sp: Record<string, string | string[] | undefined>): Params {
  return { get: (k) => (typeof sp[k] === "string" ? (sp[k] as string) : null) };
}
