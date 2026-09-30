import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aggregate,
  benchmarkError,
  changePct,
  DEFAULT_BENCHMARKS,
  DEFAULT_RULE_SETTINGS,
  evaluate,
  ruleFindings,
  statusOf,
  wastedSearchTerms,
  type DailyRaw,
} from "../rules";

const day = (date: string, p: Partial<DailyRaw> = {}): DailyRaw => ({
  date,
  impressions: 0,
  clicks: 0,
  cost: 0,
  conversions: 0,
  conversionsValue: 0,
  ...p,
});

test("สถานะตามทิศทาง — ขอบเขตนับเป็นปกติ (CTR 5–10% = ปกติ)", () => {
  const ctr = DEFAULT_BENCHMARKS.ctr;
  assert.equal(statusOf(4.99, ctr), "poor");
  assert.equal(statusOf(5, ctr), "normal");
  assert.equal(statusOf(10, ctr), "normal");
  assert.equal(statusOf(10.01, ctr), "good");
});

test("CPC ต่ำ = ดี — ไม่กลับด้านแบบ Excel เดิม", () => {
  const cpc = DEFAULT_BENCHMARKS.cpc;
  assert.equal(statusOf(2, cpc), "good");
  assert.equal(statusOf(5, cpc), "normal");
  assert.equal(statusOf(12, cpc), "poor");
});

test("benchmarkError จับเกณฑ์ที่ใส่กลับด้าน", () => {
  assert.equal(benchmarkError(DEFAULT_BENCHMARKS.cpc), null);
  assert.ok(benchmarkError({ direction: "lower_better", poor: 3, good: 10 }));
  assert.ok(benchmarkError({ direction: "higher_better", poor: 10, good: 5 }));
});

test("KPI คำนวณจากผลรวมค่าดิบ ไม่ใช่ค่าเฉลี่ยรายวัน", () => {
  // วันแรก CTR 50% (1/2) วันที่สอง CTR 1% (1/100) — เฉลี่ยรายวัน = 25.5% แต่ที่ถูกคือ 2/102
  const t = aggregate([day("2026-06-01", { impressions: 2, clicks: 1 }), day("2026-06-02", { impressions: 100, clicks: 1 })]);
  const ev = evaluate(t, DEFAULT_BENCHMARKS, { minClicksToJudge: 0 });
  assert.equal(ev.ctr, 1.96);
});

test("impression share ถ่วงน้ำหนักด้วย impressions และเป็น %", () => {
  const t = aggregate([
    day("2026-06-01", { impressions: 100, topImprPct: 0.9 }),
    day("2026-06-02", { impressions: 300, topImprPct: 0.5 }),
  ]);
  assert.equal(t.topImprPct, 60);
});

test("CPA: conversions = 0 แต่มีค่าใช้จ่าย → N/A และสถานะแดง", () => {
  const ev = evaluate(aggregate([day("2026-06-01", { impressions: 100, clicks: 60, cost: 500 })]), DEFAULT_BENCHMARKS, DEFAULT_RULE_SETTINGS);
  assert.equal(ev.cpa, null);
  assert.equal(ev.cpa_status, "poor");
});

test("คลิกน้อยกว่าเกณฑ์ → Conv. Rate ติดป้ายข้อมูลน้อย", () => {
  const ev = evaluate(aggregate([day("2026-06-01", { impressions: 100, clicks: 10, conversions: 5, cost: 50 })]), DEFAULT_BENCHMARKS, DEFAULT_RULE_SETTINGS);
  assert.equal(ev.low_data, true);
  assert.equal(ev.conv_rate_status, "low_data");
});

test("budget utilization = (cost ÷ วันที่วิ่งจริง) ÷ งบรายวัน", () => {
  const t = aggregate([
    day("2026-06-01", { impressions: 10, cost: 100 }),
    day("2026-06-02", { impressions: 10, cost: 100 }),
    day("2026-06-03"), // ไม่วิ่ง ไม่นับ
  ]);
  const ev = evaluate(t, DEFAULT_BENCHMARKS, DEFAULT_RULE_SETTINGS, 1000);
  assert.equal(ev.budget_util_pct, 10);
});

test("changePct", () => {
  assert.equal(changePct(110, 100), 10);
  assert.equal(changePct(50, 0), null);
  assert.equal(changePct(null, 10), null);
});

test("คำค้นหาที่เสียเงิน: คลิก ≥ เกณฑ์ และ conversion = 0 เรียงตามค่าใช้จ่าย", () => {
  const w = wastedSearchTerms(
    [
      { search_term: "a", ad_group_id: "1", impressions: 1, clicks: 10, cost: 5, conversions: 0 },
      { search_term: "b", ad_group_id: "1", impressions: 1, clicks: 9, cost: 50, conversions: 0 },
      { search_term: "c", ad_group_id: "1", impressions: 1, clicks: 30, cost: 80, conversions: 0 },
      { search_term: "d", ad_group_id: "1", impressions: 1, clicks: 30, cost: 90, conversions: 1 },
    ],
    { wastedTermMinClicks: 10 }
  );
  assert.deepEqual(w.map((x) => x.search_term), ["c", "a"]);
});

test("ข้อสังเกต: งบไม่ใช่ตัวจำกัด / Ad Rank เป็นตัวจำกัด / ไม่มี conversion", () => {
  const ev = evaluate(
    aggregate([day("2026-06-01", { impressions: 1000, clicks: 100, cost: 89, rankLostIs: 0.425, budgetLostIs: 0 })]),
    DEFAULT_BENCHMARKS,
    DEFAULT_RULE_SETTINGS,
    1000
  );
  const f = ruleFindings([{ id: "111", name: "P_Lead", ...ev }], [], new Map(), DEFAULT_RULE_SETTINGS);
  assert.deepEqual(f.map((x) => x.type).sort(), ["budget_not_limiting", "no_conversion", "rank_limited"]);
});
