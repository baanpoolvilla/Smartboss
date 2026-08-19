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

/** One flagged person's own prioritized read — "here's everything open for
 * THIS person, and what to fix first" — distinct from `actions` (company-
 * wide picks, at most 3, not necessarily one per person). */
export interface AiInsightPersonNote {
  name: string;
  /** What to fix first for this person specifically, and why — 1 sentence. */
  priority: string;
}

export interface AiInsightResult {
  insightText: string;
  stats: AiInsightStat[];
  actions: AiInsightAction[];
  personNotes: AiInsightPersonNote[];
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

/** One flagged person, all their open items combined into one row (not
 * scattered across separate bucket lists) — pairs with `personNotes` above
 * (same names) to build the per-person deep-dive panel. */
export interface AiInsightPersonBreakdown {
  name: string;
  total: number;
  items: { domain: "task" | "report"; label: string; count: number }[];
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
  /** Per-person combined breakdown, pairs with `result.personNotes`. */
  people: AiInsightPersonBreakdown[];
  /** This round's combined success rate — computed, not AI-written, kept as
   * its own field (not parsed back out of insightText) so the trend badge
   * and next round's "vs last time" comparison have a reliable number. */
  combinedSuccessRate: number;
  /** Snapshot taken from *this* round's own numbers right before they're
   * overwritten by the *next* round — i.e. always "what it was last time",
   * so the round after this one can show a delta. Null on the very first
   * round ever run (nothing to compare against yet). */
  previous: { combinedSuccessRate: number; personTotals: Record<string, number> } | null;
  usage: AiInsightUsageMonth;
}
