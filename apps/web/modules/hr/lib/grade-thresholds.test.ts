import { describe, expect, it } from "vitest";
import {
  PLUS_GRADE_PRESET,
  halfStepWeights,
  nextGradeHistory,
  parseGradeHistory,
  thresholdsForRound,
  type GradeThresholds,
} from "@/lib/grade-thresholds";

const OLD: GradeThresholds = [["A", 90], ["B", 80], ["C", 70], ["D", 60], ["F", 50]];

describe("เกณฑ์เกรดตามรอบ", () => {
  it("ไม่มีประวัติ = ทุกรอบใช้ชุดปัจจุบัน (บริษัทเดิมทุกที่)", () => {
    expect(thresholdsForRound(OLD, [], "2026-10")).toBe(OLD);
  });

  it("เปลี่ยนเป็นเกรดบวกตั้งแต่รอบ พ.ย. — ต.ค. และก่อนหน้าคงชุดเดิม", () => {
    const h = nextGradeHistory(OLD, [], PLUS_GRADE_PRESET, "2026-11");
    expect(h).toEqual([{ until: "2026-10", thresholds: OLD }]);
    expect(thresholdsForRound(PLUS_GRADE_PRESET, h, "2026-09")).toEqual(OLD);
    expect(thresholdsForRound(PLUS_GRADE_PRESET, h, "2026-10")).toEqual(OLD);
    expect(thresholdsForRound(PLUS_GRADE_PRESET, h, "2026-11")).toBe(PLUS_GRADE_PRESET);
  });

  it("รอบ ม.ค. → ชุดเก่าถึง ธ.ค. ปีก่อน", () => {
    expect(nextGradeHistory(OLD, [], PLUS_GRADE_PRESET, "2027-01")[0]!.until).toBe("2026-12");
  });

  it("บันทึกโดยเกณฑ์ไม่เปลี่ยน = ประวัติเดิม", () => {
    const h = [{ until: "2026-10", thresholds: OLD }];
    expect(nextGradeHistory(PLUS_GRADE_PRESET, h, [...PLUS_GRADE_PRESET], "2026-12")).toEqual(h);
  });

  it("ทุกรอบรวมย้อนหลัง = ล้างประวัติ (แบบเดิม)", () => {
    expect(nextGradeHistory(OLD, [{ until: "2026-10", thresholds: OLD }], PLUS_GRADE_PRESET, null)).toEqual([]);
  });

  it("แก้ซ้ำหลายรอบ — ทุกรอบก่อนหน้าได้ชุดที่เคยใช้จริง", () => {
    const mid: GradeThresholds = [["A", 95], ["B", 85]];
    const h1 = nextGradeHistory(OLD, [], mid, "2026-11");
    const h2 = nextGradeHistory(mid, h1, PLUS_GRADE_PRESET, "2027-02");
    expect(thresholdsForRound(PLUS_GRADE_PRESET, h2, "2026-10")).toEqual(OLD);
    expect(thresholdsForRound(PLUS_GRADE_PRESET, h2, "2026-11")).toEqual(mid);
    expect(thresholdsForRound(PLUS_GRADE_PRESET, h2, "2027-01")).toEqual(mid);
    expect(thresholdsForRound(PLUS_GRADE_PRESET, h2, "2027-02")).toBe(PLUS_GRADE_PRESET);
  });

  it("แก้ในรอบเดิมซ้ำ (รอบนี้ → รอบนี้) ไม่ทับชุดเก่าของรอบก่อน", () => {
    const h1 = nextGradeHistory(OLD, [], PLUS_GRADE_PRESET, "2026-11");
    const tweak: GradeThresholds = [["A+", 102], ...PLUS_GRADE_PRESET.slice(1)];
    const h2 = nextGradeHistory(PLUS_GRADE_PRESET, h1, tweak, "2026-11");
    expect(h2).toEqual([{ until: "2026-10", thresholds: OLD }]);
  });

  it("อ่านจากฐานข้อมูล: รูปแบบผิดตัดทิ้ง เรียงตามรอบ", () => {
    const h = parseGradeHistory([
      { until: "2026-12", thresholds: { A: 1 } },
      { until: "bad", thresholds: { A: 1 } },
      { until: "2026-10", thresholds: { B: 80, A: 90 } },
      { until: "2026-11", thresholds: {} },
    ]);
    expect(h.map((e) => e.until)).toEqual(["2026-10", "2026-12"]);
    expect(h[0]!.thresholds).toEqual([["A", 90], ["B", 80]]);
  });
});

describe("ตัวคูณไล่ทีละ 0.5", () => {
  it("เกรดบวกครบชุด", () => {
    expect(halfStepWeights(["A+", "A", "B+", "B", "C+", "C", "D+", "D", "F"])).toEqual({
      "A+": 4.5, A: 4, "B+": 3.5, B: 3, "C+": 2.5, C: 2, "D+": 1.5, D: 1, F: 0,
    });
  });

  it("ชุดเดิม A–D = 4/3/2/1 สัดส่วนเท่าค่าตั้งต้นเดิม 1/0.75/0.5/0.25", () => {
    expect(halfStepWeights(["A", "B", "C", "D", "F"])).toEqual({ A: 4, B: 3, C: 2, D: 1, F: 0 });
  });
});
