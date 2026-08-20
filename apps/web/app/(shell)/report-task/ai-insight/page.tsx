"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/modules/report_task/components/ui/card";
import { Button } from "@/modules/report_task/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import { useAiInsight } from "@/modules/report_task/lib/ai-insight/use-ai-insight";
import { cn } from "@/modules/report_task/lib/utils";
import { REPORT_TASK_BASE } from "@/modules/report_task/constants";
import { ArrowLeft, Sparkles, Loader2, ChevronDown, Info } from "lucide-react";
import {
  CollapsibleList,
  ApproachToggle,
  LedgerRow,
  TrendBadge,
  InsightText,
  formatGeneratedAt,
  successRateStatus,
  ROOT_CAUSE_LABEL,
  METRIC_LABEL,
  TONE_CLASS,
  TONE_ICON_BG,
  TONE_ICON,
  SEVERITY_CLASS,
} from "@/modules/report_task/components/dashboard/ai-insight-shared";

export default function AiInsightDetailPage() {
  const router = useRouter();
  const { enabled, autoMode, setAutoMode, status, analyzing, error, runAnalysis } = useAiInsight();
  const [showKpis, setShowKpis] = useState(true);
  const [tab, setTab] = useState<"company" | "dept" | "person" | "reco">("company");

  const backButton = (
    <button
      onClick={() => router.push(REPORT_TASK_BASE)}
      className="inline-flex items-center gap-1 text-xs text-[var(--ink-soft)] hover:text-[var(--ink)] self-start"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> กลับไปแดชบอร์ด
    </button>
  );

  if (!status || !status.unlocked || !enabled) {
    return (
      <div className="flex flex-col gap-4 pt-4 lg:pt-6">
        {backButton}
        <div className="flex items-center justify-center py-24 text-[var(--ink-soft)]">
          {!status ? <Loader2 className="h-5 w-5 animate-spin" /> : <p className="text-sm">AI Insight ยังไม่พร้อมใช้งาน — กลับไปเปิดใช้งานที่แดชบอร์ด</p>}
        </div>
      </div>
    );
  }

  const result = status.state.result;

  return (
    <div className="flex flex-col gap-4 pt-4 lg:pt-6">
      {backButton}

      <Card className="overflow-hidden relative">
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
                  {analyzing ? "กำลังวิเคราะห์ข้อมูลทั้งหมด..." : "ยังไม่เคยวิเคราะห์ — กด \"วิเคราะห์ใหม่\" เพื่อเริ่ม"}
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
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3 pt-3">
          {error && <p className="text-[12px] text-[var(--chart-red-dark)]">{error}</p>}

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
                  <div className="flex gap-2 overflow-x-auto">
                    {result.stats.map((s, i) => {
                      const Icon = TONE_ICON[s.tone];
                      return (
                        <div key={i} className="flex min-w-[150px] flex-1 shrink-0 flex-col overflow-visible rounded-xl bg-[var(--bg-soft)] p-2.5 pt-3">
                          <div className="flex items-center justify-between gap-1">
                            <span className={cn("text-xl font-bold tabular-nums leading-none", TONE_CLASS[s.tone])}>{s.count}</span>
                            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", TONE_ICON_BG[s.tone])}>
                              <Icon className="h-3 w-3" />
                            </span>
                          </div>
                          <div className="mt-1.5 text-[10.5px] leading-tight text-[var(--ink-soft)]">{s.label}</div>
                          <button
                            type="button"
                            onClick={() => setTab("company")}
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

          {result && tab === "company" && (status.state.rootCauses.length > 0 || result.actions.length > 0) && (
            <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--line)] p-2.5">
              {status.state.rootCauses.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">สาเหตุที่พบ</p>
                  {status.state.rootCauses.map((c, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 mt-0.5", c.severity === "high" ? SEVERITY_CLASS.high : SEVERITY_CLASS.mid)}>
                        {ROOT_CAUSE_LABEL[c.kind]}
                      </span>
                      <span className="text-[12px] text-[var(--ink)] flex-1">{c.headline}</span>
                    </div>
                  ))}
                </div>
              )}

              {status.state.rootCauses.length > 0 && result.actions.length > 0 && <div className="border-t border-[var(--line)]" />}

              {result.actions.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">ควรทำอะไรต่อ</p>
                  {result.actions.map((a, i) => (
                    <div key={i}>
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
    </div>
  );
}
