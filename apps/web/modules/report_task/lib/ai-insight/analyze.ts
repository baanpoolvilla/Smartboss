import "server-only";

import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { getOrgPlan, planAtLeast, AI_INSIGHT_MONTHLY_LIMIT, type PlanCode } from "@/modules/report_task/lib/plan";
import { buildAiInsightAggregate } from "./aggregate";
import { callOpenAiInsight } from "./openai-client";
import type { AiInsightState } from "./types";

/** Server-only key — deliberately NOT in store-registry.ts's STORE_KEYS, so
 * the generic `/api/report-task/store/[key]` route can never read or write
 * it. This state holds the AI's own output and the usage counter that
 * quota enforcement depends on; if it were client-writable, any org member
 * could PUT a fabricated `usage.count: 0` to bypass the monthly cap, or
 * inject fake "AI" narrative text that reads as a real analysis. */
const RESULT_KEY = "ai-insight-result";
const SETTINGS_KEY = "ai-insight-settings";

interface AiInsightSettings {
  enabled: boolean;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function emptyState(): AiInsightState {
  return {
    generatedAt: null,
    result: null,
    detail: [],
    people: [],
    combinedSuccessRate: 0,
    previous: null,
    usage: { month: currentMonth(), count: 0, inputTokens: 0, outputTokens: 0, estCostUsd: 0 },
  };
}

export interface AiInsightStatus {
  plan: PlanCode;
  unlocked: boolean;
  enabled: boolean;
  monthlyLimit: number;
  usage: AiInsightState["usage"];
  quotaRemaining: number;
  state: AiInsightState;
}

/** What the dashboard card needs on load — no OpenAI call, just reads what's
 * already cached (settings + last result + this month's usage). */
export async function getAiInsightStatus(orgId: string): Promise<AiInsightStatus> {
  const plan = await getOrgPlan(orgId);
  const unlocked = planAtLeast(plan, "PRO");
  const [settingsRow, resultRow] = await Promise.all([
    readStore<AiInsightSettings>(orgId, SETTINGS_KEY),
    readStore<AiInsightState>(orgId, RESULT_KEY),
  ]);
  const enabled = settingsRow.data?.enabled ?? true; // default on for a Pro+ org that's never touched the switch
  // `?? []`/`?? 0`/`?? null` cover a state saved before these fields
  // existed (older cached result) — falls back gracefully instead of the
  // card crashing on it.
  let state = resultRow.data
    ? {
        ...resultRow.data,
        detail: resultRow.data.detail ?? [],
        people: resultRow.data.people ?? [],
        combinedSuccessRate: resultRow.data.combinedSuccessRate ?? 0,
        previous: resultRow.data.previous ?? null,
        result: resultRow.data.result ? { ...resultRow.data.result, personNotes: resultRow.data.result.personNotes ?? [] } : null,
      }
    : emptyState();
  // Usage resets the moment we notice the calendar month rolled over — no
  // cron needed, this is checked on every status read.
  if (state.usage.month !== currentMonth()) state = { ...state, usage: emptyState().usage };
  const monthlyLimit = AI_INSIGHT_MONTHLY_LIMIT[plan];
  return { plan, unlocked, enabled, monthlyLimit, usage: state.usage, quotaRemaining: Math.max(0, monthlyLimit - state.usage.count), state };
}

export type AnalyzeOutcome =
  | { ok: true; status: AiInsightStatus }
  | { ok: false; reason: "locked" | "disabled" | "quota" };

/** Runs one real analysis round: aggregate → OpenAI → save → count against
 * quota. Callers must check `getAiInsightStatus` first in the UI, but this
 * re-checks everything server-side too — the only place quota is actually
 * enforced (a client-side check is just UX, not the guardrail). */
export async function runAiInsightAnalysis(orgId: string): Promise<AnalyzeOutcome> {
  const status = await getAiInsightStatus(orgId);
  if (!status.unlocked) return { ok: false, reason: "locked" };
  if (!status.enabled) return { ok: false, reason: "disabled" };
  if (status.quotaRemaining <= 0) return { ok: false, reason: "quota" };

  const aggregate = await buildAiInsightAggregate(orgId);
  const { result, inputTokens, outputTokens, estCostUsd } = await callOpenAiInsight(aggregate);

  // This round's own numbers become "previous" for whatever round runs
  // after this one — captured from the state we just read, before it's
  // overwritten below, so the very first round ever run naturally has
  // `previous: null` (nothing to compare against yet).
  const previous =
    status.state.generatedAt != null
      ? {
          combinedSuccessRate: status.state.combinedSuccessRate,
          personTotals: Object.fromEntries(status.state.people.map((p) => [p.name, p.total])),
        }
      : null;

  const nextState: AiInsightState = {
    generatedAt: new Date().toISOString(),
    result,
    detail: aggregate.flagged.map((g) => ({ domain: g.domain, label: g.label, count: g.count, people: g.people })),
    people: aggregate.people,
    combinedSuccessRate: aggregate.combinedSuccessRate,
    previous,
    usage: {
      month: currentMonth(),
      count: status.usage.count + 1,
      inputTokens: status.usage.inputTokens + inputTokens,
      outputTokens: status.usage.outputTokens + outputTokens,
      estCostUsd: status.usage.estCostUsd + estCostUsd,
    },
  };
  await writeStore(orgId, RESULT_KEY, nextState, null);

  return { ok: true, status: { ...status, usage: nextState.usage, quotaRemaining: Math.max(0, status.monthlyLimit - nextState.usage.count), state: nextState } };
}
