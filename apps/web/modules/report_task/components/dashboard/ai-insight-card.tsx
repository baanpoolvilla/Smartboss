"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/modules/report_task/components/ui/card";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { Button } from "@/modules/report_task/components/ui/button";
import { DASHBOARD_CARD } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { useAiInsight } from "@/modules/report_task/lib/ai-insight/use-ai-insight";
import { cn } from "@/modules/report_task/lib/utils";
import { REPORT_TASK_BASE } from "@/modules/report_task/constants";
import { Sparkles, Lock, Loader2, ChevronRight } from "lucide-react";
import { InsightText, formatGeneratedAt, successRateStatus, TrendBadge } from "@/modules/report_task/components/dashboard/ai-insight-shared";

/** Dashboard widget: summary only — headline, success rate, trend, and a
 * "ดูรายละเอียด" link into the full breakdown at /report-task/ai-insight.
 * The full tabs/KPI/root-cause/forecast content used to live inline here,
 * which made the dashboard itself scroll forever; it now lives on that
 * route instead, reusing the same live data via useAiInsight(). */
export function AiInsightCard() {
  const router = useRouter();
  const { enabled, setEnabled, status, analyzing } = useAiInsight();

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
                {analyzing ? "กำลังวิเคราะห์ข้อมูลทั้งหมด..." : "ยังไม่เคยวิเคราะห์ — เข้าไปหน้ารายละเอียดเพื่อเริ่ม"}
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

      <CardContent className="pt-3">
        {/* Filled gradient (not just an outlined row) so this reads as the
            card's one real call-to-action, not a footer link — the count
            of concrete fixes below it is the hook: the headline above
            deliberately stays company-level/nameless (see SYSTEM_PROMPT's
            no-names rule), so "N ข้อควรแก้" is what pulls someone in to
            actually see who/what by name. */}
        <button
          type="button"
          onClick={() => router.push(`${REPORT_TASK_BASE}/ai-insight`)}
          className="flex w-full items-center justify-between gap-2 rounded-xl px-3.5 py-3 text-[12.5px] font-semibold text-white transition-transform hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: "linear-gradient(135deg, var(--chart-violet), var(--chart-blue))", boxShadow: "0 6px 16px -6px rgba(74,58,167,0.45)" }}
        >
          <span className="flex flex-col items-start gap-0.5 text-left">
            <span>
              {result && result.actions.length > 0
                ? `ดูว่าควรแก้อะไรก่อน · ${result.actions.length} ข้อแนะนำ`
                : "ดูรายละเอียดทั้งหมด"}
            </span>
            <span className="text-[10.5px] font-normal text-white/80">รายชื่อ สาเหตุ คำแนะนำ และพยากรณ์แบบเจาะจง</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0" />
        </button>
      </CardContent>
    </Card>
  );
}
