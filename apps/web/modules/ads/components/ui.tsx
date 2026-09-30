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
    <td
      className="border-l-2 border-(--bg) px-3 py-3 text-right align-middle"
      style={s ? { backgroundColor: s.bg, color: s.fg } : undefined}
    >
      <div className="text-[15px] font-semibold tabular-nums">{fmtMetric(metric, value, currency)}</div>
      {s && <div className="mt-0.5 text-[11px] font-semibold">{s.label}</div>}
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
  // การ์ดที่มีเกณฑ์ ทั้งใบเป็นสีสถานะ (spec §5.3) พร้อมป้ายคำกำกับมุมขวาบนเสมอ
  // การ์ดที่ไม่มีเกณฑ์ (ค่าใช้จ่าย / Conversions) เป็นพื้นขาวตามปกติ
  const s = status ? STATUS_STYLE[status] : null;
  return (
    <div
      className="rounded-(--radius-lg) border p-4 shadow-(--shadow-card)"
      style={s ? { backgroundColor: s.bg, borderColor: s.bg, color: s.fg } : { backgroundColor: "var(--bg)", borderColor: "var(--line)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`text-sm font-medium ${s ? "" : "text-(--ink-soft)"}`}>{label}</div>
        {s && (
          <span className="whitespace-nowrap rounded-full bg-white/60 px-2 py-0.5 text-xs font-bold">{s.label}</span>
        )}
      </div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${s ? "" : "text-(--ink)"}`}>
        {fmtMetric(metric, value, currency)}
      </div>
      {change != null && (
        <div className="mt-1 text-[13px] font-medium">
          <ChangeText metric={metric} change={change} />{" "}
          <span className={s ? "opacity-80" : "text-(--ink-soft)"}>จากช่วงก่อน</span>
        </div>
      )}
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
          <h2 className="text-base font-bold text-(--ink)">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-(--ink-soft)">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ─── ตาราง ─────────────────────────────────────────────────────────────────
// ตัวอักษร 15px ระยะห่างกว้าง หัวตารางเข้ม คอลัมน์ชื่อค้างไว้ด้านซ้ายตอนเลื่อนแนวนอน
const th = "px-3 py-3 text-right text-[13px] font-semibold text-(--ink) whitespace-nowrap";
const thL = "px-3 py-3 text-left text-[13px] font-semibold text-(--ink) whitespace-nowrap";
const td = "px-3 py-3 text-right text-[15px] tabular-nums text-(--ink) whitespace-nowrap";
/** คอลัมน์แรก (ชื่อ) — ค้างซ้ายเมื่อเลื่อนตารางแนวนอน มีพื้นหลังทึบกันตัวเลขทับ */
const stickyTh = `${thL} sticky left-0 z-10 bg-(--bg-soft)`;
const stickyTd = "sticky left-0 z-10 bg-(--bg) px-3 py-3 align-middle group-hover:bg-(--bg-soft)";
const tableWrap = "-mx-4 overflow-x-auto sm:mx-0 sm:rounded-(--radius) sm:border sm:border-(--line)";
const theadCls = "border-b border-(--line) bg-(--bg-soft)";
const rowCls = "group border-b border-(--line) last:border-0 hover:bg-(--bg-soft)";

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
      <td className={`${td} font-semibold`}>{fmtMoney(r.cost, currency)}</td>
      <td className={td}>{fmtNum(r.clicks)}</td>
      <td className={td}>{fmtNum(r.conversions, 2)}</td>
      <StatusCell metric="ctr" value={r.ctr} status={r.ctr_status} />
      <StatusCell metric="cpc" value={r.cpc} status={r.cpc_status} currency={currency} />
      <StatusCell metric="conv_rate" value={r.conv_rate} status={r.conv_rate_status} />
      <StatusCell metric="cpa" value={r.cpa} status={r.cpa_status} currency={currency} />
      <StatusCell metric="top_impr_pct" value={r.top_impr_pct} status={r.top_impr_pct_status} />
      <StatusCell metric="abs_top_impr_pct" value={r.abs_top_impr_pct} status={r.abs_top_impr_pct_status} />
    </>
  );
}

/** หัวคอลัมน์ KPI — title = คำอธิบายเมื่อเอาเมาส์ชี้ */
const KPI_HEAD: { label: string; title: string }[] = [
  { label: "ค่าใช้จ่าย", title: "ค่าใช้จ่ายรวมในช่วงที่เลือก" },
  { label: "คลิก", title: "จำนวนคลิก" },
  { label: "Conv.", title: "Conversions" },
  { label: "CTR", title: "คลิก ÷ การแสดงผล × 100" },
  { label: "CPC", title: "ค่าใช้จ่าย ÷ คลิก" },
  { label: "Conv. Rate", title: "Conversions ÷ คลิก × 100" },
  { label: "CPA", title: "ค่าใช้จ่าย ÷ Conversions" },
  { label: "Top %", title: "สัดส่วนที่โฆษณาขึ้นช่วงบนของหน้าผลค้นหา" },
  { label: "Abs. Top %", title: "สัดส่วนที่โฆษณาขึ้นตำแหน่งแรกสุด" },
];

function KpiHeads() {
  return (
    <>
      {KPI_HEAD.map((h) => (
        <th key={h.label} className={th} title={h.title}>
          {h.label}
        </th>
      ))}
    </>
  );
}

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
  if (rows.length === 0) return <p className="text-[15px] text-(--ink-soft)">ไม่มีข้อมูลแคมเปญในช่วงนี้</p>;
  return (
    <div className={tableWrap}>
      <table className="w-full min-w-[1180px] border-collapse">
        <thead className={theadCls}>
          <tr>
            <th className={`${stickyTh} min-w-[220px]`}>แคมเปญ</th>
            <th className={th} title="งบประมาณต่อวันที่ตั้งไว้">งบ/วัน</th>
            <th className={th} title="(ค่าใช้จ่าย ÷ วันที่วิ่งจริง) ÷ งบรายวัน">ใช้งบ</th>
            <KpiHeads />
            <th className={th} title="Impression share ที่เสียไปเพราะงบไม่พอ">
              เสีย IS
              <br />
              <span className="font-normal text-(--ink-soft)">(งบ)</span>
            </th>
            <th className={th} title="Impression share ที่เสียไปเพราะ Ad Rank ต่ำ">
              เสีย IS
              <br />
              <span className="font-normal text-(--ink-soft)">(อันดับ)</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={String(c.id)} className={rowCls}>
              <td className={stickyTd}>
                <div className="text-[15px] font-semibold leading-snug text-(--ink)">{c.name ?? c.id}</div>
                {c.low_data && (
                  <div className="mt-1">
                    <StatusBadge status="low_data" />
                  </div>
                )}
              </td>
              <td className={td}>{fmtMoney(c.daily_budget, currency)}</td>
              <td className={td}>{fmtPct(c.budget_util_pct, 1)}</td>
              <KpiCells r={c} currency={currency} />
              <td className={td}>{fmtPct(c.budget_lost_is, 1)}</td>
              <td className={td}>{fmtPct(c.rank_lost_is, 1)}</td>
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
  if (rows.length === 0) return <p className="text-[15px] text-(--ink-soft)">ไม่มีข้อมูลกลุ่มโฆษณาในช่วงนี้</p>;
  return (
    <div className={tableWrap}>
      <table className="w-full min-w-[1040px] border-collapse">
        <thead className={theadCls}>
          <tr>
            <th className={`${stickyTh} min-w-[220px]`}>กลุ่มโฆษณา</th>
            <KpiHeads />
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={String(a.id)} className={rowCls}>
              <td className={stickyTd}>
                <div className="text-[15px] font-semibold leading-snug text-(--ink)">{a.name ?? a.id}</div>
                <div className="text-[13px] text-(--ink-soft)">{campaignName(String(a.campaign_id)) ?? ""}</div>
                {a.low_data && (
                  <div className="mt-1">
                    <StatusBadge status="low_data" />
                  </div>
                )}
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
  if (rows.length === 0) return <p className="text-[15px] text-(--ink-soft)">ไม่มีคำค้นหาที่เข้าเกณฑ์</p>;
  return (
    <div className={tableWrap}>
      <table className="w-full min-w-[640px] border-collapse">
        <thead className={theadCls}>
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
            <tr key={`${w.ad_group_id}|${w.search_term}`} className={rowCls}>
              <td className="px-3 py-3 text-[15px] font-semibold text-(--ink)">{w.search_term}</td>
              <td className="px-3 py-3 text-[14px] text-(--ink-soft)">{adGroupName(String(w.ad_group_id)) ?? w.ad_group_id}</td>
              <td className={td}>{fmtNum(w.clicks)}</td>
              <td className={td}>{fmtNum(w.impressions)}</td>
              <td className={`${td} font-semibold`}>{fmtMoney(w.cost, currency)}</td>
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
  if (findings.length === 0) return <p className="text-[15px] text-(--ink-soft)">ไม่มีข้อสังเกต</p>;
  return (
    <ul className="flex flex-col gap-2">
      {findings.map((f, i) => (
        <li key={i} className="rounded-(--radius) border border-(--line) bg-(--bg-soft) px-4 py-3 text-[15px] leading-relaxed">
          <span className="mr-2 rounded bg-(--line) px-2 py-0.5 text-[12px] font-semibold text-(--ink)">
            {FINDING_LABEL[f.type as FindingType] ?? f.type}
          </span>
          <span className="font-semibold text-(--ink)">{entityName(f.entity_type, String(f.entity_id)) ?? f.entity_id}</span>
          <span className="text-(--ink-soft)"> — {f.message}</span>
        </li>
      ))}
    </ul>
  );
}
