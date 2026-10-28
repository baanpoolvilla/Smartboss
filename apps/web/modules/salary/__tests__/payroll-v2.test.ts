import { describe, expect, it } from "vitest";

import { formatExact, splitGradeTier, toCommissionMethod } from "@/modules/hr/lib/commission";
import { applyDiligencePartial, computePay, diligenceStep, leaveCountsAgainstDiligence, type ComputeInput } from "../lib/compute";
import { reportRow } from "../lib/report";
import type { LineInfo } from "../lib/run";
import { DEFAULT_SSO, DEFAULT_TAX, normalizeDiligenceSteps } from "../lib/types";

/** ข้อกำหนดปรับปรุงระบบเงินเดือน (HR 28/10/2569) — ตัวอย่างในเอกสารต้องได้ตัวเลขตรงทุกข้อ */

const W = { A: 1, B: 0.75, C: 0.5, D: 0.25, F: 0 };
const mk = (grades: string[]) => grades.map((g, i) => ({ userId: `u${String(i).padStart(2, "0")}`, name: `คน${i + 1}`, grade: g }));

describe("ค่าคอม Grade + Tier", () => {
  // ตัวอย่างเอกสาร: 10 คน A 4 · B 1 · C 4 · D 1 → คะแนนรวม 7 · ก้อน Grade 7,000
  const members = mk(["A", "A", "A", "A", "B", "C", "C", "C", "C", "D"]);
  const tiers = Object.fromEntries(members.map((m, i) => [m.userId, i === 0 ? 16 : 12]));

  it("แบ่ง 10,000 เป็น Grade 7,000 / Tier 3,000", () => {
    const r = splitGradeTier(1_000_000, 70, members, W, tiers);
    expect(r.gradePoolSatang).toBe(700_000);
    expect(r.tierPoolSatang).toBe(300_000);
    expect(r.totalGrade).toBe(7);
    expect(r.totalTier).toBe(124);
    expect(r.problems).toEqual([]);
  });

  it("ก้อน Grade: A 1,000 · B 750 · C 500 · D 250", () => {
    const r = splitGradeTier(1_000_000, 70, members, W, tiers);
    const g = (grade: string) => r.shares.find((s) => s.grade === grade)!.gradeExact;
    expect(g("A")).toBe(100_000);
    expect(g("B")).toBe(75_000);
    expect(g("C")).toBe(50_000);
    expect(g("D")).toBe(25_000);
  });

  it("ก้อน Tier: 16 × 3,000 ÷ 124 และ 12 × 3,000 ÷ 124 แบบไม่ปัด · รวมปัดขึ้นที่ทศนิยม 2 ตำแหน่ง", () => {
    const r = splitGradeTier(1_000_000, 70, members, W, tiers);
    const first = r.shares[0]!;
    const other = r.shares[1]!;
    expect(first.tierExact).toBeCloseTo((16 * 300_000) / 124, 9);
    expect(other.tierExact).toBeCloseTo((12 * 300_000) / 124, 9);
    expect(formatExact(first.tierExact)).toBe("387.0967741935");
    expect(formatExact(other.tierExact)).toBe("290.3225806452");
    // A + Tier 16 = 1,000 + 387.0967… → 1,387.10
    expect(first.totalSatang).toBe(138_710);
    // A + Tier 12 = 1,000 + 290.3225… → ปัดขึ้น 1,290.33
    expect(other.totalSatang).toBe(129_033);
    // ปัดขึ้นรายคน — ยอดรวมทุกคนไม่ต่ำกว่า 10,000 และเกินได้ไม่เกินคนละ 1 สตางค์
    const sum = r.shares.reduce((n, s) => n + s.totalSatang, 0);
    expect(sum - 1_000_000).toBeGreaterThanOrEqual(0);
    expect(sum - 1_000_000).toBeLessThanOrEqual(r.shares.length);
  });

  it("ยังไม่ใส่คะแนน Tier บางคน = ห้ามสรุป (บอกชื่อ)", () => {
    const partial = { ...tiers };
    delete partial.u03;
    const r = splitGradeTier(1_000_000, 70, members, W, partial);
    expect(r.missingTier).toEqual(["คน4"]);
    expect(r.problems.join()).toContain("ยังไม่ได้ใส่คะแนน Tier: คน4");
  });

  it("คะแนน Tier รวม 0 / คะแนน Grade รวม 0 = หารไม่ได้ ห้ามสรุป", () => {
    const zeroT = Object.fromEntries(members.map((m) => [m.userId, 0]));
    expect(splitGradeTier(1_000_000, 70, members, W, zeroT).problems.join()).toContain("คะแนน Tier รวมเป็น 0");
    const allF = mk(["F", "F"]);
    const t2 = { u00: 1, u01: 1 };
    expect(splitGradeTier(1_000_000, 70, allF, W, t2).problems.join()).toContain("คะแนน Grade รวมเป็น 0");
  });

  it("ปัดขึ้นที่ทศนิยม 2 ตำแหน่ง: 100.012 → 100.02 · ลงตัวพอดีไม่ปัดเพิ่ม", () => {
    // 100.012 บาท = 10,001.2 สตางค์ (ก้อน Grade คนเดียว 100% ของ 10,001.2 ไม่ได้ เพราะยอดรวมใส่ได้แค่สตางค์ — ใช้ 2 คนแบ่ง 200.024 แทน)
    expect(splitGradeTier(20_002, 100, mk(["A", "A"]), W, { u00: 1, u01: 1 }).shares[0]!.totalSatang).toBe(10_001); // 100.01 พอดี
    expect(splitGradeTier(20_003, 100, mk(["A", "A"]), W, { u00: 1, u01: 1 }).shares[0]!.totalSatang).toBe(10_002); // 100.015 → 100.02
    expect(splitGradeTier(10_001, 100, mk(["A", "A"]), W, { u00: 1, u01: 1 }).shares[0]!.totalSatang).toBe(5_001); // 50.005 → 50.01
    expect(splitGradeTier(10_000, 100, mk(["A", "A"]), W, { u00: 1, u01: 1 }).shares[0]!.totalSatang).toBe(5_000); // 50.00 พอดี
    expect(splitGradeTier(700_000, 100, mk(["A", "B", "C", "D", "A", "A", "A", "C", "C", "C"]), W, {}).shares[0]!.totalSatang).toBe(100_000); // 1,000 พอดี ไม่กลายเป็น 1,000.01
  });

  it("คะแนน Tier 0 รายคน = ไม่ได้ส่วน Tier แต่ยังได้ส่วน Grade", () => {
    const t = { ...tiers, u09: 0 };
    const r = splitGradeTier(1_000_000, 70, members, W, t);
    const d = r.shares.find((s) => s.userId === "u09")!;
    expect(d.tierExact).toBe(0);
    expect(d.totalSatang).toBe(25_000);
    expect(r.problems).toEqual([]);
  });

  it("สัดส่วน 100% Grade = Tier ไม่จำเป็นต้องใส่ก็ยังคิดได้เมื่อใส่ครบ", () => {
    const r = splitGradeTier(1_000_000, 100, members, W, tiers);
    expect(r.tierPoolSatang).toBe(0);
    expect(r.shares[0]!.totalSatang).toBe(Math.ceil(1_000_000 / 7)); // 1,428.5714… → ปัดขึ้น 1,428.58
  });

  it("วิธีใหม่อ่านจากฐานข้อมูลได้ · ค่าแปลก ๆ ยังเป็น pool (เดิม)", () => {
    expect(toCommissionMethod("grade_tier")).toBe("grade_tier");
    expect(toCommissionMethod("x")).toBe("pool");
  });
});

describe("เบี้ยขยันขั้นบันได 500 → 800 → 1,000", () => {
  const S = [500, 800, 1000];
  const ok = { leaveDays: 0, lateCount: 0, absentDays: 0 };
  const late = { leaveDays: 0, lateCount: 1, absentDays: 0 };

  it("ตัวอย่างเอกสาร: 500 → 800 → 1,000 → ลา/สาย 500 → ผ่าน 800", () => {
    const r1 = diligenceStep(S, null, "none", ok);
    const r2 = diligenceStep(S, r1.amount, "run", ok);
    const r3 = diligenceStep(S, r2.amount, "run", ok);
    const r4 = diligenceStep(S, r3.amount, "run", { leaveDays: 1, lateCount: 0, absentDays: 0 });
    const r5 = diligenceStep(S, r4.amount, "run", ok);
    expect([r1, r2, r3, r4, r5].map((r) => r.amount)).toEqual([500, 800, 1000, 500, 800]);
  });

  it("ถึง 1,000 แล้วผ่านต่อ = คง 1,000", () => {
    const r = diligenceStep(S, 1000, "run", ok);
    expect(r.amount).toBe(1000);
    expect(r.how).toContain("คงขั้นสูงสุด");
  });

  it("รอบแรกมีสาย = 500 · ลาครึ่งวันก็นับเป็นลา · ขาดงานก็ไม่ได้เลื่อน", () => {
    expect(diligenceStep(S, null, "none", late).amount).toBe(500);
    expect(diligenceStep(S, 800, "run", { leaveDays: 0.5, lateCount: 0, absentDays: 0 }).amount).toBe(500);
    expect(diligenceStep(S, 800, "run", { leaveDays: 0, lateCount: 0, absentDays: 1 }).amount).toBe(500);
  });

  it("ยกมาจากระบบเดิม 800 แล้วผ่าน = 1,000", () => {
    const r = diligenceStep(S, 800, "opening", ok);
    expect(r.amount).toBe(1000);
    expect(r.how).toContain("ยกมาจากระบบเดิม");
  });

  it("ตั้งค่าขั้นเปลี่ยน ยอดเก่าไม่ตรงขั้น = นับจากขั้นที่ไม่เกินยอดเก่า", () => {
    expect(diligenceStep([600, 900, 1200], 800, "run", ok).amount).toBe(900);
    expect(diligenceStep([600, 900, 1200], 300, "run", ok).amount).toBe(600);
  });

  it("ขั้นจากตั้งค่าต้องเรียงน้อยไปมาก เป็นบวก", () => {
    expect(normalizeDiligenceSteps([500, 800, 1000])).toEqual([500, 800, 1000]);
    expect(normalizeDiligenceSteps([800, 500])).toBeNull();
    expect(normalizeDiligenceSteps([0, 500])).toBeNull();
    expect(normalizeDiligenceSteps([])).toBeNull();
    expect(normalizeDiligenceSteps("500")).toBeNull();
  });
});

function base(over: Partial<ComputeInput> = {}): ComputeInput {
  return {
    period: { startsOn: "2026-09-26", endsOn: "2026-10-25", payDate: "2026-10-31" },
    salary: [{ monthly: 20000, from: "2026-09-26", to: "2026-10-25" }],
    unpaidLeaveDays: 0,
    late: { minutes: 0, count: 0 },
    absentDays: 0,
    ot: [],
    advances: [],
    recurring: [],
    adjustments: [],
    overrides: {},
    profile: { ssoExempt: false, ssoExemptReason: "", taxMode: "auto", taxFixedAmount: 0, taxNoneReason: "", extraAllowance: 0 },
    ytd: { taxable: 0, tax: 0, sso: 0 },
    settings: { deductLate: false, lateMode: "minute", latePerTime: 0, deductAbsent: false, deductUnpaidLeave: true, otSsoBase: true, taxEnabled: false },
    sso: DEFAULT_SSO,
    tax: DEFAULT_TAX,
    ...over,
  };
}

describe("คำนวณเงินเดือนตามสูตรใหม่", () => {
  it("ปิดภาษี = ไม่มีบรรทัดภาษี ภาษี 0 แม้เงินเดือนสูง", () => {
    const r = computePay(base({ salary: [{ monthly: 150000, from: "2026-09-26", to: "2026-10-25" }] }));
    expect(r.lines.some((l) => l.key === "tax")).toBe(false);
    expect(r.tax).toBe(0);
    expect(r.net).toBe(150000 - 875);
  });

  it("เปิดภาษี (ค่าเดิม) = ยังคิดภาษีเหมือนเดิม", () => {
    const r = computePay(base({ salary: [{ monthly: 150000, from: "2026-09-26", to: "2026-10-25" }], settings: { ...base().settings, taxEnabled: undefined } }));
    expect(r.lines.some((l) => l.key === "tax")).toBe(true);
    expect(r.tax).toBeGreaterThan(0);
  });

  it("สุทธิ = ฐาน + คอม + เบี้ยขยัน + OT + รายเพิ่ม − รายหัก − ประกันสังคม", () => {
    const r = computePay(
      base({
        commission: { amount: 1387.1, detail: "Grade + Tier", taxable: true, ssoBase: true, label: "ค่าคอม (Grade + Tier)" },
        diligence: diligenceStep([500, 800, 1000], 800, "run", { leaveDays: 0, lateCount: 0, absentDays: 0 }),
        ot: [{ refId: "ot-days", code: "OT-1", label: "ค่าล่วงเวลา (OT)", amount: 1334, minutes: 300, detail: "2 วัน × 667" }],
        adjustments: [
          { id: "a1", label: "ค่าเดินทาง", kind: "earning", amount: 300, taxable: true, ssoBase: false, reason: "ไปหน้างาน", byName: "HR" },
          { id: "a2", label: "ค่าเสียหาย", kind: "deduction", amount: 150, taxable: false, ssoBase: false, reason: "แก้วแตก", byName: "HR" },
        ],
      }),
    );
    // ประกันสังคมเต็มเพดาน 875
    expect(r.ssoEmployee).toBe(875);
    expect(r.net).toBe(20000 + 1387.1 + 1000 + 1334 + 300 - 150 - 875);
    expect(r.lines.find((l) => l.key === "diligence")!.amount).toBe(1000);
    expect(r.blocks).toEqual([]);
    // รายงานแยกคอลัมน์แล้วบวกลบกลับได้ยอดสุทธิเดิม
    const row = reportRow({ employmentId: "e", name: "ก", department: "", employeeCode: "", lines: r.lines, net: r.net, info: { monthlySalary: 20000 } as LineInfo });
    expect(row.check).toBe(true);
    expect(row.base).toBe(20000);
    expect(row.commission).toBe(1387.1);
    expect(row.diligence).toBe(1000);
    expect(row.ot).toBe(1334);
    expect(row.addTotal).toBe(300);
    expect(row.deductTotal).toBe(150);
    expect(row.sso).toBe(875);
  });

  it("ไม่ติ๊กหักประกันสังคม = 0", () => {
    const r = computePay(base({ profile: { ...base().profile, ssoExempt: true, ssoExemptReason: "กรรมการ" } }));
    expect(r.ssoEmployee).toBe(0);
    expect(r.net).toBe(20000);
  });

  it("เบี้ยขยันไม่นับเป็นค่าจ้างคิดประกันสังคม", () => {
    const low = base({ salary: [{ monthly: 10000, from: "2026-09-26", to: "2026-10-25" }] });
    const a = computePay(low);
    const b = computePay({ ...low, diligence: diligenceStep([500, 800, 1000], null, "none", { leaveDays: 0, lateCount: 0, absentDays: 0 }) });
    expect(b.ssoEmployee).toBe(a.ssoEmployee);
    expect(b.net).toBe(a.net + 500);
  });

  it("ข้อมูลค่าคอมไม่ครบ = ไม่ใส่ยอด + ห้ามส่ง · HR ปรับยอดเองพร้อมเหตุผล = ส่งได้", () => {
    const block = "ค่าคอม ต.ค. 2569: ยังไม่ได้ใส่คะแนน Tier: คน4";
    const r = computePay(base({ commission: { amount: 0, detail: "", taxable: true, ssoBase: true, block } }));
    expect(r.blocks).toEqual([block]);
    expect(r.lines.some((l) => l.source === "commission")).toBe(false);
    const fixed = computePay(base({ commission: { amount: 0, detail: "", taxable: true, ssoBase: true, block }, overrides: { commission: { amount: 1200, reason: "ตกลงกันแล้ว", byName: "HR" } } }));
    expect(fixed.blocks).toEqual([]);
    expect(fixed.lines.find((l) => l.source === "commission")!.amount).toBe(1200);
  });
});

describe("เบี้ยขยัน: เข้างาน/ลาออกกลางรอบ + HR ปรับยอดเอง", () => {
  const S = [500, 800, 1000];
  const ok = { leaveDays: 0, lateCount: 0, absentDays: 0 };

  it("ทำงานครบรอบ = ไม่เปลี่ยนอะไร", () => {
    const r = diligenceStep(S, 800, "run", ok);
    expect(applyDiligencePartial(r, "none", 30, 30)).toBe(r);
  });

  it("ต้องครบรอบ (ค่าตั้งต้น): ทำงาน 21/31 วัน = 0 พร้อมเหตุผล · รอบถัดไปที่ครบเริ่ม 500", () => {
    const r = applyDiligencePartial(diligenceStep(S, 800, "run", ok), "none", 21, 31);
    expect(r.amount).toBe(0);
    expect(r.how).toContain("ทำงานไม่ครบรอบ (21/31 วัน)");
    expect(diligenceStep(S, r.amount, "run", ok).amount).toBe(500);
  });

  it("เฉลี่ยตามวัน: 1,000 × 21 ÷ 31 = 677.42 · ได้เต็มขั้น = 1,000", () => {
    const base = diligenceStep(S, 800, "run", ok);
    expect(applyDiligencePartial(base, "prorate", 21, 31).amount).toBe(677.42);
    expect(applyDiligencePartial(base, "full", 21, 31).amount).toBe(1000);
  });

  it("ไม่ครบรอบแล้วได้ 0 ยังขึ้นบรรทัดในสลิป (ไม่หายเงียบ)", () => {
    const d = applyDiligencePartial(diligenceStep(S, 800, "run", ok), "none", 10, 31);
    const r = computePay(base({ diligence: d }));
    const line = r.lines.find((l) => l.key === "diligence")!;
    expect(line.amount).toBe(0);
    expect(line.how).toContain("ไม่ครบรอบ");
  });

  it("HR ปรับยอดเอง: ใช้ยอดที่ปรับ + บอกยอดที่ระบบคิด", () => {
    const r = computePay(base({ diligence: diligenceStep(S, null, "none", ok), overrides: { diligence: { amount: 800, reason: "ทำงานดีพิเศษ", byName: "HR" } } }));
    const line = r.lines.find((l) => l.key === "diligence")!;
    expect(line.amount).toBe(800);
    expect(line.how).toContain("ระบบคิดได้ 500.00");
    expect(r.net).toBe(20000 + 800 - 875);
  });
});

describe("ลาแบบไหนตัดเบี้ยขยัน", () => {
  const t = (name: string, autoApprove = false, requiresReports = false, displayLabel: string | null = null) => leaveCountsAgainstDiligence({ name, displayLabel, autoApprove, requiresReports });
  it("ตัด: ลากิจ ลาป่วย ลาไม่รับค่าจ้าง", () => {
    expect(t("ลากิจ")).toBe(true);
    expect(t("ลาป่วย")).toBe(true);
    expect(t("ลาไม่รับค่าจ้าง")).toBe(true);
  });
  it("ไม่ตัด: Day-Off (อนุมัติอัตโนมัติ) · Holiday · นักขัตฤกษ์ · ลาพักร้อน · Work from home", () => {
    expect(t("Day-Off", true)).toBe(false);
    expect(t("Holiday")).toBe(false);
    expect(t("วันหยุดนักขัตฤกษ์")).toBe(false);
    expect(t("ลาพักร้อน")).toBe(false);
    expect(t("Annual leave")).toBe(false);
    expect(t("Work From Home", false, true)).toBe(false);
    expect(t("หยุด", false, false, "สมชาย - Holiday")).toBe(false);
  });
});
