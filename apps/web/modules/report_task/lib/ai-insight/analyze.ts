import "server-only";
import OpenAI from "openai";

import { createStoreIfAbsent, readStore, writeStore, type StoreWrite } from "@/modules/report_task/lib/db/org-store";
import { getOrgPlan, planAtLeast, AI_INSIGHT_MONTHLY_LIMIT, type PlanCode } from "@/modules/report_task/lib/plan";
import { buildAiInsightAggregate } from "./aggregate";
import { callOpenAiInsight } from "./openai-client";
import { EMPTY_HISTORY, appendSnapshot, computeTrend, snapshotFromAggregate, type AiInsightHistory } from "./history";
import { reconcile, resolveNoteActions } from "./ledger";
import { detectRootCauses } from "./analyzers/root-cause";
import { computeForecast } from "./analyzers/forecast";
import { detectRisks } from "./analyzers/risk";
import type { AiInsightLedgerRecord, AiInsightState } from "./types";

/** Server-only key — deliberately NOT in store-registry.ts's STORE_KEYS, so
 * the generic `/api/report-task/store/[key]` route can never read or write
 * it. This state holds the AI's own output and the usage counter that
 * quota enforcement depends on; if it were client-writable, any org member
 * could PUT a fabricated `usage.count: 0` to bypass the monthly cap, or
 * inject fake "AI" narrative text that reads as a real analysis. */
const RESULT_KEY = "ai-insight-result";
const SETTINGS_KEY = "ai-insight-settings";
/** Same server-only reasoning as RESULT_KEY — a client that could write its
 * own history could fake an "improving" trend that never happened. */
const HISTORY_KEY = "ai-insight-history";
/** Same server-only reasoning as RESULT_KEY — a client that could write its
 * own ledger could fake "improved"/"resolved" outcomes that never happened.
 * Kept as its own key (per docs/ai-insight-v2-spec.md §14 phase C step 3)
 * rather than folded into RESULT_KEY, so it round-trips independently of
 * the rest of the cached result. */
const LEDGER_KEY = "ai-insight-ledger";

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
    departments: [],
    combinedSuccessRate: 0,
    companyTrend: null,
    previous: null,
    ledger: [],
    rootCauses: [],
    forecast: null,
    risks: [],
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
  const [settingsRow, resultRow, ledgerRow] = await Promise.all([
    readStore<AiInsightSettings>(orgId, SETTINGS_KEY),
    readStore<AiInsightState>(orgId, RESULT_KEY),
    readStore<AiInsightLedgerRecord[]>(orgId, LEDGER_KEY),
  ]);
  const enabled = settingsRow.data?.enabled ?? true; // default on for a Pro+ org that's never touched the switch
  // `?? []`/`?? 0`/`?? null` cover a state saved before these fields
  // existed (older cached result) — falls back gracefully instead of the
  // card crashing on it.
  let state = resultRow.data
    ? {
        ...resultRow.data,
        detail: resultRow.data.detail ?? [],
        people: (resultRow.data.people ?? []).map((p) => ({ ...p, trend: p.trend ?? null })),
        departments: (resultRow.data.departments ?? []).map((d) => ({ ...d, trend: d.trend ?? null })),
        combinedSuccessRate: resultRow.data.combinedSuccessRate ?? 0,
        companyTrend: resultRow.data.companyTrend ?? null,
        previous: resultRow.data.previous ?? null,
        // One-time migration fallback for a result saved when the ledger
        // still lived inside RESULT_KEY — `ledgerRow.data` below is
        // authoritative once LEDGER_KEY has ever been written.
        ledger: resultRow.data.ledger ?? [],
        rootCauses: resultRow.data.rootCauses ?? [],
        forecast: resultRow.data.forecast ?? null,
        risks: resultRow.data.risks ?? [],
        result: resultRow.data.result
          ? {
              ...resultRow.data.result,
              personNotes: resultRow.data.result.personNotes ?? [],
              deptNotes: resultRow.data.result.deptNotes ?? [],
            }
          : null,
      }
    : emptyState();
  if (ledgerRow.data) state = { ...state, ledger: ledgerRow.data };
  // Usage resets the moment we notice the calendar month rolled over — no
  // cron needed, this is checked on every status read.
  if (state.usage.month !== currentMonth()) state = { ...state, usage: emptyState().usage };
  const monthlyLimit = AI_INSIGHT_MONTHLY_LIMIT[plan];
  return { plan, unlocked, enabled, monthlyLimit, usage: state.usage, quotaRemaining: Math.max(0, monthlyLimit - state.usage.count), state };
}

export type AnalyzeOutcome =
  | { ok: true; status: AiInsightStatus }
  | { ok: false; reason: "locked" | "disabled" | "quota" | "busy" };

/**
 * ล็อกเดือนหนึ่งไว้ทีละครั้งอย่างมาก — จำกัดรอบ retry ของ CAS loop ด้านล่าง
 * (reserve/refund/commit) ไม่ให้วนไม่มีที่สิ้นสุดถ้าชนกันรัวๆ จริง คำขอที่
 * หมดรอบแล้วยังไม่ผ่านถือว่า "busy" ให้ผู้ใช้ลองใหม่ ดีกว่าปล่อยให้ค้าง
 */
const MAX_CAS_ATTEMPTS = 5;

/**
 * `writeStore(...,null)` upsert เฉยๆ ตอนแถวยังไม่มี (version 0) — ไม่ CAS
 * เลย หลายคำขอ "คนแรก" พร้อมกันจะผ่านหมดทุกคน (ดูคอมเมนต์ยาวที่
 * createStoreIfAbsent) ทุกจุดที่ CAS loop ในไฟล์นี้ต้องผ่านฟังก์ชันนี้แทน
 * เรียก writeStore ตรงๆ เพื่อให้ครั้งแรกสุด (version 0) ก็ยัง atomic จริง
 */
function writeStoreCas(orgId: string, key: string, data: unknown, version: number): Promise<StoreWrite> {
  return version === 0 ? createStoreIfAbsent(orgId, key, data) : writeStore(orgId, key, data, version);
}

/**
 * จองโควตา 1 ครั้งแบบ atomic (compare-and-swap ผ่าน writeStore's version
 * check) — ต้องจองสำเร็จ**ก่อน**ยิง OpenAI เสมอ ไม่ใช่หลัง เพราะโควตานี้ผูก
 * กับแพ็กเกจที่ขายจริง (FREE/PRO/ENTERPRISE) ไม่ใช่แค่เลขกันเผื่อภายใน —
 * "นับพลาด" แปลว่าลูกค้าได้ใช้เกินสิทธิ์ฟรี หรือเราจ่าย OpenAI ซ้ำโดยไม่ได้
 * นับ ทั้งคู่กระทบเงินจริง
 *
 * ทำไมต้อง retry ไม่ใช่ read-check-write เฉยๆ: สอง request จองพร้อมกันจะอ่าน
 * เจอ version เดียวกัน — คำขอที่ 2 เขียนไม่ผ่าน (version ไม่ตรงแล้ว) ต้องอ่าน
 * ใหม่แล้วเช็ค/เขียนซ้ำ ไม่ใช่ยอมแพ้เฉยๆ (จะกลายเป็นปฏิเสธคำขอที่ยังไม่เกิน
 * โควตาจริง) และไม่ใช่ยิง OpenAI ไปเลยโดยไม่มี reservation ยืนยันแล้ว
 */
export async function reserveQuotaSlot(
  orgId: string,
  monthlyLimit: number
): Promise<{ ok: true; state: AiInsightState; reservedMonth: string } | { ok: false; reason: "quota" | "busy" }> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { data, version } = await readStore<AiInsightState>(orgId, RESULT_KEY);
    const base = data ?? emptyState();
    const month = currentMonth();
    // เดือนพลิก = เริ่มนับใหม่ (ตรรกะเดียวกับ getAiInsightStatus)
    const usage = base.usage.month === month ? base.usage : { ...emptyState().usage, month };
    if (usage.count >= monthlyLimit) return { ok: false, reason: "quota" };

    const nextState: AiInsightState = { ...base, usage: { ...usage, count: usage.count + 1 } };
    const result = await writeStoreCas(orgId, RESULT_KEY, nextState, version);
    if (result.ok) return { ok: true, state: nextState, reservedMonth: month };
    // conflict — อีกคนจอง/เขียนแทรกระหว่างนี้ อ่านใหม่แล้วเช็ค/เขียนใหม่ทั้งชุด
  }
  return { ok: false, reason: "busy" };
}

/**
 * คืนโควตาที่จองไว้ — ใช้เมื่อรู้ชัดว่า "ยังไม่ถึง OpenAI" เท่านั้น (ดู
 * runAiInsightAnalysis ว่าเรียกตอนไหน) best-effort: ทำพลาดแค่ log ไม่ throw
 * ทับ error เดิมที่ทำให้ต้อง refund ตั้งแต่แรก
 *
 * ⚠ ต้อง decrement ค่า**ปัจจุบัน**ที่อ่านสดทุกรอบ ห้ามเขียนทับด้วยค่าก่อนจอง
 * ที่จำไว้ — ถ้าเขียนทับด้วยสแนปช็อตเก่า จะลบ reservation ของคำขออื่นที่เพิ่ง
 * จองสำเร็จเข้ามาแทรกระหว่างที่เรากำลัง refund ทิ้งไปด้วย (นับหายจริง ไม่ใช่
 * แค่นับคลาดเคลื่อน)
 */
export async function refundQuotaSlot(orgId: string, reservedMonth: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { data, version } = await readStore<AiInsightState>(orgId, RESULT_KEY);
    if (!data) return; // ไม่ควรเกิด (เพิ่งจองไปเอง) — แต่ไม่มีอะไรให้ refund จริงๆ
    // เดือนพลิกไปแล้วระหว่างจอง→refund — bucket เก่าไม่มีความหมายแล้ว ข้ามได้
    if (data.usage.month !== reservedMonth) return;

    const nextState: AiInsightState = { ...data, usage: { ...data.usage, count: Math.max(0, data.usage.count - 1) } };
    const result = await writeStoreCas(orgId, RESULT_KEY, nextState, version);
    if (result.ok) return;
    // conflict — อ่านค่าล่าสุดใหม่แล้วลองลบ 1 จากยอดนั้นอีกที (ไม่ใช่ยอมแพ้)
  }
  // แพ้ทุกรอบ — โควตาจะค้างสูงเกินจริงอยู่ 1 (ลูกค้าเสียสิทธิ์ไปนิดหน่อย) แย่
  // น้อยกว่าปล่อยให้นับหายหรือลบ reservation ของคนอื่นทิ้งเพราะ retry ผิดวิธี
  console.error(`[ai-insight] คืนโควตาไม่สำเร็จหลังลอง ${MAX_CAS_ATTEMPTS} ครั้ง — orgId=${orgId} month=${reservedMonth}`);
}

/** เขียนผลวิเคราะห์จริงกลับ (หลัง OpenAI ตอบมาแล้ว) แบบ CAS เหมือนกัน — ไม่ใช่
 * เพราะกลัวชนกับตัวเอง (จองสำเร็จแล้วมีแค่คำขอนี้ที่กำลังเขียนผลของตัวเอง)
 * แต่เพราะ `count`/`usage` ปัจจุบันอาจถูกคำขอ**อื่น**จองเพิ่มระหว่างที่เรา
 * รอ OpenAI ตอบอยู่ — เขียนทับด้วยสแนปช็อตตอนจอง (`reservedState`) ตรงๆ จะ
 * ลบ reservation ของคำขอนั้นทิ้งเหมือนที่ระวังไว้ตอน refund */
async function commitAnalysisResult(
  orgId: string,
  apply: (current: AiInsightState) => AiInsightState
): Promise<AiInsightState> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { data, version } = await readStore<AiInsightState>(orgId, RESULT_KEY);
    const next = apply(data ?? emptyState());
    const result = await writeStoreCas(orgId, RESULT_KEY, next, version);
    if (result.ok) return next;
  }
  throw new Error("บันทึกผลวิเคราะห์ AI ไม่สำเร็จ (เขียนชนกันหลายครั้งเกินไป)");
}

/** true = ยังไม่ถึง OpenAI แน่นอน (ปฏิเสธก่อนยิงจริง หรือเชื่อมต่อไม่ติดเลย)
 * — จุดเดียวที่ refund ปลอดภัย ทุกอย่างนอกจากนี้ถือว่า "อาจถึงแล้ว" (timeout,
 * ได้ response กลับมาแต่เป็น error, รูปแบบผลลัพธ์ผิด) แล้ว**ไม่ refund**
 * เลือก fail ไปทาง cost-safe เสมอเมื่อไม่ชัดเจน — ตรงข้ามกับฝั่งลูกค้าที่เรา
 * เลือก fail ไปทาง "ได้สิทธิ์น้อยกว่านิดถ้า process ตายกลางคัน" (ดู
 * commitAnalysisResult's caller ด้านล่าง) */
function definitelyNeverReachedOpenAi(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionTimeoutError) return false; // timeout = ไม่ชัดเจนว่าถึงหรือยัง
  if (err instanceof OpenAI.APIConnectionError) return true; // ต่อไม่ติดเลย (DNS/network refused)
  // error จากโค้ดเราเอง (เช่น OPENAI_API_KEY ไม่ได้ตั้ง, aggregate พัง) ที่โยน
  // ก่อนเรียก SDK เลย — ไม่ใช่ instance ของ error จาก openai SDK เลยสักตัว
  return !(err instanceof OpenAI.APIError);
}

/** Runs one real analysis round: reserve quota → aggregate → OpenAI → save.
 * Callers must check `getAiInsightStatus` first in the UI, but this
 * re-checks everything server-side too — the only place quota is actually
 * enforced (a client-side check is just UX, not the guardrail).
 *
 * Quota is **reserved before** calling OpenAI, not counted after — this is a
 * paid-plan entitlement (FREE/PRO/ENTERPRISE), so both directions of getting
 * this wrong cost real money: undercounting lets an org use more than their
 * plan allows for free, and not reserving before the call lets N concurrent
 * requests all pass a stale quota check and all actually call OpenAI even
 * when only 1 slot was left. */
export async function runAiInsightAnalysis(orgId: string): Promise<AnalyzeOutcome> {
  const plan = await getOrgPlan(orgId);
  const unlocked = planAtLeast(plan, "PRO");
  if (!unlocked) return { ok: false, reason: "locked" };

  const settingsRow = await readStore<AiInsightSettings>(orgId, SETTINGS_KEY);
  const enabled = settingsRow.data?.enabled ?? true;
  if (!enabled) return { ok: false, reason: "disabled" };

  const monthlyLimit = AI_INSIGHT_MONTHLY_LIMIT[plan];
  const reservation = await reserveQuotaSlot(orgId, monthlyLimit);
  if (!reservation.ok) return { ok: false, reason: reservation.reason };

  let inputTokens = 0;
  let outputTokens = 0;
  let estCostUsd = 0;
  try {
    const ledgerRow = await readStore<AiInsightLedgerRecord[]>(orgId, LEDGER_KEY);
    const [aggregate, historyRow] = await Promise.all([
      buildAiInsightAggregate(orgId),
      readStore<AiInsightHistory>(orgId, HISTORY_KEY),
    ]);
    const history = historyRow.data ?? EMPTY_HISTORY;

    // Trends computed from history *before* this round's snapshot is
    // appended — i.e. "how did we get to today," not "today vs today." Null
    // until there are ≥2 prior data points (see computeTrend).
    const companyTrend = computeTrend(history, "company", "rate");
    const departments = aggregate.departments.map((d) => ({ ...d, trend: computeTrend(history, `dept:${d.departmentId}`, "rate") }));
    const people = aggregate.people.map((p) => ({ ...p, trend: computeTrend(history, `person:${p.name}`, "count") }));

    // §16 analyzers — all pure/deterministic (no OpenAI call), fed into the
    // prompt as context below so the model reasons from real detected
    // patterns instead of re-deriving them from raw counts itself.
    const rootCauses = detectRootCauses(aggregate);
    const forecast = computeForecast(aggregate, history);
    const risks = detectRisks(aggregate, new Date());

    const openAiResult = await callOpenAiInsight(aggregate, { companyTrend, departments, people, rootCauses, forecast, risks });
    ({ inputTokens, outputTokens, estCostUsd } = openAiResult);
    const { result } = openAiResult;

    const now = new Date().toISOString();
    const priorLedger = ledgerRow.data ?? [];
    // §6.2 of docs/ai-insight-v2-spec.md — personNotes/deptNotes are just as
    // measurable as `actions`, so they feed the same ledger, not just the
    // 3 company-wide picks. `result.actions` itself is left untouched (still
    // shown as-is under the "ภาพรวมบริษัท" tab's action list).
    const noteActions = resolveNoteActions(aggregate, result.personNotes, result.deptNotes);
    const ledger = reconcile(priorLedger, aggregate, [...result.actions, ...noteActions], now);

    const finalState = await commitAnalysisResult(orgId, (current) => {
      // This round's own numbers become "previous" for whatever round runs
      // after this one — captured from whatever's live right before we
      // overwrite it, so the very first round ever run naturally has
      // `previous: null` (nothing to compare against yet).
      const previous =
        current.generatedAt != null
          ? {
              combinedSuccessRate: current.combinedSuccessRate,
              personTotals: Object.fromEntries(current.people.map((p) => [p.name, p.total])),
            }
          : null;
      return {
        ...current,
        generatedAt: now,
        result,
        detail: aggregate.flagged.map((g) => ({ domain: g.domain, label: g.label, count: g.count, people: g.people })),
        people,
        departments,
        combinedSuccessRate: aggregate.combinedSuccessRate,
        companyTrend,
        previous,
        ledger,
        rootCauses,
        forecast,
        risks,
        // `current.usage` ไม่ใช่ของตอนจอง (`reservation.state.usage`) — คำขอ
        // อื่นอาจจองเพิ่มระหว่างที่เรารอ OpenAI ตอบอยู่ ต้องบวก token/cost
        // ของรอบนี้ทับของล่าสุดจริง ไม่ใช่ค่าตอนจองที่อาจเก่าไปแล้ว
        usage: {
          ...current.usage,
          inputTokens: current.usage.inputTokens + inputTokens,
          outputTokens: current.usage.outputTokens + outputTokens,
          estCostUsd: current.usage.estCostUsd + estCostUsd,
        },
      };
    });

    await Promise.all([
      writeStore(orgId, HISTORY_KEY, appendSnapshot(history, snapshotFromAggregate(aggregate)), null),
      writeStore(orgId, LEDGER_KEY, ledger, null),
    ]);

    const status = await getAiInsightStatus(orgId);
    return { ok: true, status: { ...status, state: finalState } };
  } catch (err) {
    if (definitelyNeverReachedOpenAi(err)) {
      await refundQuotaSlot(orgId, reservation.reservedMonth);
    }
    // ไม่ refund (นับไปแล้ว, cost-safe) หรือ refund เสร็จแล้วก็ตาม — โยน error
    // เดิมต่อ ให้ route.ts เห็นว่ารอบนี้ล้มเหลวจริง (ไม่ใช่แกล้งตอบสำเร็จ)
    throw err;
  }
}
