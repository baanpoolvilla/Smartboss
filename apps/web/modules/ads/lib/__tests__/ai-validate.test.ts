import { test } from "node:test";
import assert from "node:assert/strict";

import { allowedNumbers, hideFailed, parseAiOutput, validateAiOutput, type AiOutput } from "../ai-validate";

const input = {
  period: { from: "2026-06-01", to: "2026-06-15", days: 15 },
  account_totals: { cost: 6509.33, cpa: 54.27, cpa_change_pct: -8.2 },
  campaigns: [
    { id: 111, name: "P_Lead-Search-Location", budget_util_pct: 8.9 },
    { id: 222, name: "Brand 2026", budget_util_pct: 95 },
  ],
  ad_groups: [{ id: 501 }],
  keywords: [],
};

const ctx = {
  input,
  entityIds: { campaign: new Set(["111", "222"]), ad_group: new Set(["501"]), keyword: new Set<string>() },
  budgetBlockedCampaignIds: new Set(["111"]),
};

const base = (patch: Partial<AiOutput> = {}): AiOutput => ({
  executive_summary: "ใช้เงิน 6,509.33 บาท CPA 54.27 ลดลง 8.2% ใน 15 วัน",
  top_performers: [],
  underperformers: [],
  previous_actions_review: [],
  actions: [],
  ...patch,
});

test("parse ไม่ผ่านคืน null", () => {
  assert.equal(parseAiOutput("not json"), null);
  assert.equal(parseAiOutput(JSON.stringify({ foo: 1 })), null);
  assert.ok(parseAiOutput(JSON.stringify({ executive_summary: "x", actions: [] })));
});

test("ตัวเลขที่มาจาก input ผ่าน — รวมค่าปัดเศษ ค่าติดลบ ชื่อแคมเปญ ความยาว array", () => {
  assert.deepEqual(validateAiOutput(base(), ctx), []);
  assert.deepEqual(validateAiOutput(base({ executive_summary: "CPA ราว 54 บาท แคมเปญ Brand 2026 จาก 2 แคมเปญ" }), ctx), []);
});

test("ตัวเลขที่ AI คิดเอง ไม่ผ่าน", () => {
  const issues = validateAiOutput(base({ executive_summary: "CPA 61.5 บาท" }), ctx);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.section, "executive_summary");
});

test("entity_id ที่ไม่มีอยู่จริง ไม่ผ่าน · account ผ่านเสมอ", () => {
  const issues = validateAiOutput(
    base({
      actions: [
        { title: "a", rationale: "", impact: "high", urgency: "now", entity_type: "campaign", entity_id: 999 },
        { title: "b", rationale: "", impact: "low", urgency: "now", entity_type: "account", entity_id: null },
      ],
    }),
    ctx
  );
  assert.deepEqual(issues.map((i) => i.index), [0]);
});

test("แนะนำเพิ่มงบให้แคมเปญที่ใช้งบต่ำกว่าเกณฑ์ ไม่ผ่าน", () => {
  const issues = validateAiOutput(
    base({
      actions: [
        { title: "เพิ่มงบรายวัน", rationale: "", impact: "high", urgency: "now", entity_type: "campaign", entity_id: 111 },
        { title: "เพิ่มงบรายวัน", rationale: "", impact: "high", urgency: "now", entity_type: "campaign", entity_id: 222 },
      ],
    }),
    ctx
  );
  assert.deepEqual(issues.map((i) => i.index), [0]);
});

test("hideFailed ซ่อนเฉพาะส่วนที่ไม่ผ่าน", () => {
  const out = base({
    executive_summary: "CPA 61.5",
    actions: [
      { title: "a", rationale: "", impact: "high", urgency: "now", entity_type: "campaign", entity_id: 999 },
      { title: "b", rationale: "", impact: "low", urgency: "now", entity_type: "campaign", entity_id: 222 },
    ],
  });
  const { output, hidden } = hideFailed(out, validateAiOutput(out, ctx));
  assert.equal(output.executive_summary, "");
  assert.deepEqual(output.actions.map((a) => a.title), ["b"]);
  assert.equal(hidden.length, 2);
});

test("allowedNumbers เก็บส่วนประกอบวันที่ (รวมปี พ.ศ.)", () => {
  const n = allowedNumbers({ d: "2026-06-15" });
  assert.ok(n.includes(2569) && n.includes(15) && n.includes(6));
});
