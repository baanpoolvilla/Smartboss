import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCORE_PERIOD,
  effectiveScorePeriodOf,
  daysUntilCutoff,
  resolveScorePeriodParam,
  scorePeriodLabel,
  scorePeriodOf,
  scorePeriodRange,
} from "@/lib/score-period";

const cfg = DEFAULT_SCORE_PERIOD;
// เวลาไทย = UTC+7
const th = (iso: string) => new Date(`${iso}+07:00`);

describe("score period (cut off on the 25th)", () => {
  it("December's grade runs 26 Nov – 25 Dec, Thai time", () => {
    const { from, to } = scorePeriodRange(cfg, "2026-12");
    expect(from).toEqual(th("2026-11-26T00:00:00"));
    expect(to).toEqual(new Date(th("2026-12-26T00:00:00").getTime() - 1));
    expect(scorePeriodLabel(cfg, "2026-12")).toBe("26 พ.ย. – 25 ธ.ค. 2569");
  });

  it("the 25th belongs to this month, the 26th to the next", () => {
    expect(scorePeriodOf(cfg, th("2026-10-25T23:59:00"))).toBe("2026-10");
    expect(scorePeriodOf(cfg, th("2026-10-26T00:00:00"))).toBe("2026-11");
    // รายงานเก็บเที่ยงคืนเวลาไทย (= 17:00 UTC ของวันก่อน)
    expect(scorePeriodOf(cfg, new Date("2026-10-25T17:00:00Z"))).toBe("2026-11");
  });

  it("a one-month override ends that period early and starts the next one with it", () => {
    const custom = { cutoffDay: 25, overrides: { "2026-11": 20 } };
    expect(scorePeriodLabel(custom, "2026-11")).toBe("26 ต.ค. – 20 พ.ย. 2569");
    expect(scorePeriodLabel(custom, "2026-12")).toBe("21 พ.ย. – 25 ธ.ค. 2569");
  });

  it("the current period moves to next month after the cutoff, and counts days left", () => {
    expect(resolveScorePeriodParam(cfg, undefined, th("2026-10-27T10:00:00"))).toBe("2026-11");
    expect(resolveScorePeriodParam(cfg, "2026-12", th("2026-10-27T10:00:00"))).toBe("2026-11");
    expect(daysUntilCutoff(cfg, th("2026-10-20T10:00:00"))).toBe(5);
    expect(daysUntilCutoff(cfg, th("2026-10-25T10:00:00"))).toBe(0);
  });

  it("a cutoff day the month doesn't have falls back to the month's last day", () => {
    const end = { cutoffDay: 30, overrides: {} };
    expect(scorePeriodLabel(end, "2027-02")).toBe("31 ม.ค. – 28 ก.พ. 2570");
    expect(scorePeriodLabel(end, "2027-03")).toBe("1 มี.ค. – 30 มี.ค. 2570");
  });

  it("the first period after the switch starts on the 1st (September was already graded by calendar month)", () => {
    expect(scorePeriodLabel(cfg, "2026-09")).toBe("1 ก.ย. – 30 ก.ย. 2569");
    expect(scorePeriodLabel(cfg, "2026-10")).toBe("1 ต.ค. – 25 ต.ค. 2569");
    expect(scorePeriodLabel(cfg, "2026-11")).toBe("26 ต.ค. – 25 พ.ย. 2569");
    expect(scorePeriodOf(cfg, th("2026-09-28T10:00:00"))).toBe("2026-09");
  });

  it("attendance docks (dated UTC midnight of the work day, written 08:00 the next morning) stay in the work day's period", () => {
    // ลงเวลาวันที่ 25 พ.ย. — หักตอน 08:00 ของวันที่ 26 แต่ occurredAt = วันทำงาน 25 พ.ย.
    expect(scorePeriodOf(cfg, new Date("2026-11-25T00:00:00Z"))).toBe("2026-11");
    expect(scorePeriodOf(cfg, new Date("2026-11-26T00:00:00Z"))).toBe("2026-12");
    // ขอบปลายรอบ = 23:59:59.999 ของวันที่ 25 เวลาไทย
    expect(scorePeriodOf(cfg, th("2026-11-25T23:59:59"))).toBe("2026-11");
  });

  it("locked at 23:59 on the cutoff day: later human changes don't count anywhere; system judgements of that day get until noon", () => {
    const day25 = new Date("2026-11-25T00:00:00Z"); // วันทำงาน 25 พ.ย.
    // ระบบหักขาดงานตอน 08:00 วันที่ 26 ⇒ ยังนับรอบ พ.ย.
    expect(effectiveScorePeriodOf(cfg, day25, th("2026-11-26T08:00:00"), null)).toBe("2026-11");
    // กะดึกเลิก 06:00 หักรอบ 08:59 ⇒ ยังนับ · ระบบบันทึกหลังเที่ยง ⇒ ไม่นับ
    expect(effectiveScorePeriodOf(cfg, day25, th("2026-11-26T08:59:00"), null)).toBe("2026-11");
    expect(effectiveScorePeriodOf(cfg, day25, th("2026-11-26T12:30:00"), null)).toBeNull();
    // คนอนุมัติ/คืนคะแนนก่อน 23:59 ⇒ นับ · หลังเที่ยงคืน ⇒ ไม่นับที่ไหนเลย
    expect(effectiveScorePeriodOf(cfg, day25, th("2026-11-25T23:30:00"), "ceo")).toBe("2026-11");
    expect(effectiveScorePeriodOf(cfg, day25, th("2026-11-26T00:10:00"), "ceo")).toBeNull();
    expect(effectiveScorePeriodOf(cfg, day25, th("2026-12-03T14:00:00"), "ceo")).toBeNull();
  });
});
