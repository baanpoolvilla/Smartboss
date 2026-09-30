import { Clock } from "lucide-react";
import { STATUS_STYLE } from "../constants";
import { changeIsGood, fmtChange, fmtDateTime, fmtMetric, fmtMoney, fmtNum, fmtPct } from "../lib/format";
import { FINDING_LABEL, type FindingType, type Status } from "../lib/rules";

/** ป้ายสถานะ — สีพร้อมคำกำกับเสมอ (spec §5.3) */
export function StatusBadge({ status }: { status: Status | null | undefined }) {
  if (!status) return null;
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

/** ค่า + ป้ายสถานะในช่องตาราง — พื้นหลังช่องเป็นสีสถานะ */
export function StatusCell({
  metric,
  value,
  status,
  currency,
}: {
  metric: string;
  value: number | null | undefined;
  status: Status | null | undefined;
  currency?: string | null;
}) {
  const s = status ? STATUS_STYLE[status] : null;
  return (
    <td className="px-2 py-2 text-right" style={s ? { backgroundColor: s.bg, color: s.fg } : undefined}>
      <div className="font-medium tabular-nums">{fmtMetric(metric, value, currency)}</div>
      {s && <div className="text-[10px] font-semibold">{s.label}</div>}
    </td>
  );
}

export function ChangeText({ metric, change }: { metric: string; change: number | null | undefined }) {
  if (change == null) return null;
  const good = changeIsGood(metric, change);
  return (
    <span className={good == null ? "text-(--ink-soft)" : good ? "text-[#14532D]" : "text-[#8F1414]"}>
      {fmtChange(change)}
    </span>
  );
}

export function KpiCard({
  label,
  metric,
  value,
  status,
  change,
  currency,
}: {
  label: string;
  metric: string;
  value: number | null | undefined;
  status?: Status | null;
  change?: number | null;
  currency?: string | null;
}) {
  return (
    <div className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-3 shadow-(--shadow-card)">
      <div className="text-xs text-(--ink-soft)">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-(--ink)">{fmtMetric(metric, value, currency)}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge status={status} />
        {change != null && (
          <span>
            <ChangeText metric={metric} change={change} /> <span className="text-(--ink-soft)">จากช่วงก่อน</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** เวลาซิงค์ล่าสุด — แสดงทุกหน้า (spec §7 ฟังก์ชันร่วม) */
export function SyncStamp({ at }: { at: Date | string | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-(--ink-soft)">
      <Clock className="h-3.5 w-3.5" /> ซิงค์ล่าสุด {fmtDateTime(at)}
    </span>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 shadow-(--shadow-card) sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-(--ink)">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-(--ink-soft)">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const th = "px-2 py-2 text-right text-xs font-medium text-(--ink-soft) whitespace-nowrap";
const thL = "px-2 py-2 text-left text-xs font-medium text-(--ink-soft) whitespace-nowrap";

type KpiRow = {
  cost: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  ctr_status: Status | null;
  cpc: number | null;
  cpc_status: Status | null;
  conv_rate: number | null;
  conv_rate_status: Status | null;
  cpa: number | null;
  cpa_status: Status | null;
  top_impr_pct: number | null;
  top_impr_pct_status: Status | null;
  abs_top_impr_pct: number | null;
  abs_top_impr_pct_status: Status | null;
  low_data: boolean;
};

function KpiCells({ r, currency }: { r: KpiRow; currency?: string | null }) {
  return (
    <>
      <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(r.cost, currency)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtNum(r.clicks)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtNum(r.conversions, 2)}</td>
      <StatusCell metric="ctr" value={r.ctr} status={r.ctr_status} />
      <StatusCell metric="cpc" value={r.cpc} status={r.cpc_status} currency={currency} />
      <StatusCell metric="conv_rate" value={r.conv_rate} status={r.conv_rate_status} />
      <StatusCell metric="cpa" value={r.cpa} status={r.cpa_status} currency={currency} />
      <StatusCell metric="top_impr_pct" value={r.top_impr_pct} status={r.top_impr_pct_status} />
      <StatusCell metric="abs_top_impr_pct" value={r.abs_top_impr_pct} status={r.abs_top_impr_pct_status} />
    </>
  );
}

const KPI_HEAD = ["ค่าใช้จ่าย", "คลิก", "Conv.", "CTR", "CPC", "Conv. Rate", "CPA", "Top %", "Abs. Top %"];

export function CampaignTable({
  rows,
  currency,
}: {
  rows: (KpiRow & {
    id: string | number;
    name: string | null;
    daily_budget: number | null;
    budget_util_pct: number | null;
    budget_lost_is: number | null;
    rank_lost_is: number | null;
  })[];
  currency?: string | null;
}) {
  if (rows.length === 0) return <p className="text-sm text-(--ink-soft)">ไม่มีข้อมูลแคมเปญในช่วงนี้</p>;
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[980px] border-collapse text-sm">
        <thead className="border-b border-(--line)">
          <tr>
            <th className={thL}>แคมเปญ</th>
            <th className={th}>งบ/วัน</th>
            <th className={th}>ใช้งบ</th>
            {KPI_HEAD.map((h) => (
              <th key={h} className={th}>{h}</th>
            ))}
            <th className={th}>เสีย IS งบ</th>
            <th className={th}>เสีย IS อันดับ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={String(c.id)} className="border-b border-(--line) last:border-0">
              <td className="px-2 py-2">
                <div className="font-medium text-(--ink)">{c.name ?? c.id}</div>
                {c.low_data && <StatusBadge status="low_data" />}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(c.daily_budget, currency)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtPct(c.budget_util_pct, 1)}</td>
              <KpiCells r={c} currency={currency} />
              <td className="px-2 py-2 text-right tabular-nums">{fmtPct(c.budget_lost_is, 1)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtPct(c.rank_lost_is, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdGroupTable({
  rows,
  campaignName,
  currency,
}: {
  rows: (KpiRow & { id: string | number; campaign_id: string | number; name: string | null })[];
  campaignName: (id: string) => string | null;
  currency?: string | null;
}) {
  if (rows.length === 0) return <p className="text-sm text-(--ink-soft)">ไม่มีข้อมูลกลุ่มโฆษณาในช่วงนี้</p>;
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead className="border-b border-(--line)">
          <tr>
            <th className={thL}>กลุ่มโฆษณา</th>
            {KPI_HEAD.map((h) => (
              <th key={h} className={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={String(a.id)} className="border-b border-(--line) last:border-0">
              <td className="px-2 py-2">
                <div className="font-medium text-(--ink)">{a.name ?? a.id}</div>
                <div className="text-xs text-(--ink-soft)">{campaignName(String(a.campaign_id)) ?? ""}</div>
                {a.low_data && <StatusBadge status="low_data" />}
              </td>
              <KpiCells r={a} currency={currency} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WastedTermsTable({
  rows,
  adGroupName,
  currency,
}: {
  rows: { search_term: string; ad_group_id: string | number; clicks: number; impressions: number; cost: number }[];
  adGroupName: (id: string) => string | null;
  currency?: string | null;
}) {
  if (rows.length === 0) return <p className="text-sm text-(--ink-soft)">ไม่มีคำค้นหาที่เข้าเกณฑ์</p>;
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead className="border-b border-(--line)">
          <tr>
            <th className={thL}>คำค้นหา</th>
            <th className={thL}>กลุ่มโฆษณา</th>
            <th className={th}>คลิก</th>
            <th className={th}>Impr.</th>
            <th className={th}>ค่าใช้จ่าย</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={`${w.ad_group_id}|${w.search_term}`} className="border-b border-(--line) last:border-0">
              <td className="px-2 py-2 font-medium text-(--ink)">{w.search_term}</td>
              <td className="px-2 py-2 text-(--ink-soft)">{adGroupName(String(w.ad_group_id)) ?? w.ad_group_id}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtNum(w.clicks)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtNum(w.impressions)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(w.cost, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FindingList({
  findings,
  entityName,
}: {
  findings: { type: string; entity_type: string; entity_id: string | number; message: string }[];
  entityName: (type: string, id: string) => string | null;
}) {
  if (findings.length === 0) return <p className="text-sm text-(--ink-soft)">ไม่มีข้อสังเกต</p>;
  return (
    <ul className="flex flex-col gap-2">
      {findings.map((f, i) => (
        <li key={i} className="rounded-(--radius) border border-(--line) bg-(--bg-soft) px-3 py-2 text-sm">
          <span className="mr-2 rounded bg-(--line) px-1.5 py-0.5 text-[11px] font-semibold text-(--ink)">
            {FINDING_LABEL[f.type as FindingType] ?? f.type}
          </span>
          <span className="font-medium text-(--ink)">{entityName(f.entity_type, String(f.entity_id)) ?? f.entity_id}</span>
          <span className="text-(--ink-soft)"> — {f.message}</span>
        </li>
      ))}
    </ul>
  );
}
