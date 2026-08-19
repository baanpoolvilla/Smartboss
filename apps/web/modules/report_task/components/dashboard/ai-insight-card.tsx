"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader } from "@/modules/report_task/components/ui/card";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { Button } from "@/modules/report_task/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import { DASHBOARD_CARD } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { useAiInsightSettingsStore } from "@/modules/report_task/store/ai-insight-settings-store";
import { cn } from "@/modules/report_task/lib/utils";
import { Sparkles, Lock, Loader2, AlertOctagon, Clock, TrendingUp, ChevronDown, ArrowUp, ArrowDown, Info, Send } from "lucide-react";
import type {
  AiInsightResult,
  AiInsightUsageMonth,
  AiInsightDetailGroup,
  AiInsightPersonBreakdown,
  AiInsightDeptBreakdown,
  AiInsightTrend,
  AiInsightLedgerRecord,
  AiInsightForecast,
  RootCause,
  RootCauseKind,
  RiskItem,
  InsightMetricKey,
  RecoStatus,
} from "@/modules/report_task/lib/ai-insight/types";
import type { PlanCode } from "@/modules/report_task/lib/plan";
import type { ReactNode } from "react";

interface StatusResponse {
  plan: PlanCode;
  unlocked: boolean;
  enabled: boolean;
  monthlyLimit: number;
  usage: AiInsightUsageMonth;
  quotaRemaining: number;
  state: {
    generatedAt: string | null;
    result: AiInsightResult | null;
    detail: AiInsightDetailGroup[];
    people: AiInsightPersonBreakdown[];
    departments: AiInsightDeptBreakdown[];
    combinedSuccessRate: number;
    companyTrend: AiInsightTrend | null;
    previous: { combinedSuccessRate: number; personTotals: Record<string, number> } | null;
    ledger: AiInsightLedgerRecord[];
    rootCauses: RootCause[];
    forecast: AiInsightForecast | null;
    risks: RiskItem[];
    usage: AiInsightUsageMonth;
  };
}

const ROOT_CAUSE_LABEL: Record<RootCauseKind, string> = {
  "systemic-topic": "ปัญหาที่หัวข้อ",
  concentration: "จุดเดียวกระทบเยอะ",
  "workload-imbalance": "งานกระจุกที่คน",
  "bottleneck-unit": "คอขวดที่แผนก",
};

const METRIC_LABEL: Record<InsightMetricKey, string> = {
  overdue_tasks: "งานเลยกำหนด",
  pending_tasks: "งานยังไม่เสร็จ",
  late_tasks: "งานเสร็จช้า",
  missed_reports: "รายงานขาดส่ง",
  pending_reports: "รายงานยังไม่ส่ง",
  late_reports: "รายงานส่งช้า",
  open_total: "ค้างรวม",
  success_rate: "อัตราสำเร็จ",
};

const RECO_STATUS_META: Record<RecoStatus, { label: string; emoji: string; className: string }> = {
  open: { label: "กำลังติดตาม", emoji: "➡️", className: "bg-[var(--bg-soft)] text-[var(--ink-soft)]" },
  improved: { label: "ดีขึ้น", emoji: "📈", className: "bg-green-50 text-[var(--brand-green-dark)]" },
  resolved: { label: "แก้สำเร็จ", emoji: "✅", className: "bg-green-50 text-[var(--brand-green-dark)]" },
  regressed: { label: "แย่ลง", emoji: "⚠️", className: "bg-red-50 text-[var(--chart-red-dark)]" },
};

/** §13.5 of docs/ai-insight-v2-spec.md — shows the first `initialCount` items
 * plus a "ดูเพิ่มอีก N รายการ ▾ / ย่อ ▴" toggle, so a long ledger doesn't
 * dominate the card by default. */
function CollapsibleList<T>({
  items,
  keyOf,
  renderItem,
  initialCount = 3,
}: {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  initialCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, initialCount);
  const hiddenCount = items.length - visible.length;
  return (
    <div className="flex flex-col gap-1.5">
      {visible.map((item) => (
        <div key={keyOf(item)}>{renderItem(item)}</div>
      ))}
      {hiddenCount > 0 && (
        <button type="button" onClick={() => setExpanded(true)} className="text-left text-[11px] font-semibold text-[var(--chart-violet)] hover:underline">
          ดูเพิ่มอีก {hiddenCount} รายการ ▾
        </button>
      )}
      {expanded && items.length > initialCount && (
        <button type="button" onClick={() => setExpanded(false)} className="text-left text-[11px] font-semibold text-[var(--ink-faint)] hover:underline">
          ย่อ ▴
        </button>
      )}
    </div>
  );
}

/** §15.3 of docs/ai-insight-v2-spec.md — collapsed by default so a short
 * one-line recommendation doesn't turn into a wall of text; the concrete
 * "ทำยังไง" steps are one click away for whoever actually wants them. */
function ApproachToggle({ approach }: { approach?: string[] }) {
  const [open, setOpen] = useState(false);
  if (!approach || approach.length === 0) return null;
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-left text-[10.5px] font-semibold text-[var(--chart-violet)] hover:underline">
        {open ? "ซ่อนแนวทาง ▴" : "💡 แนวทางที่ AI แนะนำ ▾"}
      </button>
      {open && (
        <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] text-[var(--ink-soft)]">
          {approach.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function LedgerRow({ r }: { r: AiInsightLedgerRecord }) {
  const meta = RECO_STATUS_META[r.status];
  const delta = r.latestValue - r.baseline;
  return (
    <div className="rounded-xl border border-[var(--line)] p-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0", SEVERITY_CLASS[r.severity])}>{r.subjectName}</span>
          <span className="truncate text-[11px] text-[var(--ink-faint)]">{METRIC_LABEL[r.metricKey]}</span>
        </div>
        <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0", meta.className)}>
          {meta.emoji} {meta.label}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-[var(--ink)]">{r.detail}</p>
      <p className="mt-1 text-[11px] text-[var(--ink-faint)] tabular-nums">
        {r.baseline} → {r.latestValue} ({delta > 0 ? "+" : ""}
        {delta})
      </p>
    </div>
  );
}

/** §13.1 of docs/ai-insight-v2-spec.md — "↑ ดีขึ้น X%" (green) / "↓ แย่ลง X%"
 * (red) / "→ เท่าเดิม" (gray), text only, no sparkline. `goodDir` is which
 * raw direction ("up" for a rate like success rate, "down" for a count like
 * a person's open total) actually reads as improvement for this subject —
 * the badge's color follows that, not the raw direction. */
function TrendBadge({ trend, goodDir, suffix }: { trend: AiInsightTrend | null; goodDir: "up" | "down"; suffix: string }) {
  if (!trend) return null;
  if (trend.dir === "flat") {
    return <span className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold text-[var(--ink-faint)]">→ เท่าเดิม</span>;
  }
  const good = trend.dir === goodDir;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[10.5px] font-semibold",
        good ? "text-[var(--brand-green-dark)]" : "text-[var(--chart-red-dark)]"
      )}
    >
      {trend.dir === "up" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {good ? "ดีขึ้น" : "แย่ลง"} {Math.abs(trend.change)}
      {suffix}
    </span>
  );
}

/** §13.2 of docs/ai-insight-v2-spec.md — one fixed threshold set, reused for
 * every success-rate badge on the card (company/dept), so "วิกฤต" always
 * means the same range everywhere instead of each spot inventing its own. */
function successRateStatus(rate: number): { label: string; className: string } {
  if (rate < 30) return { label: "วิกฤต", className: "bg-red-50 text-[var(--chart-red-dark)]" };
  if (rate <= 70) return { label: "เฝ้าระวัง", className: "bg-amber-50 text-[var(--chart-amber-dark)]" };
  return { label: "ดี", className: "bg-green-50 text-[var(--brand-green-dark)]" };
}

const TONE_CLASS: Record<"red" | "amber" | "green" | "blue", string> = {
  red: "text-[var(--chart-red-dark)]",
  amber: "text-[var(--chart-amber-dark)]",
  green: "text-[var(--brand-green-dark)]",
  blue: "text-[var(--chart-blue-dark)]",
};
const TONE_ICON_BG: Record<"red" | "amber" | "green" | "blue", string> = {
  red: "bg-red-50 text-[var(--chart-red-dark)]",
  amber: "bg-amber-50 text-[var(--chart-amber-dark)]",
  green: "bg-green-50 text-[var(--brand-green-dark)]",
  blue: "bg-blue-50 text-[var(--chart-blue-dark)]",
};
const TONE_ICON: Record<"red" | "amber" | "green" | "blue", typeof AlertOctagon> = {
  red: AlertOctagon,
  amber: Clock,
  green: TrendingUp,
  blue: Send,
};
const SEVERITY_CLASS: Record<"high" | "mid" | "good", string> = {
  high: "bg-red-50 text-[var(--chart-red-dark)]",
  mid: "bg-amber-50 text-[var(--chart-amber-dark)]",
  good: "bg-green-50 text-[var(--brand-green-dark)]",
};

/** Renders the model's `**10%**`-style bold markers as real `<b>` — the
 * only markup the prompt is allowed to produce, so no need for a full
 * markdown renderer here. */
function InsightText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <b key={i} className="text-[var(--chart-violet)] font-semibold">
            {part.slice(2, -2)}
          </b>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** How old the cached result needs to be before "ออโต้" mode refreshes it on
 * someone's next visit — there's no real server cron behind this (see
 * ai-insight-settings-store.ts), so "roughly once a day" is approximated as
 * "stale past 20h" checked whenever anyone has the dashboard open, same
 * piggyback pattern as the deadline-reminder sweep. */
const STALE_MS = 20 * 60 * 60 * 1000;

export function AiInsightCard() {
  const enabled = useAiInsightSettingsStore((s) => s.settings.enabled);
  const setEnabled = useAiInsightSettingsStore((s) => s.setEnabled);
  const autoMode = useAiInsightSettingsStore((s) => s.settings.autoMode);
  const setAutoMode = useAiInsightSettingsStore((s) => s.setAutoMode);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showKpis, setShowKpis] = useState(true);
  const [tab, setTab] = useState<"company" | "dept" | "person" | "reco">("company");
  const autoTriedRef = useRef(false);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/report-task/ai-insight");
    if (!res.ok) return;
    const data = (await res.json()) as StatusResponse;
    setStatus(data);
    return data;
  }, []);

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/report-task/ai-insight", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "วิเคราะห์ไม่สำเร็จ");
        await loadStatus();
        return;
      }
      setStatus(data as StatusResponse);
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    } finally {
      setAnalyzing(false);
    }
  }, [loadStatus]);

  useEffect(() => {
    // Fetch-on-mount, not "derive state from props" — the pattern the
    // set-state-in-effect rule is meant to catch. Nothing to derive here
    // synchronously; the status genuinely only exists server-side.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus();
  }, [loadStatus]);

  // "ออโต้" mode: refresh once per visit if there's no result yet, or the
  // cached one is past STALE_MS — "manual" mode never auto-triggers, only
  // the "วิเคราะห์ใหม่" button does (still bounded by quota either way).
  // Runs at most once per mount (autoTriedRef), not on a timer — see
  // STALE_MS's own comment on why this approximates "daily" rather than
  // guaranteeing it.
  useEffect(() => {
    if (autoTriedRef.current || !status) return;
    if (!status.unlocked || !status.enabled || autoMode !== "auto" || status.quotaRemaining <= 0) return;
    const stale = !status.state.generatedAt || Date.now() - new Date(status.state.generatedAt).getTime() > STALE_MS;
    if (stale) {
      autoTriedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void runAnalysis();
    }
  }, [status, autoMode, runAnalysis]);

  if (!status) {
    return (
      <Card className={cn(DASHBOARD_CARD, "h-full")}>
        <CardContent className="flex items-center justify-center py-16 text-[var(--ink-soft)]">
          <Loader2 className="h-5 w-5 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  // ── Locked: plan below Pro ──────────────────────────────────────────
  if (!status.unlocked) {
    return (
      <Card className={cn(DASHBOARD_CARD, "h-full relative overflow-hidden")}>
        <CardContent className="py-10 px-6 flex flex-col items-center text-center gap-3">
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center"
            style={{ background: "color-mix(in srgb, var(--chart-violet) 12%, var(--bg))", color: "var(--chart-violet)" }}
          >
            <Lock className="h-4.5 w-4.5" />
          </div>
          <p className="text-sm font-semibold">ให้ AI ช่วยจับตาแนวโน้มทั้งบริษัท</p>
          <p className="text-[12.5px] text-[var(--ink-soft)] max-w-[42ch]">
            วิเคราะห์งาน/รายงานอัตโนมัติ สรุปว่าใครควรตามงาน แผนกไหนแนวโน้มแย่ลง พร้อมคำแนะนำ — อยู่ในแพ็กเกจ Pro ขึ้นไป
          </p>
          <Button
            size="sm"
            className="mt-1 text-white"
            style={{ background: "linear-gradient(135deg, var(--chart-violet), var(--chart-blue))" }}
          >
            ดูแพ็กเกจ Pro
          </Button>
        </CardContent>
      </Card>
    );
  }

  const headerSwitch = (
    <div className="flex items-center gap-2">
      <Switch
        checked={enabled}
        onCheckedChange={(v) => setEnabled(v)}
        aria-label="เปิด/ปิด AI Insight"
      />
      <span className="text-[11px] font-medium text-[var(--ink-soft)]">{enabled ? "เปิดใช้งาน" : "ปิดอยู่"}</span>
    </div>
  );

  // ── Off: unlocked but switched off ──────────────────────────────────
  if (!enabled) {
    return (
      <Card className={cn(DASHBOARD_CARD, "h-full")}>
        <CardContent className="p-4">
          <div
            className="flex items-center gap-3 rounded-xl border border-dashed p-3"
            style={{ borderColor: "color-mix(in srgb, var(--chart-violet) 25%, var(--line))", background: "var(--bg-soft)" }}
          >
            <div className="h-8 w-8 rounded-full flex items-center justify-center bg-[var(--bg)] border border-[var(--line)] text-[var(--ink-faint)] shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">AI Insight</span>
              </div>
              <p className="text-[11.5px] text-[var(--ink-faint)]">ปิดการวิเคราะห์ AI อยู่ · เปิดสวิตช์เพื่อดูสรุปแนวโน้ม (ไม่กินโควตาขณะปิด)</p>
            </div>
            {headerSwitch}
          </div>
        </CardContent>
      </Card>
    );
  }

  const result = status.state.result;

  return (
    <Card className={cn(DASHBOARD_CARD, "h-full overflow-hidden relative")}>
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "linear-gradient(90deg, var(--chart-violet), var(--chart-blue))" }} />
      <CardHeader className="pb-0">
        <div
          className="flex items-start gap-3 rounded-xl border p-3"
          style={{
            background: "linear-gradient(135deg, color-mix(in srgb, var(--chart-violet) 8%, var(--bg)) 0%, var(--bg) 65%)",
            borderColor: "color-mix(in srgb, var(--chart-violet) 20%, var(--line))",
          }}
        >
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, var(--chart-violet), var(--chart-blue))", boxShadow: "0 4px 10px -3px rgba(74,58,167,0.5)" }}
          >
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-sm font-semibold">AI Insight</span>
              <span
                className="text-[10px] font-bold text-white rounded-full px-2 py-0.5"
                style={{ background: "linear-gradient(135deg, var(--chart-violet), var(--chart-blue))" }}
              >
                PRO
              </span>
            </div>
            {result ? (
              <p className="text-[13px] leading-relaxed">
                <InsightText text={result.insightText} />
              </p>
            ) : (
              <p className="text-[12.5px] text-[var(--ink-soft)]">
                {analyzing ? "กำลังวิเคราะห์ข้อมูลทั้งหมด..." : "ยังไม่เคยวิเคราะห์ — กด \"วิเคราะห์ตอนนี้\" เพื่อเริ่ม"}
              </p>
            )}
            {result && (
              <p className="text-[11.5px] mt-1 flex items-center gap-1.5 flex-wrap">
                <span className="font-bold tabular-nums text-[var(--ink)]">{status.state.combinedSuccessRate}% สำเร็จรวม</span>
                <span className={cn("text-[10px] font-semibold rounded-full px-1.5 py-0.5", successRateStatus(status.state.combinedSuccessRate).className)}>
                  {successRateStatus(status.state.combinedSuccessRate).label}
                </span>
                {status.state.companyTrend ? (
                  <>
                    <TrendBadge trend={status.state.companyTrend} goodDir="up" suffix="%" />
                    <span className="text-[var(--ink-faint)]">จากช่วงก่อนหน้า</span>
                  </>
                ) : (
                  <span className="text-[var(--ink-faint)]">ยังไม่มีข้อมูลพอเทียบเทรนด์ (ต้องวิเคราะห์อีก 1-2 รอบ)</span>
                )}
              </p>
            )}
            {status.state.generatedAt && (
              <p className="text-[10.5px] text-[var(--ink-faint)] mt-0.5">อัปเดตล่าสุด {formatGeneratedAt(status.state.generatedAt)}</p>
            )}
          </div>
          {headerSwitch}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-3">
        {error && <p className="text-[12px] text-[var(--chart-red-dark)]">{error}</p>}

        {/* §13.3 of docs/ai-insight-v2-spec.md — one bordered container,
            4 compact cards in a row (2×2 under 640px). Each card: big number
            top-left, tone icon in a circle top-right, label below, and a
            full-width outlined "ดูรายละเอียด" button that jumps to the
            existing "ดูรายละเอียดทั้งหมด" breakdown further down the card
            (deterministic — `stats` itself is server-computed, see
            aggregate.ts's buildFixedStats, not model output). */}
        {result && result.stats.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setShowKpis((v) => !v)}
              className="flex items-center gap-1 self-start text-[11.5px] font-semibold text-[var(--chart-violet)] hover:underline"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showKpis && "rotate-180")} />
              {showKpis ? "ซ่อน KPI" : "แสดง KPI"}
            </button>
            {showKpis && (
              <div className="overflow-visible rounded-2xl border border-[var(--line)] p-2">
                <div className="grid grid-cols-2 @sm:grid-cols-4 gap-2">
                  {result.stats.map((s, i) => {
                    const Icon = TONE_ICON[s.tone];
                    return (
                      <div key={i} className="flex flex-col overflow-visible rounded-xl bg-[var(--bg-soft)] p-2.5 pt-3">
                        {/* items-center (not items-start) — the badge circle is a
                            fixed h-6 box, but the number's own line-box (large
                            font, leading-none) can render taller/shorter than 24px
                            depending on the font's metrics; items-start pinned
                            both to the row's top edge and let the badge's circle
                            get visually cut by the number's line-box on some
                            fonts/zoom levels. Centering keeps the badge a full,
                            uncut circle regardless. */}
                        <div className="flex items-center justify-between gap-1">
                          <span className={cn("text-xl font-bold tabular-nums leading-none", TONE_CLASS[s.tone])}>{s.count}</span>
                          <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", TONE_ICON_BG[s.tone])}>
                            <Icon className="h-3 w-3" />
                          </span>
                        </div>
                        <div className="mt-1.5 text-[10.5px] leading-tight text-[var(--ink-soft)]">{s.label}</div>
                        <button
                          type="button"
                          onClick={() => {
                            setTab("company");
                            setShowDetail(true);
                          }}
                          className="mt-2 w-full rounded-lg border border-[var(--line)] py-1 text-[10.5px] font-semibold text-[var(--ink-soft)] transition-colors hover:border-[var(--chart-violet)] hover:text-[var(--chart-violet)]"
                        >
                          ดูรายละเอียด
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="flex items-center gap-1 border-b border-[var(--line)]">
            {(
              [
                ["company", "ภาพรวมบริษัท", null],
                ["dept", "รายแผนก", status.state.departments.length],
                ["person", "รายคน", status.state.people.length],
                ["reco", "ผลของคำแนะนำ", status.state.ledger.length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "px-2.5 py-2 text-[12px] font-semibold border-b-2 -mb-px transition-colors",
                  tab === key ? "border-[var(--chart-violet)] text-[var(--chart-violet)]" : "border-transparent text-[var(--ink-soft)] hover:text-[var(--ink)]"
                )}
              >
                {label}
                {count != null && <span className="ml-1 text-[10px] text-[var(--ink-faint)]">{count}</span>}
              </button>
            ))}
          </div>
        )}

        {result && tab === "dept" && (
          <div className="flex flex-col gap-2">
            {status.state.departments.length === 0 ? (
              <p className="text-[12px] text-[var(--ink-faint)] text-center py-6">ไม่มีแผนกที่มีปัญหาค้างอยู่ในรอบนี้</p>
            ) : (
              <CollapsibleList
                items={status.state.departments}
                keyOf={(d) => d.departmentId}
                renderItem={(d) => {
                  const note = result.deptNotes.find((n) => n.name === d.name);
                  const status_ = successRateStatus(d.successRate);
                  return (
                    <div className="rounded-xl border border-[var(--line)] p-2.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12.5px] font-semibold text-[var(--ink)]">{d.name}</span>
                          <span className="text-[10px] text-[var(--ink-faint)]">{d.headcount} คน</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5", status_.className)}>{status_.label}</span>
                          <span className="text-[13px] font-bold tabular-nums text-[var(--ink)]">{d.successRate}%</span>
                          <TrendBadge trend={d.trend} goodDir="up" suffix="pp" />
                        </div>
                      </div>
                      {d.topIssues.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {d.topIssues.map((it, k) => (
                            <span
                              key={k}
                              className={cn(
                                "text-[10px] font-medium rounded-full px-2 py-0.5",
                                it.domain === "task"
                                  ? "bg-[color-mix(in_srgb,var(--chart-blue)_10%,white)] text-[var(--chart-blue)]"
                                  : "bg-[color-mix(in_srgb,var(--chart-violet)_10%,white)] text-[var(--chart-violet)]"
                              )}
                            >
                              {it.label} {it.count}
                            </span>
                          ))}
                        </div>
                      )}
                      {note && (
                        <>
                          <p className="mt-1.5 text-[11.5px] text-[var(--ink)] flex items-start gap-1">
                            <span className="text-[var(--chart-violet)] font-bold shrink-0">→</span> {note.note}
                          </p>
                          <ApproachToggle approach={note.approach} />
                        </>
                      )}
                    </div>
                  );
                }}
              />
            )}
          </div>
        )}

        {result && tab === "person" && (
          <div className="flex flex-col gap-2">
            {status.state.people.length === 0 ? (
              <p className="text-[12px] text-[var(--ink-faint)] text-center py-6">ไม่มีใครมีปัญหาค้างอยู่ในรอบนี้</p>
            ) : (
              <CollapsibleList
                items={status.state.people}
                keyOf={(p) => p.name}
                renderItem={(p) => {
                  const note = result.personNotes.find((n) => n.name === p.name);
                  return (
                    <div className="rounded-xl border border-[var(--line)] p-2.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[12.5px] font-semibold text-[var(--ink)]">{p.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-bold tabular-nums text-[var(--ink)]">{p.total} รายการ</span>
                          {p.trend ? <TrendBadge trend={p.trend} goodDir="down" suffix="%" /> : <span className="text-[10px] text-[var(--ink-faint)]">รอบแรก</span>}
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.items.map((it, k) => (
                          <span
                            key={k}
                            className={cn(
                              "text-[10px] font-medium rounded-full px-2 py-0.5",
                              it.domain === "task"
                                ? "bg-[color-mix(in_srgb,var(--chart-blue)_10%,white)] text-[var(--chart-blue)]"
                                : "bg-[color-mix(in_srgb,var(--chart-violet)_10%,white)] text-[var(--chart-violet)]"
                            )}
                          >
                            {it.label} {it.count}
                          </span>
                        ))}
                      </div>
                      {note && (
                        <>
                          <p className="mt-1.5 text-[11.5px] text-[var(--ink)] flex items-start gap-1">
                            <span className="text-[var(--chart-violet)] font-bold shrink-0">→</span> {note.priority}
                          </p>
                          <ApproachToggle approach={note.approach} />
                        </>
                      )}
                    </div>
                  );
                }}
              />
            )}
          </div>
        )}

        {/* §16 analyzer output — deterministic, computed alongside the
            aggregate (see aggregate.ts's analyzers/), never asked of the
            model. "ทำไมถึงเกิด" before "ควรทำอะไรต่อ" (actions, below). */}
        {result && tab === "company" && status.state.rootCauses.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">สาเหตุที่พบ</p>
            {status.state.rootCauses.map((c, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-[var(--line)] px-2.5 py-2">
                <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 mt-0.5", c.severity === "high" ? SEVERITY_CLASS.high : SEVERITY_CLASS.mid)}>
                  {ROOT_CAUSE_LABEL[c.kind]}
                </span>
                <span className="text-[12px] text-[var(--ink)] flex-1">{c.headline}</span>
              </div>
            ))}
          </div>
        )}

        {result && tab === "company" && status.state.forecast && (
          <div className="rounded-lg border border-[var(--line)] px-2.5 py-2 text-[11.5px] text-[var(--ink)]">
            <span className="font-semibold text-[var(--chart-violet)]">พยากรณ์: </span>
            ถ้าไม่แก้อะไรเลย อีก 2 สัปดาห์อัตราสำเร็จจะอยู่ที่ราว <b className="tabular-nums">{status.state.forecast.doNothingRate}%</b>, ถ้าแก้ปัญหาอันดับ 1 ได้จะขึ้นเป็น{" "}
            <b className="tabular-nums">{status.state.forecast.ifPlanRate}%</b>
            {status.state.forecast.clearByDays != null && (
              <>
                {" "}
                · เคลียร์งานค้างหมดใน ~<b className="tabular-nums">{status.state.forecast.clearByDays}</b> วันถ้าอัตราเท่าเดิม
              </>
            )}
            {status.state.forecast.confidence === "low" && <span className="text-[var(--ink-faint)]"> (ข้อมูลย้อนหลังยังน้อย ความเชื่อมั่นต่ำ)</span>}
          </div>
        )}

        {result && tab === "company" && status.state.risks.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">ใกล้เลยกำหนดใน 48 ชม.</p>
            <CollapsibleList
              items={status.state.risks}
              keyOf={(r) => `${r.kind}-${r.name}`}
              renderItem={(r) => (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[12px]">
                  <span className="truncate text-[var(--ink)]">
                    {r.kind === "task" ? "📋" : "📝"} {r.name}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-[var(--ink-faint)] tabular-nums">
                    {r.count > 1 ? `${r.count} รายการ · ` : ""}เหลือ {r.dueInDays} วัน
                  </span>
                </div>
              )}
            />
          </div>
        )}

        {result && tab === "company" && result.actions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">สรุปสิ่งที่ควรทำก่อนระดับบริษัท</p>
            {result.actions.map((a, i) => (
              <div key={i} className="rounded-lg border border-[var(--line)] px-2.5 py-2">
                <div className="flex items-start gap-2">
                  <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 mt-0.5", SEVERITY_CLASS[a.severity])}>
                    {a.subjectName} · {METRIC_LABEL[a.metricKey]}
                  </span>
                  <span className="text-[12px] text-[var(--ink)] flex-1">{a.detail}</span>
                </div>
                <ApproachToggle approach={a.approach} />
              </div>
            ))}
          </div>
        )}

        {result && tab === "reco" && (
          <div className="flex flex-col gap-3">
            {status.state.ledger.length === 0 ? (
              <p className="text-[12px] text-[var(--ink-faint)] text-center py-6">
                ยังไม่มีคำแนะนำที่ติดตามผล — จะเริ่มเก็บหลังวิเคราะห์รอบถัดไปที่ AI ให้คำแนะนำ
              </p>
            ) : (
              <>
                {status.state.ledger.filter((r) => r.status !== "resolved").length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">กำลังติดตาม</p>
                    <CollapsibleList
                      items={status.state.ledger.filter((r) => r.status !== "resolved")}
                      keyOf={(r) => r.id}
                      renderItem={(r) => <LedgerRow r={r} />}
                    />
                  </div>
                )}
                {status.state.ledger.filter((r) => r.status === "resolved").length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">แก้สำเร็จแล้ว</p>
                    <CollapsibleList
                      items={status.state.ledger.filter((r) => r.status === "resolved")}
                      keyOf={(r) => r.id}
                      renderItem={(r) => <LedgerRow r={r} />}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {result && tab === "company" && status.state.detail.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="flex items-center gap-1 text-[11.5px] font-semibold text-[var(--chart-violet)] hover:underline"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showDetail && "rotate-180")} />
              {showDetail ? "ซ่อนรายละเอียด" : "ดูรายละเอียดทั้งหมด"}
            </button>
            {showDetail && (
              <div className="mt-2 flex flex-col gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg-soft)] p-3">
                {status.state.detail.map((g, i) => {
                  const max = g.people[0]?.count || 1;
                  return (
                    <div key={i} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span className="font-semibold text-[var(--ink)]">
                          <span className={cn("mr-1.5 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold", g.domain === "task" ? "bg-[color-mix(in_srgb,var(--chart-blue)_14%,white)] text-[var(--chart-blue)]" : "bg-[color-mix(in_srgb,var(--chart-violet)_14%,white)] text-[var(--chart-violet)]")}>
                            {g.domain === "task" ? "งาน" : "รายงาน"}
                          </span>
                          {g.label}
                        </span>
                        <span className="font-bold text-[var(--ink)] tabular-nums">{g.count} รายการ</span>
                      </div>
                      {g.people.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {g.people.map((p, j) => (
                            <div key={j} className="flex items-center gap-2">
                              <span className="w-24 shrink-0 truncate text-[11px] text-[var(--ink-soft)]">{p.name}</span>
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg)]">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${(p.count / max) * 100}%`, background: "linear-gradient(90deg, var(--chart-violet), var(--chart-blue))" }}
                                />
                              </div>
                              <span className="w-6 shrink-0 text-right text-[11px] font-semibold tabular-nums text-[var(--ink)]">{p.count}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-[var(--ink-faint)]">ไม่ระบุตัวบุคคล</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--line)] flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 rounded-full bg-[var(--bg-soft)] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${status.monthlyLimit ? Math.min(100, (status.usage.count / status.monthlyLimit) * 100) : 0}%`,
                  background: "linear-gradient(90deg, var(--chart-violet), var(--chart-blue))",
                }}
              />
            </div>
            <span className="text-[11px] text-[var(--ink-faint)]">
              ใช้ไปแล้ว {status.usage.count}/{status.monthlyLimit} ครั้งเดือนนี้
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button type="button" className="text-[var(--ink-faint)] hover:text-[var(--ink-soft)]" aria-label="วิเคราะห์แบบไหนเปลืองโควตายังไง">
                    <Info className="h-3 w-3" />
                  </button>
                }
              />
              <TooltipContent className="max-w-[260px]">
                <b>ออโต้</b> — วิเคราะห์ใหม่เองเมื่อผลเก่าเกิน 20 ชม. แล้วมีคนเปิดหน้านี้ (ยังไม่ใช่ตั้งเวลาแม่นยำระดับนาทีทุกวัน) กินโควตาเหมือนกดเอง 1 ครั้งต่อรอบ
                <br />
                <b>ทำเอง</b> — ไม่มีการวิเคราะห์อัตโนมัติเลย ต้องกด &quot;วิเคราะห์ใหม่&quot; ทุกครั้งที่ต้องการผลใหม่
                <br />
                แพ็กเกจ <b>{status.plan}</b> ของบริษัทนี้วิเคราะห์ได้ {status.monthlyLimit} ครั้ง/เดือน ไม่ว่าจะเป็นออโต้หรือกดเอง
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex rounded-lg border border-[var(--line)] p-0.5 text-[10.5px] font-semibold">
              <button
                type="button"
                onClick={() => setAutoMode("auto")}
                className={cn(
                  "rounded-md px-2 py-1 transition-colors",
                  autoMode === "auto" ? "bg-[var(--chart-violet)] text-white" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                )}
              >
                ออโต้
              </button>
              <button
                type="button"
                onClick={() => setAutoMode("manual")}
                className={cn(
                  "rounded-md px-2 py-1 transition-colors",
                  autoMode === "manual" ? "bg-[var(--chart-violet)] text-white" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                )}
              >
                ทำเอง
              </button>
            </div>
            <Button size="sm" variant="outline" disabled={analyzing || status.quotaRemaining <= 0} onClick={() => void runAnalysis()} className="h-7 text-xs">
              {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status.quotaRemaining <= 0 ? "ใช้ครบโควตาแล้ว" : "วิเคราะห์ใหม่"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
