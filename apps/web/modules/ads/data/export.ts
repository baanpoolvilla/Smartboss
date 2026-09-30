import "server-only";
import ExcelJS from "exceljs";
import { ACTION_STATUS_LABEL, IMPACT_LABEL, METRIC_LABEL, STATUS_STYLE, URGENCY_LABEL } from "../constants";
import { FINDING_LABEL, type FindingType, type Status } from "../lib/rules";
import { formatPeriod } from "../lib/periods";
import type { AiReportView } from "./ai";

/**
 * ส่งออกรายงานเป็น Excel (spec §8 /ads/export?format=xlsx)
 * ช่องที่มีสีมีคำกำกับสถานะคู่กันเสมอ (spec §5.3)
 */

const argb = (hex: string) => `FF${hex.replace("#", "")}`;

function statusCell(cell: ExcelJS.Cell, status: Status | null | undefined) {
  if (!status) return;
  const s = STATUS_STYLE[status];
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(s.bg) } };
  cell.font = { color: { argb: argb(s.fg) }, bold: true };
}

function header(ws: ExcelJS.Worksheet, cols: { header: string; key: string; width: number }[]) {
  ws.columns = cols;
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF4FE" } };
}

/** เพิ่มคอลัมน์ค่า + คอลัมน์สถานะ (มีสี) ของ KPI ที่มีเกณฑ์ */
const KPI_COLS = (["ctr", "cpc", "conv_rate", "cpa", "top_impr_pct", "abs_top_impr_pct"] as const).flatMap((m) => [
  { header: METRIC_LABEL[m]!, key: m, width: 14 },
  { header: `สถานะ ${METRIC_LABEL[m]}`, key: `${m}_status`, width: 14 },
]);

type KpiRow = Record<string, unknown>;

function addKpiRow(ws: ExcelJS.Worksheet, row: KpiRow) {
  const values: KpiRow = { ...row };
  for (const c of KPI_COLS) {
    if (c.key.endsWith("_status")) {
      const st = row[c.key] as Status | null | undefined;
      values[c.key] = st ? STATUS_STYLE[st].label : "";
    } else if (row[c.key] == null) values[c.key] = "N/A";
  }
  const added = ws.addRow(values);
  for (const c of KPI_COLS) {
    if (c.key.endsWith("_status")) statusCell(added.getCell(c.key), row[c.key] as Status | null);
  }
}

export async function reportToXlsx(r: AiReportView): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Smartboss";
  const input = r.input;
  const cur = input.account.currency ?? "";
  const nameOf = (type: string | null, id: string | number | null) => {
    if (id == null) return "บัญชี";
    const sid = String(id);
    if (type === "campaign") return input.campaigns.find((c) => String(c.id) === sid)?.name ?? sid;
    if (type === "ad_group") return input.ad_groups.find((a) => String(a.id) === sid)?.name ?? sid;
    if (type === "keyword") return input.keywords.find((k) => String(k.id) === sid)?.text ?? sid;
    return sid;
  };

  // ── สรุป ──
  const s = wb.addWorksheet("สรุป");
  s.columns = [{ width: 28 }, { width: 22 }, { width: 16 }, { width: 16 }];
  s.addRow([`รายงาน Google Ads — ${input.account.name ?? r.customerId}`]).font = { bold: true, size: 14 };
  s.addRow([`ช่วงเวลา: ${formatPeriod(r.period)}${r.compare ? ` เทียบ ${formatPeriod(r.compare)}` : ""}`]);
  s.addRow([`สกุลเงิน: ${cur}`]);
  s.addRow([]);
  s.addRow(["บทสรุปผู้บริหาร"]).font = { bold: true };
  const sum = s.addRow([r.output.executive_summary || "(ส่วนนี้ถูกซ่อนเพราะไม่ผ่านการตรวจ)"]);
  s.mergeCells(sum.number, 1, sum.number, 4);
  sum.alignment = { wrapText: true, vertical: "top" };
  sum.height = 90;
  s.addRow([]);
  const hdr = s.addRow(["ตัวชี้วัด", "ค่า", "สถานะ", "เปลี่ยนแปลง %"]);
  hdr.font = { bold: true };
  const t = input.account_totals;
  const lines: [string, unknown, Status | null | undefined, number | null | undefined][] = [
    ["ค่าใช้จ่าย", t.cost, null, t.cost_change_pct],
    ["คลิก", t.clicks, null, t.clicks_change_pct],
    ["Impressions", t.impressions, null, null],
    ["Conversions", t.conversions, null, t.conversions_change_pct],
    ["CTR (%)", t.ctr, t.ctr_status, t.ctr_change_pct],
    ["CPC", t.cpc, t.cpc_status, t.cpc_change_pct],
    ["Conversion Rate (%)", t.conv_rate, t.conv_rate_status, t.conv_rate_change_pct],
    ["CPA", t.cpa, t.cpa_status, t.cpa_change_pct],
    ["Impr. (Top) %", t.top_impr_pct, t.top_impr_pct_status, null],
    ["Impr. (Abs. Top) %", t.abs_top_impr_pct, t.abs_top_impr_pct_status, null],
    ...(t.roas != null ? ([["ROAS", t.roas, null, t.roas_change_pct]] as [string, unknown, null, number | null][]) : []),
  ];
  for (const [label, value, status, change] of lines) {
    const row = s.addRow([label, value ?? "N/A", status ? STATUS_STYLE[status].label : "", change ?? ""]);
    statusCell(row.getCell(3), status);
  }

  // ── แคมเปญ ──
  const c = wb.addWorksheet("แคมเปญ");
  header(c, [
    { header: "แคมเปญ", key: "name", width: 32 },
    { header: "สถานะแคมเปญ", key: "status", width: 12 },
    { header: "งบรายวัน", key: "daily_budget", width: 12 },
    { header: "ใช้งบ %", key: "budget_util_pct", width: 10 },
    { header: "ค่าใช้จ่าย", key: "cost", width: 12 },
    { header: "คลิก", key: "clicks", width: 10 },
    { header: "Impressions", key: "impressions", width: 12 },
    { header: "Conversions", key: "conversions", width: 12 },
    ...KPI_COLS,
    { header: "เสีย IS เพราะงบ %", key: "budget_lost_is", width: 14 },
    { header: "เสีย IS เพราะอันดับ %", key: "rank_lost_is", width: 14 },
    { header: "ข้อมูลน้อย", key: "low_data_label", width: 10 },
  ]);
  for (const x of input.campaigns) addKpiRow(c, { ...x, low_data_label: x.low_data ? "ข้อมูลน้อย" : "" });

  // ── กลุ่มโฆษณา ──
  const g = wb.addWorksheet("กลุ่มโฆษณา");
  header(g, [
    { header: "กลุ่มโฆษณา", key: "name", width: 30 },
    { header: "แคมเปญ", key: "campaign", width: 28 },
    { header: "ค่าใช้จ่าย", key: "cost", width: 12 },
    { header: "คลิก", key: "clicks", width: 10 },
    { header: "Conversions", key: "conversions", width: 12 },
    ...KPI_COLS,
    { header: "ข้อมูลน้อย", key: "low_data_label", width: 10 },
  ]);
  for (const x of input.ad_groups) {
    addKpiRow(g, { ...x, campaign: nameOf("campaign", x.campaign_id), low_data_label: x.low_data ? "ข้อมูลน้อย" : "" });
  }

  // ── คำค้นหาที่เสียเงิน ──
  const w = wb.addWorksheet("คำค้นหาที่เสียเงิน");
  header(w, [
    { header: "คำค้นหา", key: "search_term", width: 36 },
    { header: "กลุ่มโฆษณา", key: "ad_group", width: 28 },
    { header: "คลิก", key: "clicks", width: 10 },
    { header: "Impressions", key: "impressions", width: 12 },
    { header: "ค่าใช้จ่าย", key: "cost", width: 12 },
  ]);
  for (const x of input.wasted_search_terms) w.addRow({ ...x, ad_group: nameOf("ad_group", x.ad_group_id) });

  // ── ข้อสังเกตจากระบบ ──
  const f = wb.addWorksheet("ข้อสังเกตจากระบบ");
  header(f, [
    { header: "ประเภท", key: "type", width: 22 },
    { header: "เกี่ยวกับ", key: "entity", width: 30 },
    { header: "รายละเอียด", key: "message", width: 80 },
  ]);
  for (const x of input.rule_findings) {
    f.addRow({ type: FINDING_LABEL[x.type as FindingType] ?? x.type, entity: nameOf(x.entity_type, x.entity_id), message: x.message });
  }

  // ── แผนปฏิบัติการ ──
  const a = wb.addWorksheet("แผนปฏิบัติการ");
  header(a, [
    { header: "#", key: "seq", width: 5 },
    { header: "สิ่งที่ต้องทำ", key: "title", width: 40 },
    { header: "เหตุผล", key: "rationale", width: 60 },
    { header: "ผลกระทบ", key: "impact", width: 14 },
    { header: "ความเร่งด่วน", key: "urgency", width: 14 },
    { header: "เกี่ยวกับ", key: "entity", width: 28 },
    { header: "สถานะ", key: "status", width: 14 },
  ]);
  for (const x of r.actions) {
    a.addRow({
      seq: x.seq,
      title: x.title,
      rationale: x.rationale,
      impact: IMPACT_LABEL[x.impact ?? ""] ?? x.impact,
      urgency: URGENCY_LABEL[x.urgency ?? ""] ?? x.urgency,
      entity: nameOf(x.entityType, x.entityId),
      status: ACTION_STATUS_LABEL[x.status] ?? x.status,
    }).alignment = { wrapText: true, vertical: "top" };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
