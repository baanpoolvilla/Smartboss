import { useState } from "react";
import { cn } from "@/modules/report_task/lib/utils";
import { AlertOctagon, Clock, TrendingUp, ArrowUp, ArrowDown, Send } from "lucide-react";
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

export interface StatusResponse {
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

export const ROOT_CAUSE_LABEL: Record<RootCauseKind, string> = {
  "systemic-topic": "ปัญหาที่หัวข้อ",
  concentration: "จุดเดียวกระทบเยอะ",
  "workload-imbalance": "งานกระจุกที่คน",
  "bottleneck-unit": "คอขวดที่แผนก",
};

export const METRIC_LABEL: Record<InsightMetricKey, string> = {
  overdue_tasks: "งานเลยกำหนด",
  pending_tasks: "งานยังไม่เสร็จ",
  late_tasks: "งานเสร็จช้า",
  missed_reports: "รายงานขาดส่ง",
  pending_reports: "รายงานยังไม่ส่ง",
  late_reports: "รายงานส่งช้า",
  open_total: "ค้างรวม",
  success_rate: "อัตราสำเร็จ",
};

export const RECO_STATUS_META: Record<RecoStatus, { label: string; emoji: string; className: string }> = {
  open: { label: "กำลังติดตาม", emoji: "➡️", className: "bg-[var(--bg-soft)] text-[var(--ink-soft)]" },
  improved: { label: "ดีขึ้น", emoji: "📈", className: "bg-green-50 text-[var(--brand-green-dark)]" },
  resolved: { label: "แก้สำเร็จ", emoji: "✅", className: "bg-green-50 text-[var(--brand-green-dark)]" },
  regressed: { label: "แย่ลง", emoji: "⚠️", className: "bg-red-50 text-[var(--chart-red-dark)]" },
};

/** §13.5 of docs/ai-insight-v2-spec.md — shows the first `initialCount` items
 * plus a "ดูเพิ่มอีก N รายการ ▾ / ย่อ ▴" toggle, so a long ledger doesn't
 * dominate the card by default. */
export function CollapsibleList<T>({
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
export function ApproachToggle({ approach }: { approach?: string[] }) {
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

export function LedgerRow({ r }: { r: AiInsightLedgerRecord }) {
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
export function TrendBadge({ trend, goodDir, suffix }: { trend: AiInsightTrend | null; goodDir: "up" | "down"; suffix: string }) {
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
export function successRateStatus(rate: number): { label: string; className: string } {
  if (rate < 30) return { label: "วิกฤต", className: "bg-red-50 text-[var(--chart-red-dark)]" };
  if (rate <= 70) return { label: "เฝ้าระวัง", className: "bg-amber-50 text-[var(--chart-amber-dark)]" };
  return { label: "ดี", className: "bg-green-50 text-[var(--brand-green-dark)]" };
}

export const TONE_CLASS: Record<"red" | "amber" | "green" | "blue", string> = {
  red: "text-[var(--chart-red-dark)]",
  amber: "text-[var(--chart-amber-dark)]",
  green: "text-[var(--brand-green-dark)]",
  blue: "text-[var(--chart-blue-dark)]",
};
export const TONE_ICON_BG: Record<"red" | "amber" | "green" | "blue", string> = {
  red: "bg-red-50 text-[var(--chart-red-dark)]",
  amber: "bg-amber-50 text-[var(--chart-amber-dark)]",
  green: "bg-green-50 text-[var(--brand-green-dark)]",
  blue: "bg-blue-50 text-[var(--chart-blue-dark)]",
};
export const TONE_ICON: Record<"red" | "amber" | "green" | "blue", typeof AlertOctagon> = {
  red: AlertOctagon,
  amber: Clock,
  green: TrendingUp,
  blue: Send,
};
export const SEVERITY_CLASS: Record<"high" | "mid" | "good", string> = {
  high: "bg-red-50 text-[var(--chart-red-dark)]",
  mid: "bg-amber-50 text-[var(--chart-amber-dark)]",
  good: "bg-green-50 text-[var(--brand-green-dark)]",
};

/** Renders the model's `**10%**`-style bold markers as real `<b>` — the
 * only markup the prompt is allowed to produce, so no need for a full
 * markdown renderer here. */
export function InsightText({ text }: { text: string }) {
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

export function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
