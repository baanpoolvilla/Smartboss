import Link from "next/link";
import { hasPermission } from "@smartboss/auth";
import { requireAdsPage } from "@/modules/ads/data/access";
import { listAccounts, resolveAccount } from "@/modules/ads/data/accounts";
import { buildReport } from "@/modules/ads/data/report";
import { latestAiReport } from "@/modules/ads/data/ai";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { parsePeriodQuery, recordParams } from "@/modules/ads/lib/query";
import { formatPeriod } from "@/modules/ads/lib/periods";
import { fmtDateTime } from "@/modules/ads/lib/format";
import { FilterBar } from "@/modules/ads/components/filter-bar";
import { DailyCharts } from "@/modules/ads/components/daily-chart";
import { AdsPage, ExportButtons, NoAccounts } from "@/modules/ads/components/page-shell";
import { CampaignTable, FindingList, KpiCard, Section, WastedTermsTable } from "@/modules/ads/components/ui";

export const dynamic = "force-dynamic";

/** หน้า 1 — Google Ads Report (แดชบอร์ด) spec §7 */
export default async function AdsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdsPage(ADS_PERMS.access);
  const sp = recordParams(await searchParams);
  const accounts = await listAccounts(session.orgId);
  const account = await resolveAccount(session.orgId, sp.get("customer_id"));
  if (!account) {
    return (
      <AdsPage title="Google Ads Report" lastSynced={null}>
        <NoAccounts canConfigure={hasPermission(session, ADS_PERMS.admin)} />
      </AdsPage>
    );
  }

  const { period, compare } = parsePeriodQuery(sp);
  const compareParam = sp.get("compare") ?? "previous";
  const [r, latest] = await Promise.all([
    buildReport(session.orgId, account.customerId, period, compare),
    latestAiReport(session.orgId, account.customerId),
  ]);
  const cur = account.currencyCode;
  const t = r.totals;
  const adGroupName = new Map(r.adGroups.map((a) => [a.id, a.name]));
  const campaignName = new Map(r.campaigns.map((c) => [c.id, c.name]));

  return (
    <AdsPage
      title="Google Ads Report"
      lastSynced={account.lastSyncedAt}
      actions={latest && <ExportButtons reportId={latest.id} />}
    >
      <FilterBar
        accounts={accounts}
        customerId={account.customerId}
        from={period.from}
        to={period.to}
        compare={compareParam}
      />
      <div className="text-xs text-(--ink-soft)">
        {formatPeriod(period)} ({r.period.days} วัน){compare ? ` เทียบ ${formatPeriod(compare)}` : ""}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="ค่าใช้จ่าย" metric="cost" value={t.cost} change={t.change.cost} currency={cur} />
        <KpiCard label="Conversions" metric="conversions" value={t.conversions} change={t.change.conversions} />
        <KpiCard label="CPA" metric="cpa" value={t.cpa} status={t.cpa_status} change={t.change.cpa} currency={cur} />
        <KpiCard label="CTR" metric="ctr" value={t.ctr} status={t.ctr_status} change={t.change.ctr} />
        <KpiCard label="CPC" metric="cpc" value={t.cpc} status={t.cpc_status} change={t.change.cpc} currency={cur} />
        <KpiCard label="Conversion Rate" metric="conv_rate" value={t.conv_rate} status={t.conv_rate_status} change={t.change.conv_rate} />
        <KpiCard label="Impr. (Top) %" metric="top_impr_pct" value={t.top_impr_pct} status={t.top_impr_pct_status} />
        <KpiCard label="Impr. (Abs. Top) %" metric="abs_top_impr_pct" value={t.abs_top_impr_pct} status={t.abs_top_impr_pct_status} />
        {t.roas != null && <KpiCard label="ROAS" metric="roas" value={t.roas} change={t.change.roas} />}
      </div>

      <Section title="ผลรายวัน">
        <DailyCharts data={r.daily} currency={cur} />
      </Section>

      <Section
        title="สรุปจาก AI"
        description={latest ? `รายงานล่าสุด ${formatPeriod(latest.period)} · ${fmtDateTime(latest.createdAt)}` : undefined}
        action={
          <Link
            href={`/ads/analysis?customer_id=${account.customerId}&from=${period.from}&to=${period.to}&compare=${compareParam}${latest ? `&report=${latest.id}` : ""}`}
            className="text-sm text-[#1A73E8] underline"
          >
            {latest ? "เปิดรายงานเต็ม" : "ให้ AI วิเคราะห์"}
          </Link>
        }
      >
        {latest ? (
          <p className="text-sm leading-7 text-(--ink)">
            {latest.output.executive_summary || "บทสรุปถูกซ่อนเพราะไม่ผ่านการตรวจ — เปิดรายงานเต็มเพื่อดูส่วนอื่น"}
          </p>
        ) : (
          <p className="text-sm text-(--ink-soft)">ยังไม่มีรายงาน AI ของบัญชีนี้</p>
        )}
      </Section>

      <Section title="การแจ้งเตือน" description="ข้อสังเกตจากกฎตรวจสอบ ตามช่วงเวลาที่เลือก">
        <FindingList
          findings={r.findings}
          entityName={(type, id) => (type === "campaign" ? campaignName.get(id) : adGroupName.get(id)) ?? null}
        />
      </Section>

      <Section title="แคมเปญ">
        <CampaignTable rows={r.campaigns} currency={cur} />
      </Section>

      <Section
        title="คำค้นหาที่เสียเงิน"
        description={`คลิกตั้งแต่ ${r.settings.wastedTermMinClicks} ครั้งขึ้นไปแต่ไม่มี conversion — เสนอเป็น Negative keyword`}
      >
        <WastedTermsTable rows={r.wastedTerms} adGroupName={(id) => adGroupName.get(id) ?? null} currency={cur} />
      </Section>
    </AdsPage>
  );
}
