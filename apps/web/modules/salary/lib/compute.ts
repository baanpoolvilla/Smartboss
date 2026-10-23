/**
 * ตัวคำนวณเงินเดือนรายคนหนึ่งงวด — ฟังก์ชันล้วน (ไม่มี I/O) ทดสอบได้ครบทุกกรณีที่ __tests__/compute.test.ts
 *
 * หลักการ (ผู้ใช้ตกลง 22/10/2569 · "ส่วนคิดเงินเดือนถ้าผิดพลาดคือหมดความไว้วางใจ"):
 *   - คิดเป็นสตางค์ทั้งหมด บรรทัดละจำนวนเต็มสตางค์ ยอดรวม = ผลรวมของบรรทัด (ไม่มีเศษหลุด)
 *   - ทุกบรรทัดมี `how` บอกว่าคิดยังไง — แสดงบนสลิป/หน้าอนุมัติ ("แจกแจงให้ชัดว่าหักอะไรแบบไหน")
 *   - เงินเดือน: เต็มงวด = เต็มเดือน · ปรับกลางงวด = ถัวตามวัน · เข้า/ออกกลางงวด = ÷ 30 × วันที่ทำงาน
 *   - ลาไม่รับค่าจ้าง / ขาด = ÷ 30 ต่อวัน · สาย = ÷ 30 ÷ 8 ÷ 60 ต่อนาที หรือครั้งละ X บาท (ตามตั้งค่า)
 *   - ประกันสังคม: % ของค่าจ้าง (ขั้นต่ำ–เพดาน) ปัดเป็นบาทแบบ สปส. (≥ 50 สตางค์ปัดขึ้น) ไม่เกินสมทบสูงสุด
 *   - ภาษี: ประมาณทั้งปีจากเงินได้ประจำ แล้วเฉลี่ยงวดที่เหลือ (หักที่หักไปแล้วออก) ·
 *           เงินได้ไม่ประจำ (OT โบนัส รายการครั้งเดียว) คิดภาษีส่วนเพิ่มทั้งก้อนในงวดที่จ่าย — ไม่คูณทั้งปี
 *           (คูณทั้งปีทำให้ภาษีเดือนที่มีโบนัสสูงเกินจริงมาก) · ธันวาคม = งวดสุดท้าย ยอดทั้งปีตรงพอดี ·
 *           หักเกินไปแล้วงวดนี้หัก 0 (ไม่คืนในเงินเดือน — คืนตอนยื่นภาษีปลายปี)
 */
import {
  daysBetweenInclusive,
  fmt,
  roundSatangToBaht,
  toBaht,
  TH_MONTH,
  toSatang,
  type ItemKind,
  type LateMode,
  type SsoParams,
  type TaxMode,
  type TaxParams,
} from "./types";

export interface SalarySegment {
  /** เงินเดือน (บาท/เดือน) ช่วงนี้ */
  monthly: number;
  /** วันแรก–วันสุดท้ายที่มีผลและยังทำงานอยู่ภายในงวด (รวมทั้งสองวัน) */
  from: string;
  to: string;
}

export interface AutoItem {
  refId: string;
  code: string;
  label: string;
  /** บาท */
  amount: number;
  detail: string;
  /** สูตรเป็นตัวเลขจริง เช่น "เงินเดือน ฿15,000 ÷ 30 ÷ 8 = ฿62.50/ชม. × 150% × 3 ชม." (OT) */
  formula?: string;
}

export interface RecurringItem {
  refId: string;
  name: string;
  kind: ItemKind;
  amount: number;
  taxable: boolean;
  ssoBase: boolean;
  /** ที่มา เช่น "ผ่อนงวดที่ 1/3 (ถึง ธ.ค. 2569)" — ไม่มี = ประจำทุกเดือน */
  detail?: string;
}

export interface CommissionInput {
  amount: number;
  detail: string;
  taxable: boolean;
  ssoBase: boolean;
  pending?: string;
}

export interface Adjustment {
  id: string;
  label: string;
  kind: ItemKind;
  amount: number;
  /** เงินได้: คิดภาษี */
  taxable: boolean;
  /** เงินได้: นับเป็นค่าจ้างคิดประกันสังคม */
  ssoBase: boolean;
  reason: string;
  byName: string;
}

export interface Override {
  /** บาท */
  amount: number;
  reason: string;
  byName: string;
}

export interface ComputeInput {
  period: { startsOn: string; endsOn: string; payDate: string };
  salary: SalarySegment[];
  unpaidLeaveDays: number;
  late: { minutes: number; count: number };
  absentDays: number;
  ot: (AutoItem & { minutes: number })[];
  advances: AutoItem[];
  recurring: RecurringItem[];
  /** ค่าคอม Pool ตามเกรดของเดือนนี้ (ระบบบุคคล › พนักงาน › ค่าคอม) — pending = ยังไม่ใส่ เพราะเกรดยังไม่ปิด */
  commission?: CommissionInput;
  adjustments: Adjustment[];
  overrides: { sso?: Override; tax?: Override };
  profile: {
    ssoExempt: boolean;
    ssoExemptReason: string;
    taxMode: TaxMode;
    taxFixedAmount: number;
    taxNoneReason: string;
    /** ลดหย่อนเพิ่มทั้งปี (บาท) */
    extraAllowance: number;
  };
  /**
   * ยอดสะสมของปีภาษีเดียวกัน (งวดที่จ่ายแล้วก่อนหน้า + ยอดยกมา) — บาท
   * periods = จำนวนงวดที่มีในยอดสะสมจากระบบ · gapPeriods = งวดก่อนหน้าปีนี้ที่ทำงานอยู่แต่ไม่มีข้อมูลเลย
   * (เริ่มใช้ระบบกลางปีและยังไม่กรอกยอดยกมา) — ระบบประมาณด้วยเงินเดือนปัจจุบันแทน ไม่ปล่อยให้ภาษีหักขาด
   */
  ytd: { taxable: number; tax: number; sso: number; periods?: number; gapPeriods?: number };
  settings: {
    deductLate: boolean;
    lateMode: LateMode;
    latePerTime: number;
    deductAbsent: boolean;
    deductUnpaidLeave: boolean;
    otSsoBase: boolean;
  };
  sso: SsoParams;
  tax: TaxParams;
}

export type LineSource =
  | "salary" | "ot" | "recurring" | "commission" | "adjustment"
  | "unpaid_leave" | "late" | "absent" | "sso" | "tax" | "advance" | "sso_employer";

export interface PayLine {
  key: string;
  label: string;
  kind: "earning" | "deduction" | "employer";
  /** บาท (2 ตำแหน่ง) */
  amount: number;
  /** คิดยังไง — ภาษาคน แสดงบนสลิป */
  how: string;
  source: LineSource;
  /** ระบบคิด/ดึงมาให้เอง (ไม่ใช่ HR พิมพ์) */
  auto: boolean;
  refId?: string;
  /** คำอธิบายละเอียด (กดดู) — ตอนนี้ใช้กับ OT */
  formula?: string;
}

export interface ComputeResult {
  lines: PayLine[];
  gross: number;
  deductions: number;
  net: number;
  ssoEmployee: number;
  ssoEmployer: number;
  tax: number;
  /** เงินได้คิดภาษีของงวดนี้ (รวมเงินได้ไม่ประจำ) */
  taxable: number;
  /** ค่าจ้างที่ใช้คิดประกันสังคม (ก่อนตัดขั้นต่ำ/เพดาน) */
  ssoWage: number;
  /** ภาษีที่ระบบคิดได้ (ก่อน HR ปรับ/โหมดคงที่) — ไว้เทียบ */
  taxComputed: number;
  ssoComputed: number;
  /** วิธีคิดภาษีทีละขั้น (บาท) — ให้หน้าจอ/สลิปแสดงเป็นตาราง */
  taxBreak: TaxBreak;
  warnings: string[];
}

/** ตัวเลขทุกขั้นของการคิดภาษีงวดนี้ (บาท) — ขั้นเดียวกับ annualTax ไม่มีสูตรแยก */
export interface TaxBreak {
  /** เงินได้ประจำงวดนี้ที่ใช้ประมาณทั้งปี */
  regular: number;
  /** จำนวนงวดที่คูณ (งวดที่เหลือ + งวดที่ยังไม่มีข้อมูล) */
  regularPeriods: number;
  /** เงินได้ที่จ่ายไปแล้ว/ยอดยกมา */
  ytdIncome: number;
  /** เงินได้ไม่ประจำงวดนี้ (OT โบนัส) */
  irregular: number;
  income: number;
  expense: number;
  personal: number;
  sso: number;
  extra: number;
  net: number;
  annualTax: number;
  withheld: number;
  assumedGap: number;
  gap: number;
  periodsLeft: number;
  spread: number;
  regularPart: number;
  irregularPart: number;
  computed: number;
  /** ขั้นบันไดที่ใช้ตอนคิด (อัตราที่มีผล ณ งวดนี้) */
  brackets: TaxParams["brackets"];
}

/* ───────────── ภาษีขั้นบันได ───────────── */

/** ภาษีทั้งปีของเงินได้สุทธิ (สตางค์) */
export function progressiveTax(netIncomeSatang: number, brackets: TaxParams["brackets"]): number {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo === null ? Infinity : toSatang(b.upTo);
    if (netIncomeSatang <= lower) break;
    const slice = Math.min(netIncomeSatang, upper) - lower;
    tax += (slice * b.rate) / 100;
    lower = upper;
  }
  return Math.round(tax);
}

/** ที่มาของเงินได้สุทธิทั้งปี เป็นภาษาคน — ใส่ในคำอธิบายบรรทัดภาษีให้ตรวจเองได้ */
export function annualBreakdown(incomeSatang: number, ssoSatang: number, extraAllowanceSatang: number, p: TaxParams): string {
  const expense = Math.min(Math.round((incomeSatang * p.expenseRate) / 100), toSatang(p.expenseCap));
  const { net } = annualTax(incomeSatang, ssoSatang, extraAllowanceSatang, p);
  const parts = [`เงินได้ทั้งปีประมาณ ${fmt(incomeSatang)}`, `− ค่าใช้จ่าย ${fmt(expense)}`, `− ลดหย่อนส่วนตัว ${fmt(toSatang(p.personalAllowance))}`];
  if (ssoSatang > 0) parts.push(`− ประกันสังคม ${fmt(ssoSatang)}`);
  if (extraAllowanceSatang > 0) parts.push(`− ลดหย่อนอื่น ${fmt(extraAllowanceSatang)}`);
  return `${parts.join(" ")} = เงินได้สุทธิ ${fmt(net)}`;
}

/** เงินได้ทั้งปี → ภาษีทั้งปี (สตางค์) หลังหักค่าใช้จ่าย ลดหย่อนส่วนตัว ลดหย่อนเพิ่ม และประกันสังคม */
export function annualTax(incomeSatang: number, ssoSatang: number, extraAllowanceSatang: number, p: TaxParams): { tax: number; net: number } {
  const expense = Math.min(Math.round((incomeSatang * p.expenseRate) / 100), toSatang(p.expenseCap));
  const net = Math.max(0, incomeSatang - expense - toSatang(p.personalAllowance) - extraAllowanceSatang - ssoSatang);
  return { tax: progressiveTax(net, p.brackets), net };
}

/** จำนวนงวดที่เหลือในปีภาษี รวมงวดนี้ (งวดรายเดือน นับตามเดือนของวันจ่าย) */
export function periodsRemaining(payDate: string): number {
  const m = Number(payDate.slice(5, 7));
  return 12 - m + 1;
}

/**
 * งวดของปีภาษี (ปีของวันจ่าย) ก่อนงวดนี้ ที่คนนี้ทำงานอยู่แล้ว — งวดรายเดือนนับตามเดือนของวันจ่าย
 * เข้างานหลังวันตัดงวด = งวดแรกคือเดือนถัดไป
 */
export function periodsEmployedBefore(hiredOn: string, payDate: string, cutoffDay: number): number {
  const year = Number(payDate.slice(0, 4));
  const payMonth = Number(payDate.slice(5, 7));
  const hy = Number(hiredOn.slice(0, 4));
  if (hy > year) return 0;
  let first = 1;
  if (hy === year) {
    first = Number(hiredOn.slice(5, 7)) + (Number(hiredOn.slice(8, 10)) > cutoffDay ? 1 : 0);
  }
  return Math.max(0, payMonth - first);
}

/* ───────────── คำนวณ ───────────── */

export function computePay(input: ComputeInput): ComputeResult {
  const lines: PayLine[] = [];
  const warnings: string[] = [];
  const s = (b: number) => toSatang(b);

  /* ── เงินเดือน ── */
  const periodDays = daysBetweenInclusive(input.period.startsOn, input.period.endsOn);
  const segs = input.salary
    .map((g) => ({ ...g, days: Math.max(0, daysBetweenInclusive(g.from, g.to)) }))
    .filter((g) => g.days > 0 && g.monthly > 0);
  const employedDays = segs.reduce((n, g) => n + g.days, 0);
  let salary = 0;
  let salaryHow = "";
  if (segs.length === 0) {
    warnings.push("ยังไม่มีเงินเดือนในระบบ — ไม่ได้คิดเงินเดือน");
  } else if (employedDays >= periodDays && segs.length === 1) {
    salary = s(segs[0]!.monthly);
    salaryHow = "เต็มเดือน (ทำงานครบงวด)";
  } else if (employedDays >= periodDays) {
    // ปรับเงินเดือนกลางงวด: ถัวตามจำนวนวันของแต่ละอัตรา (รวมแล้วอยู่ระหว่างอัตราเก่า–ใหม่เสมอ)
    salary = Math.round(segs.reduce((sum, g) => sum + s(g.monthly) * g.days, 0) / periodDays);
    salaryHow = `ปรับเงินเดือนกลางงวด: ${segs.map((g) => `${fmt(s(g.monthly))} × ${g.days} วัน`).join(" + ")} ÷ ${periodDays} วัน`;
  } else {
    // เข้า/ออกกลางงวด: ÷ 30 × วันที่ทำงาน (ไม่เกินเต็มเดือนของอัตรานั้น)
    salary = segs.reduce((sum, g) => sum + Math.min(s(g.monthly), Math.round((s(g.monthly) * g.days) / 30)), 0);
    salaryHow = `ทำงาน ${employedDays} จาก ${periodDays} วัน: ${segs.map((g) => `${fmt(s(g.monthly))} ÷ 30 × ${g.days}`).join(" + ")}`;
  }
  // อัตราต่อวันใช้เงินเดือนล่าสุดในงวด
  const monthlyRate = segs.length > 0 ? s(segs[segs.length - 1]!.monthly) : 0;
  if (salary > 0) lines.push({ key: "salary", label: "เงินเดือน", kind: "earning", amount: toBaht(salary), how: salaryHow, source: "salary", auto: true });

  /* ── หักจากเงินเดือน (ลาไม่รับค่าจ้าง / ขาด / สาย) — ลดทั้งเงินได้คิดภาษีและค่าจ้างคิดประกันสังคม ── */
  let wageCut = 0;
  const cutLine = (key: string, label: string, amountSatang: number, how: string, source: LineSource) => {
    // หักได้ไม่เกินเงินเดือนที่เหลือ — ไม่ให้ติดลบจากส่วนนี้
    const amt = Math.min(amountSatang, Math.max(0, salary - wageCut));
    if (amt <= 0) return;
    wageCut += amt;
    lines.push({ key, label, kind: "deduction", amount: toBaht(amt), how, source, auto: true });
  };
  const perDay = Math.round(monthlyRate / 30);
  if (input.settings.deductUnpaidLeave && input.unpaidLeaveDays > 0 && monthlyRate > 0) {
    cutLine(
      "unpaid_leave",
      "ลาไม่รับค่าจ้าง",
      Math.round((monthlyRate * input.unpaidLeaveDays) / 30),
      `${input.unpaidLeaveDays} วัน × ${fmt(perDay)} (เงินเดือน ${fmt(monthlyRate)} ÷ 30)`,
      "unpaid_leave",
    );
  }
  if (input.settings.deductAbsent && input.absentDays > 0 && monthlyRate > 0) {
    cutLine("absent", "ขาดงาน", Math.round((monthlyRate * input.absentDays) / 30), `${input.absentDays} วัน × ${fmt(perDay)} (เงินเดือน ÷ 30)`, "absent");
  }
  if (input.settings.deductLate && monthlyRate > 0) {
    if (input.settings.lateMode === "minute" && input.late.minutes > 0) {
      cutLine(
        "late",
        "มาสาย / กลับก่อน",
        Math.round((monthlyRate * input.late.minutes) / (30 * 8 * 60)),
        `${input.late.minutes} นาที × เงินเดือน ÷ 30 ÷ 8 ÷ 60`,
        "late",
      );
    } else if (input.settings.lateMode === "per_time" && input.late.count > 0 && input.settings.latePerTime > 0) {
      cutLine("late", "มาสาย", input.late.count * s(input.settings.latePerTime), `${input.late.count} ครั้ง × ${fmt(s(input.settings.latePerTime))}`, "late");
    }
  }

  /* ── เงินได้อื่น ── */
  let regularEarn = 0; // เงินได้ประจำ (คิดภาษีแบบทั้งปี)
  let irregularEarn = 0; // เงินได้ไม่ประจำ (คิดภาษีทั้งก้อนงวดนี้)
  let ssoExtra = 0;
  for (const o of input.ot) {
    const amt = s(o.amount);
    if (amt <= 0) continue;
    lines.push({ key: `ot:${o.refId}`, label: o.label, kind: "earning", amount: toBaht(amt), how: o.detail, source: "ot", auto: true, refId: o.refId, ...(o.formula ? { formula: o.formula } : {}) });
    irregularEarn += amt;
    if (input.settings.otSsoBase) ssoExtra += amt;
  }
  for (const r of input.recurring) {
    const amt = s(r.amount);
    if (amt <= 0) continue;
    if (r.kind === "earning") {
      lines.push({ key: `rec:${r.refId}`, label: r.name, kind: "earning", amount: toBaht(amt), how: r.detail ?? "รายการประจำทุกเดือน", source: "recurring", auto: true, refId: r.refId });
      if (r.taxable) regularEarn += amt;
      if (r.ssoBase) ssoExtra += amt;
    } else {
      lines.push({ key: `rec:${r.refId}`, label: r.name, kind: "deduction", amount: toBaht(amt), how: r.detail ?? "รายการหักประจำทุกเดือน", source: "recurring", auto: true, refId: r.refId });
    }
  }
  if (input.commission?.pending) warnings.push(input.commission.pending);
  else if (input.commission && input.commission.amount > 0) {
    const amt = s(input.commission.amount);
    // จ่ายไม่สม่ำเสมอ (แล้วแต่เกรด/ยอด Pool) — คิดภาษีแบบเงินได้ไม่ประจำ เหมือน OT/โบนัส
    lines.push({ key: "commission", label: "ค่าคอม (ตามเกรด)", kind: "earning", amount: toBaht(amt), how: input.commission.detail, source: "commission", auto: true });
    if (input.commission.taxable) irregularEarn += amt;
    if (input.commission.ssoBase) ssoExtra += amt;
  }
  for (const a of input.adjustments) {
    const amt = s(a.amount);
    if (amt <= 0) continue;
    const how = `${a.reason}${a.byName ? ` · เพิ่มโดย ${a.byName}` : ""}`;
    if (a.kind === "earning") {
      lines.push({ key: `adj:${a.id}`, label: a.label, kind: "earning", amount: toBaht(amt), how, source: "adjustment", auto: false, refId: a.id });
      if (a.taxable) irregularEarn += amt;
      if (a.ssoBase) ssoExtra += amt;
    } else {
      lines.push({ key: `adj:${a.id}`, label: a.label, kind: "deduction", amount: toBaht(amt), how, source: "adjustment", auto: false, refId: a.id });
    }
  }

  /* ── ประกันสังคม ── */
  const ssoWage = Math.max(0, salary - wageCut + ssoExtra);
  const p = input.sso;
  const ssoOf = (ratePct: number) => {
    if (ssoWage <= 0) return 0;
    const base = Math.min(Math.max(ssoWage, s(p.wageFloor)), s(p.wageCeiling));
    return Math.min(roundSatangToBaht(Math.round((base * ratePct) / 100)), s(p.maxContribution));
  };
  const ssoComputed = input.profile.ssoExempt ? 0 : ssoOf(p.employeeRate);
  const ssoEmployer = input.profile.ssoExempt ? 0 : ssoOf(p.employerRate);
  const ssoBaseShown = Math.min(Math.max(ssoWage, s(p.wageFloor)), s(p.wageCeiling));
  const ssoHowAuto = input.profile.ssoExempt
    ? `ไม่หัก — ${input.profile.ssoExemptReason || "ตั้งไว้ที่ข้อมูลพนักงาน"}`
    : ssoWage <= 0
      ? "ไม่มีค่าจ้างงวดนี้"
      : ssoWage > s(p.wageCeiling)
        ? `${p.employeeRate}% ของ ${fmt(s(p.wageCeiling))} (ค่าจ้างเกินเพดาน ใช้เพดาน)`
        : ssoWage < s(p.wageFloor)
          ? `${p.employeeRate}% ของ ${fmt(s(p.wageFloor))} (ค่าจ้างต่ำกว่าขั้นต่ำ ใช้ขั้นต่ำ)`
          : `${p.employeeRate}% ของค่าจ้าง ${fmt(ssoBaseShown)}`;
  let ssoEmployee = ssoComputed;
  let ssoHow = ssoHowAuto;
  if (input.overrides.sso) {
    ssoEmployee = Math.max(0, s(input.overrides.sso.amount));
    ssoHow = `ปรับโดย ${input.overrides.sso.byName}: ${input.overrides.sso.reason} (ระบบคิดได้ ${fmt(ssoComputed)})`;
  }
  lines.push({ key: "sso", label: "ประกันสังคม", kind: "deduction", amount: toBaht(ssoEmployee), how: ssoHow, source: "sso", auto: !input.overrides.sso });

  /* ── ภาษีหัก ณ ที่จ่าย ── */
  const regular = Math.max(0, salary - wageCut + regularEarn);
  const taxable = regular + irregularEarn;
  const R = periodsRemaining(input.period.payDate);
  const extra = s(input.profile.extraAllowance);
  const ytdTaxable = s(input.ytd.taxable);
  const ytdTax = s(input.ytd.tax);
  const gap = Math.max(0, Math.floor(input.ytd.gapPeriods ?? 0));
  const annualRegular = ytdTaxable + regular * (R + gap);
  const annualSso = s(input.ytd.sso) + ssoEmployee * (R + gap);
  const base = annualTax(annualRegular, annualSso, extra, input.tax);
  const withIrr = annualTax(annualRegular + irregularEarn, annualSso, extra, input.tax);
  // งวดที่ไม่มีข้อมูล: ถือว่าหักไปแล้วเฉลี่ยเท่า ๆ กันทุกงวด (วิธีเฉลี่ยทั้งปีของสรรพากร) — งวดที่เหลือรับเฉพาะส่วนของตัวเอง
  const spread = gap + R + Math.max(0, input.ytd.periods ?? 0);
  const assumedGapTax = gap > 0 ? (base.tax * gap) / spread : 0;
  const regularPart = Math.max(0, base.tax - ytdTax - assumedGapTax) / R;
  if (gap > 0) {
    const pm = Number(input.period.payDate.slice(5, 7));
    // งวดที่ขาดคือช่วงต้นปี ก่อนงวดที่จ่ายผ่านระบบแล้ว (เริ่มใช้ระบบกลางปี)
    const done = Math.max(0, input.ytd.periods ?? 0);
    const last = Math.max(0, pm - 2 - done);
    const first = Math.max(0, last - gap + 1);
    const months = first === last ? TH_MONTH[last] : `${TH_MONTH[first]}–${TH_MONTH[last]}`;
    warnings.push(`ยังไม่มียอดยกมา ${months} — ภาษีใช้ค่าประมาณ (ใส่ได้ที่ข้อมูลพนักงาน)`);
  }
  const irregularPart = withIrr.tax - base.tax;
  const taxComputed = Math.max(0, Math.round(regularPart + irregularPart));
  let tax = taxComputed;
  let taxHow: string;
  const breakdown = annualBreakdown(annualRegular + irregularEarn, annualSso, extra, input.tax);
  const incomeAll = annualRegular + irregularEarn;
  const taxBreak: TaxBreak = {
    regular: toBaht(regular),
    regularPeriods: R + gap,
    ytdIncome: toBaht(ytdTaxable),
    irregular: toBaht(irregularEarn),
    income: toBaht(incomeAll),
    expense: toBaht(Math.min(Math.round((incomeAll * input.tax.expenseRate) / 100), s(input.tax.expenseCap))),
    personal: input.tax.personalAllowance,
    sso: toBaht(annualSso),
    extra: toBaht(extra),
    net: toBaht(withIrr.net),
    annualTax: toBaht(withIrr.tax),
    withheld: toBaht(ytdTax),
    assumedGap: toBaht(Math.round(assumedGapTax)),
    gap,
    periodsLeft: R,
    spread,
    regularPart: toBaht(Math.round(regularPart)),
    irregularPart: toBaht(Math.round(irregularPart)),
    computed: toBaht(taxComputed),
    brackets: input.tax.brackets,
  };
  if (taxComputed === 0) {
    taxHow = base.tax <= ytdTax && ytdTax > 0
      ? `หักไว้ครบตามที่ประมาณทั้งปีแล้ว (${breakdown} · ภาษีทั้งปี ${fmt(withIrr.tax)} หักไปแล้ว ${fmt(ytdTax)})`
      : `${breakdown} — ไม่ถึง ${fmt(toSatang(input.tax.brackets[0]?.upTo ?? 150000))} ยังไม่ต้องเสียภาษี`;
  } else {
    const parts = [
      gap > 0
        ? `ภาษีทั้งปีประมาณ ${fmt(base.tax)} (คิดจากเงินเดือนปัจจุบัน ${gap + R} งวด) ÷ ${spread} งวด`
        : `ภาษีทั้งปีประมาณ ${fmt(base.tax)}${ytdTax > 0 ? ` − หักไปแล้ว ${fmt(ytdTax)}` : ""} ÷ ${R} งวดที่เหลือ`,
    ];
    if (irregularPart > 0) parts.push(`+ ภาษีของเงินได้ไม่ประจำงวดนี้ (OT/โบนัส) ${fmt(Math.round(irregularPart))}`);
    taxHow = `${breakdown} → ${parts.join(" ")}`;
  }
  if (input.profile.taxMode === "none") {
    tax = 0;
    taxHow = `ไม่หัก — ${input.profile.taxNoneReason || "ตั้งไว้ที่ข้อมูลพนักงาน"} (ระบบคิดได้ ${fmt(taxComputed)})`;
  } else if (input.profile.taxMode === "fixed") {
    tax = Math.max(0, s(input.profile.taxFixedAmount));
    taxHow = `หักคงที่ตามที่ตั้งไว้ (ระบบคิดได้ ${fmt(taxComputed)})`;
    if (Math.abs(tax - taxComputed) > Math.max(10000, taxComputed * 0.2)) {
      warnings.push(`ภาษีหักคงที่ ${fmt(tax)} ต่างจากที่ระบบคิด ${fmt(taxComputed)} มาก — ตรวจว่ายังถูกต้อง`);
    }
  }
  if (input.overrides.tax) {
    tax = Math.max(0, s(input.overrides.tax.amount));
    taxHow = `ปรับโดย ${input.overrides.tax.byName}: ${input.overrides.tax.reason} (ระบบคิดได้ ${fmt(taxComputed)})`;
  }
  lines.push({ key: "tax", label: "ภาษีหัก ณ ที่จ่าย", kind: "deduction", amount: toBaht(tax), how: taxHow, source: "tax", auto: !input.overrides.tax && input.profile.taxMode === "auto" });

  /* ── หักคืนเงินเบิกล่วงหน้า ── */
  for (const a of input.advances) {
    const amt = s(a.amount);
    if (amt <= 0) continue;
    lines.push({ key: `adv:${a.refId}`, label: a.label, kind: "deduction", amount: toBaht(amt), how: a.detail, source: "advance", auto: true, refId: a.refId });
  }

  lines.push({
    key: "sso_employer",
    label: "ประกันสังคม ส่วนบริษัทสมทบ",
    kind: "employer",
    amount: toBaht(ssoEmployer),
    how: input.profile.ssoExempt ? "ไม่หัก" : `${p.employerRate}% (บริษัทจ่ายเพิ่ม ไม่หักจากพนักงาน)`,
    source: "sso_employer",
    auto: true,
  });

  const sumOf = (kind: PayLine["kind"]) => lines.filter((l) => l.kind === kind).reduce((n, l) => n + s(l.amount), 0);
  const gross = sumOf("earning");
  const deductions = sumOf("deduction");
  const net = gross - deductions;
  if (net < 0) warnings.push(`ยอดสุทธิติดลบ ${fmt(net)} — รายการหักมากกว่าเงินได้ ต้องแก้ก่อนส่งอนุมัติ (เช่น เลื่อนหักเบิกล่วงหน้าบางส่วนไปงวดหน้า)`);

  return {
    lines,
    gross: toBaht(gross),
    deductions: toBaht(deductions),
    net: toBaht(net),
    ssoEmployee: toBaht(ssoEmployee),
    ssoEmployer: toBaht(ssoEmployer),
    tax: toBaht(tax),
    taxable: toBaht(taxable),
    ssoWage: toBaht(ssoWage),
    taxComputed: toBaht(taxComputed),
    ssoComputed: toBaht(ssoComputed),
    taxBreak,
    warnings,
  };
}
