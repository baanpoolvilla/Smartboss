import "server-only";
import { STATUS_STYLE } from "../constants";
import { fmtChange, fmtMetric } from "../lib/format";
import { formatPeriod } from "../lib/periods";
import type { Status } from "../lib/rules";
import { sendMail, mailConfigured } from "../lib/mailer";
import { getAiReport, type AiReportView } from "./ai";
import { loadAnalysisSettings } from "./settings";

/**
 * อีเมลสรุปรายสัปดาห์ (spec §7 หน้า 2) — KPI 4 ตัว, ประเด็นสำคัญ, สิ่งที่แนะนำ,
 * ลิงก์เปิดรายงานเต็ม · HTML แบบ inline style เพราะโปรแกรมอีเมลไม่อ่าน <style>
 *
 * ลิงก์ใช้ APP_BASE_URL (เช่น https://app.easyboss.app) — ไม่ตั้งจะไม่มีลิงก์
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function badge(status: Status | null | undefined): string {
  if (!status) return "";
  const s = STATUS_STYLE[status];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${s.bg};color:${s.fg};font-size:12px;font-weight:600">${s.label}</span>`;
}

export function reportUrl(reportId: string): string | null {
  const base = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  return base ? `${base}/ads/analysis?report=${reportId}` : null;
}

export function buildWeeklyEmail(report: AiReportView): { subject: string; html: string; text: string } {
  const t = report.input.account_totals;
  const cur = report.input.account.currency;
  const name = report.input.account.name ?? report.customerId;
  const period = formatPeriod(report.period);
  const url = reportUrl(report.id);

  const kpis: { label: string; metric: string; value: number | null; status?: Status | null; change: number | null }[] = [
    { label: "ค่าใช้จ่าย", metric: "cost", value: t.cost, change: t.cost_change_pct },
    { label: "Conversions", metric: "conversions", value: t.conversions, change: t.conversions_change_pct },
    { label: "CPA", metric: "cpa", value: t.cpa, status: t.cpa_status, change: t.cpa_change_pct },
    { label: "CTR", metric: "ctr", value: t.ctr, status: t.ctr_status, change: t.ctr_change_pct },
  ];

  const summary = report.output.executive_summary;
  const points = report.output.underperformers.slice(0, 3).map((u) => u.problem).filter(Boolean);
  const actions = report.actions.slice(0, 3);

  const kpiCells = kpis
    .map(
      (k) => `<td style="width:25%;padding:12px;border:1px solid #E5E9F0;border-radius:8px;vertical-align:top">
  <div style="font-size:12px;color:#64748B">${k.label}</div>
  <div style="font-size:20px;font-weight:700;color:#1B2537;margin:4px 0">${esc(fmtMetric(k.metric, k.value, cur))}</div>
  <div style="font-size:12px;color:#64748B">${k.change != null ? `${esc(fmtChange(k.change))} จากช่วงก่อน` : ""}</div>
  <div style="margin-top:4px">${badge(k.status)}</div>
</td>`
    )
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#F7F9FC;font-family:Tahoma,'Segoe UI',sans-serif;color:#1B2537">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">
  <div style="font-size:13px;color:#64748B">Google Ads · สรุปรายสัปดาห์</div>
  <h1 style="font-size:20px;margin:4px 0 2px">${esc(name)}</h1>
  <div style="font-size:13px;color:#64748B;margin-bottom:16px">${esc(period)}</div>
  <table role="presentation" cellspacing="6" style="width:100%;border-collapse:separate;background:#fff;border-radius:12px"><tr>${kpiCells}</tr></table>
  <h2 style="font-size:16px;margin:24px 0 8px">ประเด็นสำคัญ</h2>
  ${summary ? `<p style="font-size:14px;line-height:1.7;margin:0 0 8px">${esc(summary)}</p>` : ""}
  ${points.length ? `<ul style="font-size:14px;line-height:1.7;padding-left:20px;margin:0">${points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
  <h2 style="font-size:16px;margin:24px 0 8px">สิ่งที่แนะนำ</h2>
  ${
    actions.length
      ? `<ol style="font-size:14px;line-height:1.7;padding-left:20px;margin:0">${actions
          .map((a) => `<li><b>${esc(a.title ?? "")}</b>${a.rationale ? ` — ${esc(a.rationale)}` : ""}</li>`)
          .join("")}</ol>`
      : `<p style="font-size:14px;color:#64748B">ไม่มี</p>`
  }
  ${
    url
      ? `<p style="margin:28px 0 0"><a href="${esc(url)}" style="display:inline-block;background:#1A73E8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">เปิดรายงานเต็ม</a></p>`
      : ""
  }
</div></body></html>`;

  const text = [
    `Google Ads สรุปรายสัปดาห์ — ${name} (${period})`,
    "",
    ...kpis.map((k) => `${k.label}: ${fmtMetric(k.metric, k.value, cur)} ${k.change != null ? `(${fmtChange(k.change)})` : ""}${k.status ? ` ${STATUS_STYLE[k.status].label}` : ""}`),
    "",
    "ประเด็นสำคัญ",
    summary,
    ...points.map((p) => `- ${p}`),
    "",
    "สิ่งที่แนะนำ",
    ...actions.map((a, i) => `${i + 1}. ${a.title ?? ""}`),
    ...(url ? ["", `เปิดรายงานเต็ม: ${url}`] : []),
  ].join("\n");

  return { subject: `[Google Ads] สรุปรายสัปดาห์ ${name} · ${period}`, html, text };
}

export async function sendWeeklyEmail(orgId: string, reportId: string): Promise<{ sent: number; skipped?: string }> {
  const report = await getAiReport(orgId, reportId);
  if (!report) throw new Error("ไม่พบรายงานนี้");
  const settings = await loadAnalysisSettings(orgId, report.customerId);
  if (settings.emailRecipients.length === 0) return { sent: 0, skipped: "ยังไม่ได้ตั้งรายชื่อผู้รับอีเมล" };
  if (!mailConfigured()) return { sent: 0, skipped: "ยังไม่ได้ตั้งค่า SMTP" };
  const mail = buildWeeklyEmail(report);
  await sendMail({ to: settings.emailRecipients, ...mail });
  return { sent: settings.emailRecipients.length };
}
