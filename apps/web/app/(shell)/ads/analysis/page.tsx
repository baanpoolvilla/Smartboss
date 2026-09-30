import Link from "next/link";
import { hasPermission } from "@smartboss/auth";
import { requireAdsPage } from "@/modules/ads/data/access";
import { listAccounts, resolveAccount } from "@/modules/ads/data/accounts";
import { getAiReport, latestAiReport, listAiReports } from "@/modules/ads/data/ai";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { parsePeriodQuery, recordParams } from "@/modules/ads/lib/query";
import { formatPeriod } from "@/modules/ads/lib/periods";
import { fmtDateTime } from "@/modules/ads/lib/format";
import { FilterBar } from "@/modules/ads/components/filter-bar";
import { RunAnalysisButton } from "@/modules/ads/components/ai-controls";
import { ReportView } from "@/modules/ads/components/report-view";
import { AdsPage, ExportButtons, NoAccounts } from "@/modules/ads/components/page-shell";
import { Section } from "@/modules/ads/components/ui";

export const dynamic = "force-dynamic";

/** หน้า 3 — AI วิเคราะห์ผลโฆษณา (spec §7) */
export default async function AdsAnalysisPage({
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
      <AdsPage title="AI วิเคราะห์ผลโฆษณา" lastSynced={null}>
        <NoAccounts canConfigure={hasPermission(session, ADS_PERMS.admin)} />
      </AdsPage>
    );
  }

  const { period } = parsePeriodQuery(sp);
  const compareParam = sp.get("compare") ?? "previous";
  const reportId = sp.get("report");
  const [picked, history] = await Promise.all([
    reportId ? getAiReport(session.orgId, reportId) : latestAiReport(session.orgId, account.customerId),
    listAiReports(session.orgId, account.customerId),
  ]);
  // รายงานต้องเป็นของบัญชีที่เลือกอยู่ — ลิงก์เก่าที่ชี้ข้ามบัญชีให้ถือว่าไม่พบ
  const report = picked && picked.customerId === account.customerId ? picked : null;

  return (
    <AdsPage
      title="AI วิเคราะห์ผลโฆษณา"
      lastSynced={account.lastSyncedAt}
      actions={
        <>
          {report && <ExportButtons reportId={report.id} />}
          <RunAnalysisButton customerId={account.customerId} from={period.from} to={period.to} compare={compareParam} />
        </>
      }
    >
      <FilterBar accounts={accounts} customerId={account.customerId} from={period.from} to={period.to} compare={compareParam} />

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <div className="min-w-0">
          {report ? (
            <ReportView report={report} interactive />
          ) : (
            <div className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-10 text-center text-sm text-(--ink-soft)">
              ยังไม่มีรายงาน — เลือกช่วงเวลาแล้วกด “ให้ AI วิเคราะห์ใหม่”
            </div>
          )}
        </div>
        <Section title="ประวัติรายงาน">
          {history.length === 0 ? (
            <p className="text-sm text-(--ink-soft)">ยังไม่มี</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {history.map((h) => (
                <li key={h.id}>
                  <Link
                    href={`/ads/analysis?customer_id=${account.customerId}&report=${h.id}`}
                    className={`block rounded-(--radius) px-2 py-1.5 hover:bg-(--bg-soft) ${h.id === report?.id ? "bg-[#EEF4FE] font-medium text-[#1A73E8]" : "text-(--ink)"}`}
                  >
                    <div>{formatPeriod(h.period)}</div>
                    <div className="text-xs text-(--ink-soft)">
                      {fmtDateTime(h.createdAt)}
                      {h.createdBy === "schedule" ? " · อัตโนมัติ" : ""}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </AdsPage>
  );
}
