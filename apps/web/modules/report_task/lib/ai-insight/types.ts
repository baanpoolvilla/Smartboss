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
  usage: AiInsightUsageMonth;
}
