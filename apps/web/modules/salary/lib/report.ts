/**
 * รายงานเงินเดือนรายคน (ข้อกำหนด HR 28/10/2569) — แยกบรรทัดของรอบออกเป็นคอลัมน์ตามสูตร
 *   สุทธิ = ฐานเงินเดือน + ค่าคอม Grade + ค่าคอม Tier + เบี้ยขยัน + OT + รายเพิ่ม − รายหัก − ประกันสังคม (− ภาษี ถ้าเปิด)
 * ไม่คิดเงินใหม่ — อ่านจากบรรทัดที่คำนวณแล้วเท่านั้น และตรวจว่าแยกแล้วบวกลบกลับได้ยอดสุทธิเดิม (check)
 * ใช้ทั้งหน้ารายงานและไฟล์ Excel (ล้วน ไม่มี I/O)
 */
import type { PayLine } from "./compute";
import type { LineInfo } from "./run";
import { toSatang } from "./types";

export interface ReportItem {
  label: string;
  detail: string;
  amount: number;
}

export interface ReportRow {
  employmentId: string;
  name: string;
  department: string;
  employeeCode: string;
  /** เงินเดือนเต็มเดือน (อัตรา) */
  monthlySalary: number;
  /** เงินเดือนงวดนี้ (หลังแบ่งวันเข้า/ออก) */
  base: number;
  grade: string | null;
  gradeScore: number | null;
  tier: number | null;
  /** ส่วน Grade/Tier แบบไม่ปัด (บาท) — null = ไม่ใช่วิธี Grade + Tier */
  commGradeExact: number | null;
  commTierExact: number | null;
  /** ค่าคอมที่จ่ายจริง (ปัดขึ้นเป็นสตางค์ / หรือที่ HR ปรับ) */
  commission: number;
  commissionNote: string;
  diligence: number;
  diligenceStep: string;
  otDays: number | null;
  otRate: number | null;
  ot: number;
  otNote: string;
  adds: ReportItem[];
  addTotal: number;
  deducts: ReportItem[];
  deductTotal: number;
  sso: number;
  ssoNote: string;
  tax: number;
  net: number;
  /** แยกคอลัมน์แล้วบวกลบกลับได้ยอดสุทธิเดิมไหม (สตางค์) */
  check: boolean;
}

export interface ReportLine {
  employmentId: string;
  name: string;
  department: string;
  employeeCode: string;
  lines: PayLine[];
  net: number;
  info: LineInfo;
}

const sum = (xs: { amount: number }[]) => xs.reduce((n, x) => n + toSatang(x.amount), 0) / 100;

export function reportRow(l: ReportLine): ReportRow {
  const by = (pred: (x: PayLine) => boolean) => l.lines.filter(pred);
  const salary = by((x) => x.source === "salary");
  const comm = by((x) => x.source === "commission");
  const dil = by((x) => x.source === "diligence");
  const ot = by((x) => x.source === "ot");
  const sso = by((x) => x.key === "sso");
  const tax = by((x) => x.key === "tax");
  const addLines = by((x) => x.kind === "earning" && !["salary", "commission", "diligence", "ot"].includes(x.source));
  const dedLines = by((x) => x.kind === "deduction" && x.key !== "sso" && x.key !== "tax");
  const parts = l.info?.commissionParts;
  const d = l.info?.diligence;
  const od = l.info?.otDaysPay;
  const base = sum(salary);
  const commission = sum(comm);
  const diligence = sum(dil);
  const otAmt = sum(ot);
  const addTotal = sum(addLines);
  const deductTotal = sum(dedLines);
  const ssoAmt = sum(sso);
  const taxAmt = sum(tax);
  const back = toSatang(base) + toSatang(commission) + toSatang(diligence) + toSatang(otAmt) + toSatang(addTotal) - toSatang(deductTotal) - toSatang(ssoAmt) - toSatang(taxAmt);
  return {
    employmentId: l.employmentId,
    name: l.name,
    department: l.department,
    employeeCode: l.employeeCode,
    monthlySalary: l.info?.monthlySalary ?? base,
    base,
    grade: parts?.grade ?? null,
    gradeScore: parts?.gradeScore ?? null,
    tier: parts ? parts.tier : null,
    commGradeExact: parts ? parts.gradeExact / 100 : null,
    commTierExact: parts ? parts.tierExact / 100 : null,
    commission,
    commissionNote: comm[0]?.how ?? (l.info?.overrides?.commission ? `ปรับเป็น 0 · ${l.info.overrides.commission.reason}` : ""),
    diligence,
    diligenceStep: !d ? "" : l.info?.overrides?.diligence ? "ปรับเอง" : d.partial && d.partial.mode !== "full" ? `ไม่ครบรอบ ${d.partial.workedDays}/${d.partial.periodDays} วัน` : d.passed ? `ขั้น ${d.step}/${d.steps}` : "ไม่ได้ · ลา/สาย/ขาด",
    otDays: od ? od.days : null,
    otRate: od ? od.rate : null,
    ot: otAmt,
    otNote: ot.map((x) => x.how).join(" · "),
    adds: addLines.map((x) => ({ label: x.label, detail: x.how, amount: x.amount })),
    addTotal,
    deducts: dedLines.map((x) => ({ label: x.label, detail: x.how, amount: x.amount })),
    deductTotal,
    sso: ssoAmt,
    ssoNote: sso[0]?.how ?? "",
    tax: taxAmt,
    net: l.net,
    check: back === toSatang(l.net),
  };
}

/** ตัวเลขไม่ปัด → ข้อความ (สูงสุด 10 ตำแหน่ง ตัดศูนย์ท้าย อย่างน้อย 2 ตำแหน่ง) */
export function exactText(baht: number): string {
  const fixed = baht.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  const [int, frac = ""] = fixed.split(".");
  return `${Number(int).toLocaleString("en-US")}.${frac.padEnd(2, "0")}`;
}
