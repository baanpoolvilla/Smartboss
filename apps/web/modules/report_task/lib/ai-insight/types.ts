/** What the model is asked to return, and what the dashboard card renders.
 * Kept intentionally small/flat — this is a summary card, not a report. */
export interface AiInsightStat {
  label: string;
  count: number;
  tone: "red" | "amber" | "green";
}

export interface AiInsightAction {
  who: string;
  detail: string;
  severity: "high" | "mid" | "good";
}

export interface AiInsightResult {
  insightText: string;
  stats: AiInsightStat[];
  actions: AiInsightAction[];
}

/** One real, deterministic breakdown bucket (from lib/ai-insight/aggregate.ts,
 * NOT written by the model) — the "ดูรายละเอียด" data behind the card. Kept
 * separate from `AiInsightResult` above so a click always shows the actual
 * data the AI reasoned from, not the AI's own paraphrased stats/labels
 * (which have no guaranteed 1:1 mapping back to a specific bucket). */
export interface AiInsightDetailGroup {
  domain: "task" | "report";
  label: string;
  count: number;
  people: { name: string; count: number }[];
}

export interface AiInsightUsageMonth {
  month: string; // "2026-08"
  count: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
}

/** Persisted server-side under the ("ai-insight-result") store key — never
 * exposed to the generic client-writable store route (see store-registry.ts
 * comment), only read/written by lib/ai-insight/analyze.ts, so a client
 * can't forge a fake analysis or reset its own usage counter. */
export interface AiInsightState {
  generatedAt: string | null;
  result: AiInsightResult | null;
  /** Full real breakdown behind this round's result — see AiInsightDetailGroup. */
  detail: AiInsightDetailGroup[];
  usage: AiInsightUsageMonth;
}
