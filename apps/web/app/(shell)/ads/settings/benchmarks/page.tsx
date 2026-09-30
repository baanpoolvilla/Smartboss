import Link from "next/link";
import { requireAdsPage } from "@/modules/ads/data/access";
import { lastSyncedAt, listAccounts } from "@/modules/ads/data/accounts";
import { loadAnalysisSettings, loadBenchmarks } from "@/modules/ads/data/settings";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { AdsPage } from "@/modules/ads/components/page-shell";
import { Section } from "@/modules/ads/components/ui";
import { AnalysisSettingsForm, BenchmarksForm } from "@/modules/ads/components/settings-forms";

export const dynamic = "force-dynamic";

/**
 * หน้า 5 — เกณฑ์ KPI และกฎการวิเคราะห์ (spec §7) — ผู้ดูแลระบบ + หัวหน้าการตลาด
 * ?customer_id= ว่าง = ค่าเริ่มต้นทุกบัญชี (ads_kpi_benchmarks.customer_id = NULL)
 */
export default async function AdsBenchmarksPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string }>;
}) {
  const session = await requireAdsPage(ADS_PERMS.settingManage);
  const { customer_id } = await searchParams;
  const accounts = await listAccounts(session.orgId);
  const account = accounts.find((a) => a.customerId === customer_id) ?? null;
  const customerId = account?.customerId ?? null;

  const [bm, settings, lastSync] = await Promise.all([
    loadBenchmarks(session.orgId, customerId),
    customerId ? loadAnalysisSettings(session.orgId, customerId) : Promise.resolve(null),
    lastSyncedAt(session.orgId, customerId),
  ]);

  const tab = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`rounded-(--radius) border px-3 py-1.5 text-sm ${active ? "border-[#1A73E8] bg-[#EEF4FE] font-medium text-[#1A73E8]" : "border-(--line) text-(--ink)"}`}
    >
      {label}
    </Link>
  );

  return (
    <AdsPage title="เกณฑ์ KPI และกฎการวิเคราะห์" lastSynced={lastSync}>
      <div className="flex flex-wrap gap-2">
        {tab("/ads/settings/benchmarks", "ค่าเริ่มต้นทุกบัญชี", customerId == null)}
        {accounts.map((a) => tab(`/ads/settings/benchmarks?customer_id=${a.customerId}`, a.name ?? a.customerId, a.customerId === customerId))}
      </div>

      <Section
        title="เกณฑ์ KPI"
        description="ธุรกิจอสังหาริมทรัพย์และท่องเที่ยวอาจมี CPA ปกติสูงถึง ฿300+ ปรับเกณฑ์แยกรายบัญชีได้ · ตรวจทิศทางให้ถูก (CPC/CPA ต่ำ = ดี)"
      >
        {/* key: ฟอร์มเริ่มใหม่เมื่อสลับบัญชี ไม่ค้างค่าของบัญชีก่อน */}
        <BenchmarksForm key={customerId ?? "default"} customerId={customerId} initial={bm.map} source={bm.source} />
      </Section>

      <Section title="กฎตรวจสอบและเป้าหมายธุรกิจ" description="ตั้งรายบัญชี">
        {customerId && settings ? (
          <AnalysisSettingsForm key={customerId} customerId={customerId} initial={settings} />
        ) : (
          <p className="text-sm text-(--ink-soft)">
            {accounts.length ? "เลือกบัญชีด้านบนเพื่อตั้งกฎและเป้าหมายของบัญชีนั้น" : "ยังไม่มีบัญชีโฆษณา"}
          </p>
        )}
      </Section>
    </AdsPage>
  );
}
