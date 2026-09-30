import { hasPermission } from "@smartboss/auth";
import { requireAdsPage } from "@/modules/ads/data/access";
import { listAccounts, resolveAccount } from "@/modules/ads/data/accounts";
import { getAiReport, listAiReports } from "@/modules/ads/data/ai";
import { buildWeeklyEmail } from "@/modules/ads/data/email";
import { loadAnalysisSettings } from "@/modules/ads/data/settings";
import { mailConfigured } from "@/modules/ads/lib/mailer";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { recordParams } from "@/modules/ads/lib/query";
import { FilterBar } from "@/modules/ads/components/filter-bar";
import { AdsPage, NoAccounts } from "@/modules/ads/components/page-shell";
import { Section } from "@/modules/ads/components/ui";

export const dynamic = "force-dynamic";

/**
 * หน้า 2 — อีเมลสรุปรายสัปดาห์ (spec §7) — ตัวอย่างอีเมลจากรายงานรายสัปดาห์ล่าสุด
 * (รายงานที่สร้างตามตารางเวลาทุกวันจันทร์ 07:00 แล้วส่งให้ผู้รับที่ตั้งไว้)
 */
export default async function AdsEmailPage({
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
      <AdsPage title="อีเมลสรุปรายสัปดาห์" lastSynced={null}>
        <NoAccounts canConfigure={hasPermission(session, ADS_PERMS.admin)} />
      </AdsPage>
    );
  }

  const [history, settings] = await Promise.all([
    listAiReports(session.orgId, account.customerId, 50),
    loadAnalysisSettings(session.orgId, account.customerId),
  ]);
  // รายงานรายสัปดาห์ = รายงานตามตารางเวลาที่ช่วงยาว 7 วัน
  const weekly = history.find(
    (h) => h.createdBy === "schedule" && (Date.parse(h.period.to) - Date.parse(h.period.from)) / 86_400_000 === 6
  );
  const report = weekly ? await getAiReport(session.orgId, weekly.id) : null;
  const mail = report ? buildWeeklyEmail(report) : null;

  return (
    <AdsPage title="อีเมลสรุปรายสัปดาห์" lastSynced={account.lastSyncedAt}>
      <FilterBar accounts={accounts} customerId={account.customerId} from="" to="" compare="previous" showPeriod={false} />
      <Section title="การส่ง" description="ส่งอัตโนมัติทุกวันจันทร์ 07:00 — 7 วันล่าสุด เทียบ 7 วันก่อนหน้า">
        <dl className="grid gap-1 text-sm sm:grid-cols-[140px_1fr]">
          <dt className="text-(--ink-soft)">ผู้รับ</dt>
          <dd className="text-(--ink)">
            {settings.emailRecipients.length ? settings.emailRecipients.join(", ") : "ยังไม่ได้ตั้ง (ตั้งที่หน้าเกณฑ์ KPI และกฎ)"}
          </dd>
          <dt className="text-(--ink-soft)">เซิร์ฟเวอร์อีเมล</dt>
          <dd className="text-(--ink)">{mailConfigured() ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้งค่า SMTP — ติดต่อผู้ดูแลระบบ"}</dd>
        </dl>
      </Section>
      <Section title={mail ? mail.subject : "ตัวอย่างอีเมล"}>
        {mail ? (
          <iframe
            title="ตัวอย่างอีเมล"
            srcDoc={mail.html}
            sandbox=""
            className="h-[900px] w-full rounded-(--radius) border border-(--line)"
          />
        ) : (
          <p className="text-sm text-(--ink-soft)">ยังไม่มีรายงานรายสัปดาห์ของบัญชีนี้ — จะสร้างครั้งแรกในวันจันทร์ถัดไป 07:00</p>
        )}
      </Section>
    </AdsPage>
  );
}
