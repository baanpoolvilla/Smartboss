import { TriangleAlert } from "lucide-react";
import { ACTION_STATUS_LABEL, IMPACT_LABEL, URGENCY_LABEL } from "../constants";
import { fmtDateTime } from "../lib/format";
import { formatPeriod } from "../lib/periods";
import type { AiReportView } from "../data/ai";
import { ActionStatusSelect, AskAi } from "./ai-controls";
import { AdGroupTable, CampaignTable, FindingList, KpiCard, Section } from "./ui";

const SECTION_LABEL: Record<string, string> = {
  executive_summary: "บทสรุปผู้บริหาร",
  top_performers: "ผลงานดี",
  underperformers: "ต้องปรับปรุง",
  actions: "แผนปฏิบัติการ",
};

/**
 * รายงาน AI หนึ่งฉบับ (spec §7 หน้า 3) — แสดงจาก input_json/output_json ที่เก็บไว้
 * ตัวเลขจึงเป็นภาพ ณ เวลาที่วิเคราะห์ ไม่เปลี่ยนตามข้อมูลที่ซิงค์เข้ามาทีหลัง
 * interactive = false ใช้กับหน้าพิมพ์ PDF (ไม่มีช่องถาม AI และตัวเลือกสถานะ)
 */
export function ReportView({ report, interactive }: { report: AiReportView; interactive: boolean }) {
  const { input, output } = report;
  const cur = input.account.currency;
  const t = input.account_totals;

  const campaignName = (id: string) => input.campaigns.find((c) => String(c.id) === id)?.name ?? null;
  const entityName = (type: string | null, id: string | number | null): string => {
    if (id == null || type === "account") return "ทั้งบัญชี";
    const sid = String(id);
    if (type === "campaign") return campaignName(sid) ?? sid;
    if (type === "ad_group") return input.ad_groups.find((a) => String(a.id) === sid)?.name ?? sid;
    if (type === "keyword") return input.keywords.find((k) => String(k.id) === sid)?.text ?? sid;
    return sid;
  };
  const hidden = output.validation?.hidden ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs text-(--ink-soft)">
        {input.account.name} · {formatPeriod(report.period)}
        {report.compare ? ` เทียบ ${formatPeriod(report.compare)}` : ""} · วิเคราะห์เมื่อ {fmtDateTime(report.createdAt)}
        {report.createdBy === "schedule" ? " (ตามตารางเวลา)" : ""} · {report.model} · prompt v{report.promptVersion}
      </div>

      {hidden.length > 0 && (
        <div className="flex gap-2 rounded-(--radius) border border-[#F8CFCB] bg-[#FEF4F3] p-3 text-sm text-[#8F1414]">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">ซ่อนบางส่วนของรายงาน เพราะคำตอบ AI ไม่ผ่านการตรวจแม้ให้แก้แล้ว 1 รอบ</div>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {hidden.map((h, i) => (
                <li key={i}>
                  {SECTION_LABEL[h.section] ?? h.section}: {h.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Section title="บทสรุปผู้บริหาร">
        {output.executive_summary ? (
          <p className="text-sm leading-7 text-(--ink)">{output.executive_summary}</p>
        ) : (
          <p className="text-sm text-(--ink-soft)">ส่วนนี้ถูกซ่อน (ดูเหตุผลด้านบน)</p>
        )}
      </Section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="ค่าใช้จ่าย" metric="cost" value={t.cost} change={t.cost_change_pct} currency={cur} />
        <KpiCard label="Conversions" metric="conversions" value={t.conversions} change={t.conversions_change_pct} />
        <KpiCard label="CPA" metric="cpa" value={t.cpa} status={t.cpa_status} change={t.cpa_change_pct} currency={cur} />
        <KpiCard label="CTR" metric="ctr" value={t.ctr} status={t.ctr_status} change={t.ctr_change_pct} />
        <KpiCard label="CPC" metric="cpc" value={t.cpc} status={t.cpc_status} change={t.cpc_change_pct} currency={cur} />
        <KpiCard label="Conversion Rate" metric="conv_rate" value={t.conv_rate} status={t.conv_rate_status} change={t.conv_rate_change_pct} />
        <KpiCard label="Impr. (Top) %" metric="top_impr_pct" value={t.top_impr_pct} status={t.top_impr_pct_status} />
        <KpiCard label="Impr. (Abs. Top) %" metric="abs_top_impr_pct" value={t.abs_top_impr_pct} status={t.abs_top_impr_pct_status} />
        {t.roas != null && <KpiCard label="ROAS" metric="roas" value={t.roas} change={t.roas_change_pct} />}
      </div>

      {(output.top_performers.length > 0 || output.underperformers.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Section title="ผลงานดี">
            <ul className="flex flex-col gap-2 text-sm">
              {output.top_performers.map((p, i) => (
                <li key={i}>
                  <span className="font-medium text-(--ink)">{entityName(p.entity_type, p.entity_id)}</span>
                  <span className="text-(--ink-soft)"> — {p.reason}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="ต้องปรับปรุง">
            <ul className="flex flex-col gap-2 text-sm">
              {output.underperformers.map((u, i) => (
                <li key={i}>
                  <div className="font-medium text-(--ink)">{entityName(u.entity_type, u.entity_id)}</div>
                  <div className="text-(--ink-soft)">{u.problem}</div>
                  <div className="text-(--ink)">→ {u.recommendation}</div>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      <Section title="แคมเปญ">
        <CampaignTable rows={input.campaigns} currency={cur} />
      </Section>

      <Section title="กลุ่มโฆษณา" description={input.ad_groups.length >= 50 ? "แสดง 50 กลุ่มที่ใช้เงินมากที่สุด" : undefined}>
        <AdGroupTable rows={input.ad_groups} campaignName={campaignName} currency={cur} />
      </Section>

      <Section title="ข้อสังเกตจากระบบ" description="คำนวณจากกฎตรวจสอบก่อนส่งให้ AI">
        <FindingList findings={input.rule_findings} entityName={(type, id) => entityName(type, id)} />
      </Section>

      {output.previous_actions_review.length > 0 && (
        <Section title="ผลของสิ่งที่ทำไปแล้ว">
          <ul className="flex flex-col gap-2 text-sm">
            {output.previous_actions_review.map((p, i) => (
              <li key={i}>
                <span className="font-medium text-(--ink)">{p.title}</span>
                <span className="text-(--ink-soft)"> — {p.result}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="แผนปฏิบัติการ">
        {report.actions.length === 0 ? (
          <p className="text-sm text-(--ink-soft)">ไม่มี</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {report.actions.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 border-b border-(--line) pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-(--ink)">
                    {a.seq}. {a.title}
                  </div>
                  <div className="text-sm text-(--ink-soft)">{a.rationale}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded bg-(--bg-soft) px-1.5 py-0.5">{URGENCY_LABEL[a.urgency ?? ""] ?? a.urgency}</span>
                    <span className="rounded bg-(--bg-soft) px-1.5 py-0.5">{IMPACT_LABEL[a.impact ?? ""] ?? a.impact}</span>
                    <span className="rounded bg-(--bg-soft) px-1.5 py-0.5">{entityName(a.entityType, a.entityId)}</span>
                  </div>
                </div>
                <div className="shrink-0">
                  {interactive ? (
                    <ActionStatusSelect actionId={a.id} status={a.status} />
                  ) : (
                    <span className="text-xs text-(--ink-soft)">{ACTION_STATUS_LABEL[a.status] ?? a.status}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {interactive && (
        <Section title="ถาม AI เกี่ยวกับรายงานนี้" description="AI ตอบจากข้อมูลในรายงานนี้เท่านั้น ไม่เข้าถึงฐานข้อมูลโดยตรง">
          <AskAi reportId={report.id} />
        </Section>
      )}
    </div>
  );
}
