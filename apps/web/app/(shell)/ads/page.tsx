import { hasPermission } from "@smartboss/auth";
import { requireAdsPage } from "@/modules/ads/data/access";
import { listAccounts, resolveAccount } from "@/modules/ads/data/accounts";
import { agentOnline, loadAgentSettings } from "@/modules/ads/data/agent-settings";
import { proposalViewer } from "@/modules/ads/data/proposal-view";
import { expireStale, listProposalIds, proposalCounts } from "@/modules/ads/data/proposals";
import { buildReport } from "@/modules/ads/data/report";
import { latestSummary } from "@/modules/ads/data/summaries";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { parsePeriodQuery, recordParams } from "@/modules/ads/lib/query";
import { formatPeriod } from "@/modules/ads/lib/periods";
import type { ProposalView } from "@/modules/ads/lib/proposal-types";
import { FilterBar } from "@/modules/ads/components/filter-bar";
import { DailyCharts } from "@/modules/ads/components/daily-chart";
import { AdsPage, NoAccounts } from "@/modules/ads/components/page-shell";
import { AgentStatusBar, ProposalGrid, SummaryPanel } from "@/modules/ads/components/agent-panels";
import { CampaignTable, FindingList, KpiCard, Section, WastedTermsTable } from "@/modules/ads/components/ui";

export const dynamic = "force-dynamic";

/**
 * แดชบอร์ด Google Ads (ผู้ใช้ 17/11/2569) — สี่ส่วน: สถานะการเชื่อมต่อ n8n · คำขอปรับจาก AI ·
 * บทสรุปที่ n8n ส่งมา · ตัวเลขโฆษณา (Rule Engine ชุดเดิม)
 */
export default async function AdsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdsPage(ADS_PERMS.access);
  const sp = recordParams(await searchParams);
  await expireStale(session.orgId);
  const [accounts, account, agent] = await Promise.all([
    listAccounts(session.orgId),
    resolveAccount(session.orgId, sp.get("customer_id")),
    loadAgentSettings(session.orgId),
  ]);
  const online = agentOnline(agent.lastSeenAt);
  const canConfigure = hasPermission(session, ADS_PERMS.admin);
  const customerId = account?.customerId ?? null;

  const [counts, openIds, summary] = await Promise.all([
    proposalCounts(session.orgId, customerId),
    listProposalIds(session.orgId, { status: "open", customerId, take: 12 }),
    latestSummary(session.orgId, customerId),
  ]);
  const view = await proposalViewer(session.orgId, openIds);
  const openProposals = openIds.map((id) => view(id, session.userId)).filter((p): p is ProposalView => !!p);

  const statusBar = (
    <AgentStatusBar
      online={online}
      lastSeenAt={agent.lastSeenAt}
      lastSyncedAt={account?.lastSyncedAt ?? null}
      pending={counts.pending ?? 0}
      waitingExecution={(counts.approved ?? 0) + (counts.executing ?? 0)}
      canConfigure={canConfigure}
    />
  );

  if (!account) {
    return (
      <AdsPage title="Google Ads" lastSynced={null}>
        {statusBar}
        <NoAccounts canConfigure={canConfigure} />
      </AdsPage>
    );
  }

  const { period, compare } = parsePeriodQuery(sp);
  const r = await buildReport(session.orgId, account.customerId, period, compare);
  const cur = account.currencyCode;
  const t = r.totals;
  const adGroupName = new Map(r.adGroups.map((a) => [a.id, a.name]));
  const campaignName = new Map(r.campaigns.map((c) => [c.id, c.name]));

  return (
    <AdsPage title="Google Ads" lastSynced={account.lastSyncedAt}>
      {statusBar}

      <Section
        title="คำขอปรับจาก AI"
        description="รออนุมัติ / อนุมัติแล้วรอ n8n ปรับ — กดในการ์ดได้เลย หรือกดในแชท 🤖 Ads Agent"
        action={
          <a href="/ads/proposals" className="text-sm text-[#1A73E8] underline">
            ดูทั้งหมด
          </a>
        }
      >
        <ProposalGrid proposals={openProposals} empty="ไม่มีคำขอที่ค้างอยู่" />
      </Section>

      <Section title="สรุปจาก AI (n8n)">
        <SummaryPanel summary={summary} />
      </Section>

      <FilterBar accounts={accounts} customerId={account.customerId} from={period.from} to={period.to} compare={sp.get("compare") ?? "previous"} />
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
        {/* ROAS แสดงเฉพาะเมื่อมี conversion value — 0.00x ไม่ช่วยตัดสินใจ */}
        {t.roas != null && t.roas > 0 && <KpiCard label="ROAS" metric="roas" value={t.roas} change={t.change.roas} />}
      </div>

      <Section title="แคมเปญ">
        <CampaignTable rows={r.campaigns} currency={cur} />
      </Section>

      <Section title="ผลรายวัน">
        <DailyCharts data={r.daily} currency={cur} />
      </Section>

      <Section title="ข้อสังเกตจากกฎ" description="Rule Engine ตามช่วงเวลาที่เลือก — ชุดเดียวกับที่ส่งให้ AI บน n8n">
        <FindingList
          findings={r.findings}
          entityName={(type, id) => (type === "campaign" ? campaignName.get(id) : adGroupName.get(id)) ?? null}
        />
      </Section>

      <Section
        title="คำค้นหาที่เสียเงิน"
        description={`คลิกตั้งแต่ ${r.settings.wastedTermMinClicks} ครั้งขึ้นไปแต่ไม่มี conversion — AI ใช้เสนอ Negative keyword`}
      >
        <WastedTermsTable rows={r.wastedTerms} adGroupName={(id) => adGroupName.get(id) ?? null} currency={cur} />
      </Section>
    </AdsPage>
  );
}
