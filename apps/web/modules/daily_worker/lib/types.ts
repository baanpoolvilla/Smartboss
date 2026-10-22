/** ชนิดข้อมูลของโมดูลคนงานรายวัน — ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และหน้าจอ (ไม่มี I/O) */

/**
 * สถานะของวัน (กติกา 19/10/2569):
 *   m=มาตรงเวลา · s=สาย (ลงเข้าหลังเวลาเข้ากะ — หักเงินตามนาที) · x=ขาด (ลงเข้าแต่ไม่ลงออกในวันนั้น — ไม่ได้ค่าแรง)
 *   n=ไม่มา · o=หยุด (Day-Off ผู้ดูแลลง) · l=ลาประเภทอื่น · r=วันหยุดตามกะ · ""=ยังไม่มีข้อมูล
 */
export type DayStatus = "m" | "s" | "x" | "n" | "o" | "l" | "r" | "";

/** ค่าแรงของวันหนึ่ง (บาท) — total = wage − deduct + ot */
export interface DayPay {
  wage: number;
  deduct: number;
  ot: number;
  total: number;
}

export interface DayCell {
  s: DayStatus;
  inAt?: string;
  outAt?: string;
  /** ลงออกก่อนเลิกกะ (ยังนับว่ามา แต่หักเงินตามนาที) */
  early?: boolean;
  /** นาทีที่สาย / กลับก่อน (ไม่นับพักเที่ยง) */
  lateMin?: number;
  earlyMin?: number;
  /** นาทีที่ทำงานจริงในกะ (เต็มวัน = 480) */
  workedMin?: number;
  /** ค่าแรงวันนี้ — ไม่มี = ยังคิดไม่ได้ (ยังไม่ตั้งค่าแรงรายวัน / วันนี้ยังไม่ลงออก) */
  pay?: DayPay;
  /** ที่มาของค่าแรงวันนี้ (ใครตั้ง มีผลวันไหน % OT) — โชว์ใน "ที่มาของตัวเลข" */
  rate?: { wage: number; otPercent: number; origin: "module" | "hr"; byName: string | null; from: string; otFromCompany: boolean };
  /** กะของวันนั้นจริง (นาที) */
  shift?: { start: number; end: number };
  /** ผู้ดูแลแก้เวลาเข้า/ออก (ไปหน้างานมา สแกนไม่ทัน ฯลฯ) — เก็บเวลาที่สแกนจริงไว้ด้วย */
  edit?: { inAt: string | null; outAt: string | null; scannedIn: string | null; scannedOut: string | null; reason: string; byName: string; at: string };
  ot?: { id: string; start: string; end: string; minutes: number; note: string; byName: string };
  override?: { reason: string; byName: string; at: string };
  leave?: { id: string; name: string; dayOff: boolean; byName: string | null; at: string };
}

export interface WorkerMonth {
  userId: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  employmentId: string | null;
  employeeCode: string | null;
  shiftId: string | null;
  shiftName: string | null;
  shiftStart: number | null;
  shiftEnd: number | null;
  /** กะแยกรายวันในสัปดาห์ (0 = จันทร์ … 6 = อาทิตย์) จากตารางประจำ — null = ยังไม่ผูกกะ */
  week: WeekShift[] | null;
  /** วันแรกที่ลงเวลาจริง — ก่อนวันนั้นไม่นับ "ไม่มา" · null = ยังไม่เคยลงเวลา (ยังไม่นับไม่มาเลย) */
  startedOn: string | null;
  /** กะเริ่มมีผลวันข้างหน้า (ผูกไว้ล่วงหน้า) — null = มีผลแล้ว */
  shiftFrom: string | null;
  /** ค่าแรงรายวัน (บาท) ที่มีผลวันนี้/สิ้นเดือน — ตั้งในโมดูลนี้ (ไม่มีค่อยดูระบบบุคคล) · null = ยังไม่ตั้ง */
  dailyWage: number | null;
  /** % OT ของคนนี้ — null = ใช้ % กลาง (MonthData.otPercent) */
  otPercent: number | null;
  /** key = วันที่ของเดือน (1–31) */
  cells: Record<number, DayCell>;
}

export interface MonthData {
  month: string;
  /** คนงานที่เจอทะเบียนจากอีเมลแต่บัญชียังไม่ผูก — หน้าเว็บผูกให้เอง (syncUserToWorkforce) */
  unlinkedUserIds: string[];
  days: number;
  today: string;
  workers: WorkerMonth[];
  dayOffTypeId: string | null;
  shifts: { id: string; name: string; start: number; end: number }[];
  /** % ค่า OT ของค่าแรงต่อชั่วโมง (ตั้งค่าได้ · ค่าเริ่มต้น 150) */
  otPercent: number;
}

/** ผู้ดูแลแก้เวลาเข้า/ออกของวันหนึ่ง — store daily-worker-time-edits · null = ใช้เวลาที่สแกนจริง */
export interface TimeEditEntry {
  employmentId: string;
  date: string;
  inAt: string | null;
  outAt: string | null;
  reason: string;
  byUserId: string;
  byName: string;
  at: string;
}

export interface DwSettings {
  otPercent: number;
}

/**
 * ค่าแรงของคนงานที่ตั้งในโมดูลนี้ (ผู้ใช้ขอ 19/10/2569 "ตั้งค่าเงินเดือน และค่า OT ได้ เฉพาะคนงาน")
 * store daily-worker-pay · มีผลตั้งแต่วัน `from` — วันก่อนหน้าคิดเรทเดิม
 * otPercent null = ใช้ % กลางของบริษัท
 */
export interface PayRateEntry {
  employmentId: string;
  dailyWage: number;
  otPercent: number | null;
  from: string;
  byUserId: string;
  byName: string;
  at: string;
}
export const DEFAULT_OT_PERCENT = 150;

/** วันหนึ่งทำงาน 8 ชม. = 480 นาที — ค่าแรงต่อนาที = ค่าแรงวัน ÷ 480 (ผู้ใช้กำหนด 19/10/2569) */
export const WORK_DAY_MINUTES = 480;
/** พักเที่ยง 12:00–13:00 ไม่นับเป็นเวลาทำงาน (กะ 08:00–17:00 = 8 ชม.) */
export const LUNCH_START = 12 * 60;
export const LUNCH_END = 13 * 60;

/** นาทีทำงานในช่วง [from, to) ไม่นับพักเที่ยง */
export function workMinutes(from: number, to: number): number {
  if (to <= from) return 0;
  const lunch = Math.max(0, Math.min(to, LUNCH_END) - Math.max(from, LUNCH_START));
  return to - from - lunch;
}

export function hmToMin(hm: string): number {
  return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
}

/**
 * สาย / กลับก่อน / ทำงานจริง (นาที ไม่นับพักเที่ยง) จากเวลาเข้า-ออกกับกะ
 * outMin = null → ยังไม่ลงออก (ไม่คิดกลับก่อน) · ignoreEarly = วันที่มี OT ที่ผู้ดูแลลงไว้ (ไม่ดูเวลาออก)
 */
export function judgeTimes(shiftStart: number, shiftEnd: number, inMin: number, outMin: number | null, ignoreEarly = false) {
  const start = shiftStart;
  const end = shiftEnd;
  let out = outMin;
  if (out !== null && out < inMin) out += 1440; // ออกหลังเที่ยงคืน
  const scheduledMin = workMinutes(start, end);
  const lateMin = inMin > start ? workMinutes(start, Math.min(inMin, end)) : 0;
  const earlyMin = !ignoreEarly && out !== null && out < end ? workMinutes(Math.max(out, start), end) : 0;
  const workedMin = Math.max(0, scheduledMin - lateMin - earlyMin);
  return { lateMin, earlyMin, workedMin, scheduledMin };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ค่าแรงของวัน: หักนาทีละ ค่าแรง÷480 (ไม่เกินค่าแรงวัน) + OT = ชม. × (ค่าแรง÷8) × % */
export function dayPay(wage: number, deductMin: number, otMin: number, otPercent: number): DayPay {
  const deduct = round2(Math.min(wage, (deductMin * wage) / WORK_DAY_MINUTES));
  const ot = round2((otMin / 60) * (wage / 8) * (otPercent / 100));
  return { wage, deduct, ot, total: round2(wage - deduct + ot) };
}

export function baht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export interface OtEntry {
  id: string;
  employmentId: string;
  date: string;
  start: string;
  end: string;
  minutes: number;
  note: string;
  byUserId: string;
  byName: string;
  at: string;
}

export interface OverrideEntry {
  employmentId: string;
  date: string;
  reason: string;
  byUserId: string;
  byName: string;
  at: string;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "17:00","19:00" → 120 · ข้ามเที่ยงคืนได้ (22:00–02:00 = 240) */
export function otMinutes(start: string, end: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number) as [number, number];
    return h * 60 + m;
  };
  let diff = toMin(end) - toMin(start);
  if (diff <= 0) diff += 1440;
  return diff;
}

export function minutesToHm(minutes: number | null): string {
  if (minutes === null) return "—";
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** กะของวันหนึ่งในตารางประจำ — วันไหนไม่ได้ผูกกะ = null */
export type WeekShift = { id: string; start: number; end: number } | null;

/** ชื่อย่อวัน เรียง จันทร์ → อาทิตย์ (ลำดับเดียวกับ WorkerMonth.week) */
export const WEEKDAY_SHORT = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"] as const;

/** ลำดับวันของวันที่ YYYY-MM-DD — 0 = จันทร์ … 6 = อาทิตย์ */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * กะของคนงานในวันนั้นตามตารางประจำ (แยกรายวันได้ เช่น อาทิตย์เข้า 09:00)
 * ไม่มีตารางรายวัน = ใช้กะหลักแบบเดิม
 */
export function shiftOnDate(w: Pick<WorkerMonth, "week" | "shiftStart" | "shiftEnd">, date: string): { start: number | null; end: number | null } {
  if (!w.week) return { start: w.shiftStart, end: w.shiftEnd };
  const s = w.week[weekdayIndex(date)];
  return s ? { start: s.start, end: s.end } : { start: null, end: null };
}

/**
 * กะที่แสดงข้างชื่อ — ทุกวันเหมือนกัน = "08:00–17:00" · มีวันที่ต่าง = "08:00–17:00 · อา 09:00–17:00"
 * (เวลาที่ใช้มากที่สุดเป็นตัวหลัก วันที่ต่างไล่ตามหลัง)
 */
export function shiftLabel(w: Pick<WorkerMonth, "shiftId" | "week" | "shiftStart" | "shiftEnd">): string | null {
  if (!w.shiftId) return null;
  const range = (s: WeekShift) => (s ? `${minutesToHm(s.start)}–${minutesToHm(s.end)}` : "ไม่มีกะ");
  if (!w.week) return `${minutesToHm(w.shiftStart)}–${minutesToHm(w.shiftEnd)}`;
  const labels = w.week.map(range);
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const others = new Map<string, string[]>();
  labels.forEach((l, i) => {
    if (l !== main) others.set(l, [...(others.get(l) ?? []), WEEKDAY_SHORT[i]!]);
  });
  return [main, ...[...others.entries()].map(([l, days]) => `${days.join(",")} ${l}`)].join(" · ");
}

export function hoursLabel(minutes: number): string {
  if (minutes === 0) return "0";
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} ชม.`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export interface DayInput {
  date: string;
  today: string;
  /** เวลาที่ใช้คิด (ผู้ดูแลแก้แล้ว หรือที่สแกนจริง) */
  inAt: string | null;
  outAt: string | null;
  /** กะของ "วันนั้น" (นาทีจากเที่ยงคืน) — null = ไม่มีกะ คิดสาย/เงินไม่ได้ */
  shiftStart: number | null;
  shiftEnd: number | null;
  /** OT ที่ผู้ดูแลลงไว้วันนั้น (นาที) — มี = ไม่ดูเวลาออก */
  otMinutes: number | null;
  /** "แก้เป็นมา" แบบเดิม = ไม่นับสาย */
  legacyOverride: boolean;
  wage: number | null;
  otPercent: number;
}

export interface DayJudgement {
  s: "m" | "s" | "x";
  lateMin: number;
  earlyMin: number;
  workedMin: number;
  pay: DayPay | null;
}

/**
 * ตัดสินวันที่มีเวลาเข้า (กติกา 19/10/2569) — ฟังก์ชันเดียวที่ทุกหน้าใช้ (ตาราง/วันนี้/Excel)
 *   - ไม่ลงออก + วันผ่านไปแล้ว + ไม่มี OT = ขาด (ไม่ได้ค่าแรง)
 *   - ลงเข้า-ออกแต่ไม่ได้ทำงานในกะเลยสักนาที (เช่นสแกนซ้ำตอนเช้า 07:58/07:59) = ขาด
 *   - เข้าหลังเวลาเข้ากะ = สาย · หักสาย + กลับก่อน นาทีละ ค่าแรง÷480 · OT = ชม. × ค่าแรง÷8 × %
 *   - วันนี้ที่ยังไม่ลงออก = ตัดสินสาย/ไม่สายได้ แต่ยังไม่คิดเงิน
 */
export function judgeDay(d: DayInput & { inAt: string }): DayJudgement {
  const hasOt = (d.otMinutes ?? 0) > 0;
  const noOut = !d.outAt && !hasOt;
  if (noOut && d.date < d.today) return { s: "x", lateMin: 0, earlyMin: 0, workedMin: 0, pay: null };
  if (d.shiftStart === null || d.shiftEnd === null) return { s: "m", lateMin: 0, earlyMin: 0, workedMin: 0, pay: null };
  const t = judgeTimes(d.shiftStart, d.shiftEnd, hmToMin(d.inAt), d.outAt ? hmToMin(d.outAt) : null, hasOt);
  const lateMin = d.legacyOverride ? 0 : t.lateMin;
  const workedMin = Math.max(0, t.scheduledMin - lateMin - t.earlyMin);
  if (!noOut && workedMin === 0 && !hasOt) return { s: "x", lateMin: 0, earlyMin: 0, workedMin: 0, pay: null };
  const pay = d.wage !== null && !noOut ? dayPay(d.wage, lateMin + t.earlyMin, d.otMinutes ?? 0, d.otPercent) : null;
  return { s: lateMin > 0 ? "s" : "m", lateMin, earlyMin: t.earlyMin, workedMin, pay };
}

/* ───────────── บัญชีค้างจ่าย (ผู้ใช้ตกลง 19/10/2569) ─────────────
 * ค่าแรงที่ได้แต่ละวัน (DayCell.pay.total) เข้าบัญชีเอง · เงินที่จ่ายออกบันทึกเป็นรายการ (PaymentEntry)
 * คงเหลือ = ยกมา + ได้ − จ่าย · บวก = บริษัทค้างจ่าย · ลบ = คนงานเบิกเกิน (หักจากค่าแรงวันถัดไปเอง)
 * จ่ายเกินยอดค้าง = เบิกล่วงหน้า — เฉพาะคนที่มีสิทธิ์ตั้งค่าแรง (HR/CEO) · ผู้ดูแลบ้านจ่ายได้ไม่เกินยอดค้าง
 */
export interface PaymentEntry {
  id: string;
  employmentId: string;
  /** วันที่จ่าย (เวลาไทย) */
  date: string;
  amount: number;
  /** wage = จ่ายค่าแรงที่ค้าง · advance = จ่ายเกินยอดค้าง (เบิกล่วงหน้า) */
  kind: "wage" | "advance";
  note: string;
  byUserId: string;
  byName: string;
  at: string;
  /** ค่าแรงของแต่ละวัน ณ ตอนจ่าย (วันในเดือนเดียวกัน ≤ date) — ไว้บอกว่ายอดวันไหนเปลี่ยนหลังจ่าย */
  snapshot?: Record<string, number>;
  voided?: { byName: string; at: string; reason: string };
}

export interface DayMoney {
  date: string;
  /** คงเหลือก่อนวันนี้ */
  carried: number;
  earned: number;
  paid: number;
  /** คงเหลือสิ้นวัน */
  balance: number;
  payments: PaymentEntry[];
}

const r2m = (n: number) => Math.round(n * 100) / 100;

/**
 * เดินบัญชีทีละวัน: ยกมา → +ได้วันนั้น → −จ่ายวันนั้น (ได้ก่อนจ่าย จ่ายค่าแรงวันนี้ในวันเดียวกันได้)
 * payments ที่ยกเลิกแล้ว (voided) ไม่นับ
 */
export function walkLedger(opening: number, dates: string[], earnByDate: Record<string, number>, payments: PaymentEntry[]): DayMoney[] {
  const live = payments.filter((p) => !p.voided);
  let bal = opening;
  return dates.map((date) => {
    const carried = r2m(bal);
    const earned = r2m(earnByDate[date] ?? 0);
    const mine = live.filter((p) => p.date === date);
    const paid = r2m(mine.reduce((s, p) => s + p.amount, 0));
    bal = r2m(carried + earned - paid);
    return { date, carried, earned, paid, balance: bal, payments: mine };
  });
}

/** ยอดของวันนั้นเปลี่ยนหลังจ่ายไปแล้วไหม — เทียบกับ snapshot ของการจ่ายครั้งล่าสุดที่ครอบวันนั้น */
export function changedAfterPay(date: string, current: number, payments: PaymentEntry[]): { was: number; now: number; paidAt: string } | null {
  const p = payments
    .filter((x) => !x.voided && x.snapshot && x.snapshot[date] !== undefined)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!p) return null;
  const was = p.snapshot![date]!;
  return Math.abs(was - current) >= 0.01 ? { was, now: r2m(current), paidAt: p.at } : null;
}

/** ยอดที่ยังค้างจ่ายได้โดยไม่นับเป็นเบิก (คงเหลือสิ้นวันนั้น ไม่ติดลบ) */
export function owedOn(days: DayMoney[], date: string): number {
  const d = days.find((x) => x.date === date) ?? [...days].reverse().find((x) => x.date <= date);
  return d ? Math.max(0, d.balance) : 0;
}
