import "server-only";

import type { AiInsightAggregate } from "../aggregate";
import type { AiInsightHistory, AiInsightSnapshot } from "../history";
import type { AiInsightForecast } from "../types";

/** How many of the most recent rounds to measure closure velocity/rate
 * trend over — same "last few rounds, not the whole history" window
 * `computeTrend` (history.ts) uses, for the same reason: recent behavior
 * predicts near-term outcome better than the account's whole lifetime. */
const WINDOW_SIZE = 3;
/** doNothingRate extrapolates this many days forward at the measured
 * per-day rate of change — "if nothing changes, where are we in 2 weeks". */
const EXTRAPOLATE_DAYS = 14;
const FLAT_THRESHOLD_PER_DAY = 0.1;

function openTotalAt(snapshot: AiInsightSnapshot): number {
  return Object.values(snapshot.flaggedCounts).reduce((sum, n) => sum + n, 0);
}

/** §16.2 of docs/ai-insight-v2-spec.md — deterministic, never left to the
 * model: how fast the backlog is actually clearing (or growing), and what
 * the success rate becomes if nothing changes vs. if the #1 issue gets
 * fixed (`projectedSuccessRate`, already computed in aggregate.ts). Needs
 * ≥2 history rounds to say anything about a trend — with fewer, everything
 * collapses to "today's numbers, no forecast" (`confidence: "low"`,
 * `clearByDays: null`) rather than a guess dressed up as data. */
export function computeForecast(agg: AiInsightAggregate, history: AiInsightHistory): AiInsightForecast {
  const currentOpen = agg.companyMetrics.open_total;
  const currentRate = agg.combinedSuccessRate;
  const ifPlanRate = agg.projectedSuccessRate ?? currentRate;

  if (history.snapshots.length < 2) {
    return { doNothingRate: currentRate, ifPlanRate, clearByDays: null, direction: "flat", confidence: "low" };
  }

  const window = history.snapshots.slice(-WINDOW_SIZE);
  const oldest = window[0]!;
  const daysSpan = Math.max(1, (Date.now() - new Date(oldest.at).getTime()) / (1000 * 60 * 60 * 24));

  // Positive velocity = backlog shrinking; negative = growing. Only ever
  // used to project a future date, never to blame/praise — see UI copy.
  const closureVelocity = (openTotalAt(oldest) - currentOpen) / daysSpan;
  const clearByDays = closureVelocity > 0 ? Math.ceil(currentOpen / closureVelocity) : null;

  const rateChangePerDay = (currentRate - oldest.combinedSuccessRate) / daysSpan;
  const doNothingRate = Math.max(0, Math.min(100, Math.round(currentRate + rateChangePerDay * EXTRAPOLATE_DAYS)));
  const direction = Math.abs(rateChangePerDay) < FLAT_THRESHOLD_PER_DAY ? "flat" : rateChangePerDay > 0 ? "up" : "down";

  return { doNothingRate, ifPlanRate, clearByDays, direction, confidence: history.snapshots.length >= 3 ? "mid" : "low" };
}
