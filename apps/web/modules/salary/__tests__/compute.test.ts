import { describe, expect, it } from "vitest";

import { annualTax, computePay, periodsEmployedBefore, periodsRemaining, progressiveTax, type ComputeInput } from "../lib/compute";
import { DEFAULT_SSO, DEFAULT_TAX, fmt, normalizeAllowances, periodDates, roundSatangToBaht, toSatang, validateTax } from "../lib/types";

/** พนักงานเต็มงวด ต.ค. 2569 (26 ก.ย.–25 ต.ค. จ่าย 31 ต.ค.) ไม่มีอะไรพิเศษ — แต่ละเทสแก้เฉพาะที่ต้องการ */
function base(over: Partial<ComputeInput> = {}): ComputeInput {
  return {
    period: { startsOn: "2026-09-26", endsOn: "2026-10-25", payDate: "2026-10-31" },
    salary: [{ monthly: 18000, from: "2026-09-26", to: "2026-10-25" }],
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
    settings: { deductLate: false, lateMode: "minute", latePerTime: 0, deductAbsent: false, deductUnpaidLeave: true, otSsoBase: true },
    sso: DEFAULT_SSO,
    tax: DEFAULT_TAX,
    ...over,
  };
}
const line = (r: ReturnType<typeof computePay>, key: string) => r.lines.find((l) => l.key === key);

describe("periods", () => {
  it("cut-off 25 → 26th of last month to 25th, paid month end", () => {
    expect(periodDates("2026-10", 25, 0)).toEqual({ startsOn: "2026-09-26", endsOn: "2026-10-25", payDate: "2026-10-31" });
    expect(periodDates("2026-01", 25, 0)).toEqual({ startsOn: "2025-12-26", endsOn: "2026-01-25", payDate: "2026-01-31" });
    expect(periodDates("2026-02", 25, 28)).toEqual({ startsOn: "2026-01-26", endsOn: "2026-02-25", payDate: "2026-02-28" });
  });
  it("cut-off 31 = calendar month, Feb clamps", () => {
    expect(periodDates("2026-02", 31, 0)).toEqual({ startsOn: "2026-02-01", endsOn: "2026-02-28", payDate: "2026-02-28" });
    expect(periodDates("2026-03", 31, 5)).toEqual({ startsOn: "2026-03-01", endsOn: "2026-03-31", payDate: "2026-03-05" });
  });
  it("periods remaining counts this pay month", () => {
    expect(periodsRemaining("2026-10-31")).toBe(3);
    expect(periodsRemaining("2026-12-31")).toBe(1);
    expect(periodsRemaining("2027-01-05")).toBe(12);
  });
});

describe("money helpers", () => {
  it("satang conversion survives float noise", () => {
    expect(toSatang(1.005)).toBe(101);
    expect(toSatang(0.1 + 0.2)).toBe(30);
    expect(fmt(1781250)).toBe("17,812.50");
    expect(fmt(-50)).toBe("-0.50");
  });
  it("SSO rounding: 50 satang and up goes up", () => {
    expect(roundSatangToBaht(79218)).toBe(79200);
    expect(roundSatangToBaht(79250)).toBe(79300);
    expect(roundSatangToBaht(79249)).toBe(79200);
  });
  it("tax brackets", () => {
    expect(progressiveTax(toSatang(150000), DEFAULT_TAX.brackets)).toBe(0);
    expect(progressiveTax(toSatang(369500), DEFAULT_TAX.brackets)).toBe(toSatang(14450));
    expect(progressiveTax(toSatang(1000000), DEFAULT_TAX.brackets)).toBe(toSatang(115000));
    expect(progressiveTax(toSatang(6000000), DEFAULT_TAX.brackets)).toBe(toSatang(115000 + 250000 + 900000 + 350000));
  });
  it("annual tax: expense 50% capped at 100,000, personal 60,000, SSO", () => {
    expect(annualTax(toSatang(540000), toSatang(10500), 0, DEFAULT_TAX)).toEqual({ tax: toSatang(14450), net: toSatang(369500) });
    expect(annualTax(toSatang(100000), 0, 0, DEFAULT_TAX).net).toBe(0);
  });
  it("tax settings validation catches broken brackets", () => {
    expect(validateTax(DEFAULT_TAX)).toBeNull();
    expect(validateTax({ ...DEFAULT_TAX, brackets: [{ upTo: 100, rate: 0 }, { upTo: 50, rate: 5 }, { upTo: null, rate: 10 }] })).toMatch(/มากกว่าขั้นก่อนหน้า/);
    expect(validateTax({ ...DEFAULT_TAX, brackets: [{ upTo: 100, rate: 0 }] })).toMatch(/เกินจากนั้น/);
  });
});

describe("salary", () => {
  it("full period = full monthly salary", () => {
    const r = computePay(base());
    expect(line(r, "salary")?.amount).toBe(18000);
    expect(line(r, "salary")?.how).toMatch(/เต็มเดือน/);
  });
  it("hired mid-period: ÷ 30 × days worked", () => {
    const r = computePay(base({ salary: [{ monthly: 18000, from: "2026-10-15", to: "2026-10-25" }] }));
    expect(line(r, "salary")?.amount).toBe(6600);
    expect(line(r, "salary")?.how).toMatch(/ทำงาน 11 จาก 30 วัน/);
  });
  it("left mid-period after 30 days of a 31-day period never pays more than a month", () => {
    const r = computePay(
      base({ period: { startsOn: "2026-07-26", endsOn: "2026-08-25", payDate: "2026-08-31" }, salary: [{ monthly: 18000, from: "2026-07-26", to: "2026-08-24" }] }),
    );
    expect(line(r, "salary")?.amount).toBe(18000);
  });
  it("raise mid-period: weighted by days, between old and new", () => {
    const r = computePay(
      base({
        salary: [
          { monthly: 42000, from: "2026-09-26", to: "2026-09-30" },
          { monthly: 45000, from: "2026-10-01", to: "2026-10-25" },
        ],
      }),
    );
    expect(line(r, "salary")?.amount).toBe(44500);
  });
  it("no salary → no salary line, warning", () => {
    const r = computePay(base({ salary: [] }));
    expect(line(r, "salary")).toBeUndefined();
    expect(r.warnings.join()).toMatch(/ยังไม่มีเงินเดือน/);
    expect(r.net).toBe(0);
  });
  it("unpaid leave: monthly ÷ 30 per day, reduces SSO wage", () => {
    const r = computePay(base({ unpaidLeaveDays: 2 }));
    expect(line(r, "unpaid_leave")?.amount).toBe(1200);
    expect(r.ssoWage).toBe(16800);
    expect(r.ssoEmployee).toBe(840);
  });
  it("half-day unpaid leave", () => {
    expect(line(computePay(base({ unpaidLeaveDays: 0.5 })), "unpaid_leave")?.amount).toBe(300);
  });
  it("unpaid leave switched off in settings → not deducted", () => {
    const r = computePay(base({ unpaidLeaveDays: 2, settings: { ...base().settings, deductUnpaidLeave: false } }));
    expect(line(r, "unpaid_leave")).toBeUndefined();
  });
  it("deductions from salary never exceed the salary", () => {
    const r = computePay(base({ unpaidLeaveDays: 40 }));
    expect(line(r, "unpaid_leave")?.amount).toBe(18000);
    expect(r.net).toBeGreaterThanOrEqual(0);
  });
  it("late per minute and per time (only when switched on)", () => {
    expect(line(computePay(base({ late: { minutes: 90, count: 3 } })), "late")).toBeUndefined();
    const perMin = computePay(base({ late: { minutes: 90, count: 3 }, settings: { ...base().settings, deductLate: true } }));
    expect(line(perMin, "late")?.amount).toBe(112.5);
    const perTime = computePay(base({ late: { minutes: 90, count: 3 }, settings: { ...base().settings, deductLate: true, lateMode: "per_time", latePerTime: 50 } }));
    expect(line(perTime, "late")?.amount).toBe(150);
  });
});

describe("social security", () => {
  it("over the ceiling → 5% of 17,500 = 875", () => {
    const r = computePay(base({ salary: [{ monthly: 45000, from: "2026-09-26", to: "2026-10-25" }] }));
    expect(r.ssoEmployee).toBe(875);
    expect(r.ssoEmployer).toBe(875);
    expect(line(r, "sso")?.how).toMatch(/เพดาน/);
  });
  it("OT counts as wage when the setting says so", () => {
    const ot = [{ refId: "r1", code: "REQ-1", label: "ค่าล่วงเวลา", amount: 843.75, minutes: 540, detail: "9 ชม." }];
    const salary = [{ monthly: 15000, from: "2026-09-26", to: "2026-10-25" }];
    expect(computePay(base({ salary, ot })).ssoEmployee).toBe(792);
    expect(computePay(base({ salary, ot, settings: { ...base().settings, otSsoBase: false } })).ssoEmployee).toBe(750);
  });
  it("rounds .50 up", () => {
    const r = computePay(base({ salary: [{ monthly: 15850, from: "2026-09-26", to: "2026-10-25" }] }));
    expect(r.ssoEmployee).toBe(793);
  });
  it("below the floor uses the floor (1,650)", () => {
    const r = computePay(base({ salary: [{ monthly: 9000, from: "2026-10-23", to: "2026-10-25" }] }));
    expect(line(r, "salary")?.amount).toBe(900);
    expect(r.ssoEmployee).toBe(83);
  });
  it("exempt person: nothing for either side, reason shown", () => {
    const r = computePay(base({ profile: { ...base().profile, ssoExempt: true, ssoExemptReason: "อายุเกิน 60 ปีตอนเริ่มงาน" } }));
    expect(r.ssoEmployee).toBe(0);
    expect(r.ssoEmployer).toBe(0);
    expect(line(r, "sso")?.how).toMatch(/อายุเกิน 60/);
  });
  it("ceiling/rates come from settings, not code", () => {
    const r = computePay(base({ salary: [{ monthly: 45000, from: "2026-09-26", to: "2026-10-25" }], sso: { ...DEFAULT_SSO, wageCeiling: 20000, maxContribution: 1000 } }));
    expect(r.ssoEmployee).toBe(1000);
  });
});

describe("withholding tax", () => {
  it("low earner → 0 with a plain explanation", () => {
    const r = computePay(base({ ytd: { taxable: 18000 * 9, tax: 0, sso: 875 * 9 } }));
    expect(r.tax).toBe(0);
    expect(line(r, "tax")?.how).toMatch(/เงินได้ทั้งปีประมาณ 216,000.00 − ค่าใช้จ่าย 100,000.00 − ลดหย่อนส่วนตัว 60,000.00 − ประกันสังคม 10,500.00 = เงินได้สุทธิ 45,500.00 — ไม่ถึง 150,000.00 ยังไม่ต้องเสียภาษี/);
  });
  it("annualised and spread over the remaining periods", () => {
    const r = computePay(base({ salary: [{ monthly: 45000, from: "2026-09-26", to: "2026-10-25" }], ytd: { taxable: 405000, tax: 10837.5, sso: 7875 } }));
    expect(r.tax).toBe(1204.17);
    expect(line(r, "tax")?.how).toMatch(/÷ 3 งวดที่เหลือ/);
  });
  it("one-off bonus is taxed once in the month paid, not multiplied by the year", () => {
    const bonus = [{ id: "a1", label: "โบนัส", kind: "earning" as const, amount: 50000, taxable: true, ssoBase: false, reason: "โบนัสปลายปี", byName: "HR" }];
    const r = computePay(base({ salary: [{ monthly: 25000, from: "2026-09-26", to: "2026-10-25" }], adjustments: bonus, ytd: { taxable: 225000, tax: 0, sso: 7875 } }));
    // ทั้งปีไม่รวมโบนัส 300,000 → สุทธิ 129,500 ภาษี 0 · รวมโบนัส 350,000 → สุทธิ 179,500 ภาษี 1,475
    expect(r.tax).toBe(1475);
    expect(line(r, "tax")?.how).toMatch(/ไม่ประจำ/);
  });
  it("December settles the year exactly", () => {
    const r = computePay(
      base({
        period: { startsOn: "2026-11-26", endsOn: "2026-12-25", payDate: "2026-12-31" },
        salary: [{ monthly: 45000, from: "2026-11-26", to: "2026-12-25" }],
        ytd: { taxable: 495000, tax: 13000, sso: 9625 },
      }),
    );
    expect(r.tax).toBe(1450);
  });
  it("already over-withheld → 0 this period, never negative", () => {
    const r = computePay(base({ salary: [{ monthly: 45000, from: "2026-09-26", to: "2026-10-25" }], ytd: { taxable: 405000, tax: 20000, sso: 7875 } }));
    expect(r.tax).toBe(0);
    expect(line(r, "tax")?.how).toMatch(/ครบ/);
  });
  it("previous employer income counts (passed in ytd)", () => {
    const a = computePay(base({ salary: [{ monthly: 45000, from: "2026-09-26", to: "2026-10-25" }] }));
    const b = computePay(base({ salary: [{ monthly: 45000, from: "2026-09-26", to: "2026-10-25" }], ytd: { taxable: 300000, tax: 0, sso: 0 } }));
    expect(b.tax).toBeGreaterThan(a.tax);
  });
  it("extra allowances lower the tax", () => {
    const a = computePay(base({ salary: [{ monthly: 45000, from: "2026-09-26", to: "2026-10-25" }], ytd: { taxable: 405000, tax: 10837.5, sso: 7875 } }));
    const b = computePay(base({ salary: [{ monthly: 45000, from: "2026-09-26", to: "2026-10-25" }], ytd: { taxable: 405000, tax: 10837.5, sso: 7875 }, profile: { ...base().profile, extraAllowance: 30000 } }));
    expect(b.tax).toBeLessThan(a.tax);
  });
  it("fixed and none modes still show what the system computed", () => {
    const sal = [{ monthly: 45000, from: "2026-09-26", to: "2026-10-25" }];
    const fixed = computePay(base({ salary: sal, profile: { ...base().profile, taxMode: "fixed", taxFixedAmount: 1000 } }));
    expect(fixed.tax).toBe(1000);
    expect(line(fixed, "tax")?.how).toMatch(/ระบบคิดได้/);
    const none = computePay(base({ salary: sal, profile: { ...base().profile, taxMode: "none", taxNoneReason: "ยื่นเอง" } }));
    expect(none.tax).toBe(0);
    expect(line(none, "tax")?.how).toMatch(/ยื่นเอง/);
  });
  it("HR override replaces the amount and keeps the reason", () => {
    const r = computePay(base({ overrides: { tax: { amount: 500, reason: "พนักงานขอหักเพิ่ม", byName: "วิภา" } } }));
    expect(r.tax).toBe(500);
    expect(line(r, "tax")?.how).toMatch(/วิภา.*ขอหักเพิ่ม/);
  });
});

describe("totals", () => {
  it("mock-up example: สมชาย", () => {
    const r = computePay(
      base({
        ot: [{ refId: "o1", code: "REQ-1", label: "ค่าล่วงเวลา", amount: 1687.5, minutes: 900, detail: "15 ชม." }],
        recurring: [{ refId: "i1", name: "ค่าตำแหน่ง", kind: "earning", amount: 1000, taxable: true, ssoBase: false }],
        advances: [{ refId: "a1", code: "RQ-0115", label: "หักคืนเงินเบิกล่วงหน้า", amount: 2000, detail: "เบิก 8 ต.ค." }],
        ytd: { taxable: 19000 * 9, tax: 0, sso: 875 * 9 },
      }),
    );
    expect(r.gross).toBe(20687.5);
    expect(r.ssoEmployee).toBe(875);
    expect(r.tax).toBe(0);
    expect(r.deductions).toBe(2875);
    expect(r.net).toBe(17812.5);
  });
  it("negative net is flagged, never hidden", () => {
    const r = computePay(base({ salary: [{ monthly: 10000, from: "2026-09-26", to: "2026-10-25" }], advances: [{ refId: "a", code: "RQ", label: "เบิก", amount: 12000, detail: "" }] }));
    expect(r.net).toBeLessThan(0);
    expect(r.warnings.join()).toMatch(/ติดลบ/);
  });
  it("gross − deductions = net to the satang for awkward amounts", () => {
    const amounts = [0.01, 333.33, 1234.565, 99999.99, 0.5, 12.34];
    for (let i = 0; i < 50; i++) {
      const pick = (k: number) => amounts[(i * 7 + k * 3) % amounts.length]!;
      const r = computePay(
        base({
          salary: [{ monthly: 17000 + i * 123.45, from: "2026-09-26", to: "2026-10-25" }],
          ot: [{ refId: "o", code: "", label: "OT", amount: pick(1), minutes: 60, detail: "" }],
          recurring: [{ refId: "r", name: "x", kind: "earning", amount: pick(2), taxable: true, ssoBase: true }],
          adjustments: [{ id: "d", label: "หัก", kind: "deduction", amount: pick(3), taxable: false, ssoBase: false, reason: "r", byName: "" }],
          unpaidLeaveDays: i % 3,
        }),
      );
      const g = r.lines.filter((l) => l.kind === "earning").reduce((n, l) => n + toSatang(l.amount), 0);
      const d = r.lines.filter((l) => l.kind === "deduction").reduce((n, l) => n + toSatang(l.amount), 0);
      expect(toSatang(r.gross)).toBe(g);
      expect(toSatang(r.deductions)).toBe(d);
      expect(toSatang(r.net)).toBe(g - d);
      for (const l of r.lines) expect(Number.isInteger(toSatang(l.amount) )).toBe(true);
    }
  });
  it("every line explains itself", () => {
    const r = computePay(base({ unpaidLeaveDays: 1 }));
    for (const l of r.lines) expect(l.how.length).toBeGreaterThan(0);
  });
});

describe("ค่าลดหย่อน ล.ย.01", () => {
  const n = (list: Parameters<typeof normalizeAllowances>[0]) => normalizeAllowances(list);
  it("children are counted, not typed as baht (typing 2 = 2 kids = 60,000)", () => {
    expect(n([{ key: "children", label: "", amount: 0, count: 2 }]).list[0]!.amount).toBe(60000);
  });
  it("old amount-only data converts back to a count", () => {
    expect(n([{ key: "children", label: "", amount: 60000 }]).list[0]!.count).toBe(2);
  });
  it("2nd+ child born 2018+ adds 30,000 each, never more than kids − 1", () => {
    const r = n([{ key: "children", label: "", amount: 0, count: 2 }, { key: "children_2018", label: "", amount: 0, count: 2 }]);
    expect(r.list.find((a) => a.key === "children_2018")).toMatchObject({ count: 1, amount: 30000 });
    expect(r.notes.length).toBe(1);
  });
  it("spouse is a flat 60,000", () => {
    expect(n([{ key: "spouse", label: "", amount: 0, count: 1 }]).list[0]!.amount).toBe(60000);
  });
  it("parents capped at 4 people", () => {
    expect(n([{ key: "parents", label: "", amount: 0, count: 6 }]).list[0]!.amount).toBe(120000);
  });
  it("amounts clamp at legal caps, life + health ≤ 100,000", () => {
    const r = n([
      { key: "life_insurance", label: "", amount: 90000 },
      { key: "health_insurance", label: "", amount: 30000 },
      { key: "home_loan", label: "", amount: 150000 },
    ]);
    expect(r.list.find((a) => a.key === "health_insurance")!.amount).toBe(10000);
    expect(r.list.find((a) => a.key === "home_loan")!.amount).toBe(100000);
    expect(r.notes.length).toBe(3);
  });
  it("custom items pass through untouched", () => {
    expect(n([{ key: "other_x", label: "ค่าลดหย่อนพิเศษ", amount: 1234.5 }]).list[0]!.amount).toBe(1234.5);
  });
});

describe("เริ่มใช้ระบบกลางปี (ไม่มียอดสะสม ม.ค.–ก.ย.)", () => {
  const sal = [{ monthly: 45000, from: "2026-09-26", to: "2026-10-25" }];
  it("without the gap the system would think the year is only Oct–Dec and withhold 0 (the bug)", () => {
    expect(computePay(base({ salary: sal })).tax).toBe(0);
  });
  it("gap periods are estimated from current pay — 45,000 × 12 → 14,450/yr → 1,204.17 this month", () => {
    const r = computePay(base({ salary: sal, ytd: { taxable: 0, tax: 0, sso: 0, gapPeriods: 9 } }));
    expect(r.tax).toBe(1204.17);
    expect(r.warnings.some((w) => w.includes("ยอดยกมา"))).toBe(true);
  });
  it("matches the full-year cumulative result when YTD is known instead", () => {
    // ม.ค.–ก.ย. หักไปแล้วงวดละ 1,204.17 → ที่เหลือ 3 งวดต้องได้ใกล้เคียงกัน
    const r = computePay(base({ salary: sal, ytd: { taxable: 405000, tax: 1204.17 * 9, sso: 7875, periods: 9 } }));
    expect(Math.abs(r.tax - 1204.17)).toBeLessThan(0.05);
  });
  it("names the missing months at the start of the year", () => {
    const oct = computePay(base({ salary: sal, ytd: { taxable: 0, tax: 0, sso: 0, gapPeriods: 9 } }));
    expect(oct.warnings.join()).toContain("ม.ค.–ก.ย.");
    const nov = computePay(base({ period: { startsOn: "2026-10-26", endsOn: "2026-11-25", payDate: "2026-11-30" }, salary: [{ monthly: 45000, from: "2026-10-26", to: "2026-11-25" }], ytd: { taxable: 45000, tax: 1204.17, sso: 875, periods: 1, gapPeriods: 9 } }));
    expect(nov.warnings.join()).toContain("ม.ค.–ก.ย.");
  });
  it("counts employed periods before this one", () => {
    expect(periodsEmployedBefore("2026-01-10", "2026-10-31", 25)).toBe(9);
    expect(periodsEmployedBefore("2026-01-30", "2026-10-31", 25)).toBe(8); // หลังตัดงวด → งวดแรกคือ ก.พ.
    expect(periodsEmployedBefore("2025-03-01", "2026-10-31", 25)).toBe(9);
    expect(periodsEmployedBefore("2026-10-05", "2026-10-31", 25)).toBe(0);
    expect(periodsEmployedBefore("2026-11-01", "2026-10-31", 25)).toBe(0);
  });
});
