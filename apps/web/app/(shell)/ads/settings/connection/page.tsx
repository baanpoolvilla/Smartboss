import { CheckCircle2, XCircle } from "lucide-react";
import { requireAdsPage } from "@/modules/ads/data/access";
import { lastSyncedAt, listAccounts } from "@/modules/ads/data/accounts";
import { isSyncing, listSyncLogs, SYNC_LOOKBACK_DAYS } from "@/modules/ads/data/sync";
import { maskedConfig, testConnection } from "@/modules/ads/lib/google-ads-client";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { JOB_TYPE_LABEL, SYNC_STATUS_LABEL } from "@/modules/ads/constants";
import { fmtDateTime, fmtNum } from "@/modules/ads/lib/format";
import { formatPeriod, fromDbDate } from "@/modules/ads/lib/periods";
import { AccountsPanel } from "@/modules/ads/components/connection-controls";
import { AdsPage } from "@/modules/ads/components/page-shell";
import { Section } from "@/modules/ads/components/ui";

export const dynamic = "force-dynamic";

const AUTH_LABEL = { service_account: "Service Account", oauth: "OAuth (refresh token)", none: "ยังไม่ได้ตั้งค่า" } as const;

/** หน้า 4 — ตั้งค่าการเชื่อมต่อ Google Ads API (spec §7) — ผู้ดูแลระบบ */
export default async function AdsConnectionPage() {
  const session = await requireAdsPage(ADS_PERMS.admin);
  const cfg = maskedConfig();
  const [accounts, logs, lastSync, status] = await Promise.all([
    listAccounts(session.orgId),
    listSyncLogs(session.orgId),
    lastSyncedAt(session.orgId),
    cfg.missing.length === 0 ? testConnection() : Promise.resolve({ ok: false as const, error: "ตั้งค่ายังไม่ครบ" }),
  ]);
  const accountName = new Map(accounts.map((a) => [a.customerId, a.name]));

  const row = (label: string, value: React.ReactNode) => (
    <>
      <dt className="text-(--ink-soft)">{label}</dt>
      <dd className="break-all text-(--ink)">{value ?? <span className="text-(--ink-soft)">-</span>}</dd>
    </>
  );

  return (
    <AdsPage title="การเชื่อมต่อ Google Ads API" lastSynced={lastSync}>
      <Section title="สถานะการเชื่อมต่อ">
        {status.ok ? (
          <div className="flex items-center gap-2 text-sm text-[#14532D]">
            <CheckCircle2 className="h-5 w-5" /> เชื่อมต่อสำเร็จ{status.name ? ` — MCC: ${status.name}` : ""}
          </div>
        ) : (
          <div className="flex items-start gap-2 text-sm text-[#8F1414]">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              เชื่อมต่อไม่ได้ — {status.error}
              {cfg.missing.length > 0 && (
                <div className="mt-1 text-xs">ยังขาด env: {cfg.missing.join(", ")}</div>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section
        title="ข้อมูลยืนยันตัวตน"
        description="เก็บใน environment ของเซิร์ฟเวอร์เท่านั้น (/etc/smartboss/smartboss.env) แก้ที่นั่นแล้ว restart เว็บ — หน้านี้แสดงแบบปิดบังค่า"
      >
        <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[200px_1fr]">
          {row("วิธียืนยันตัวตน", AUTH_LABEL[cfg.authMode])}
          {cfg.authMode === "service_account" && row("อีเมล Service Account", cfg.serviceAccountEmail)}
          {cfg.authMode === "oauth" && row("OAuth Client ID", cfg.oauthClientId)}
          {row("Developer Token", cfg.developerToken ?? "ไม่ใช้ (ระดับการเข้าถึงผูกกับ Google Cloud project)")}
          {row("MCC (login-customer-id)", cfg.loginCustomerId)}
          {row("เวอร์ชัน API", cfg.apiVersion)}
        </dl>
      </Section>

      <Section title="ตารางเวลา" description="ตั้งใน crontab ของเซิร์ฟเวอร์ (deploy/cron-run.sh)">
        <ul className="flex flex-col gap-1 text-sm text-(--ink)">
          <li>ซิงค์รายวัน — ทุกวัน 06:00 · ย้อนหลัง {SYNC_LOOKBACK_DAYS} วัน แล้ว upsert ทับ</li>
          <li>สรุปรายสัปดาห์ + อีเมล — ทุกวันจันทร์ 07:00 · 7 วันล่าสุด เทียบ 7 วันก่อนหน้า</li>
          <li>รายงานรอบครึ่งเดือน — วันที่ 1 และ 16 เวลา 07:00 · ครึ่งเดือนที่ผ่านมา เทียบครึ่งเดือนก่อนหน้า</li>
          <li>ซิงค์ด้วยมือ — ปุ่ม “ซิงค์ทันที” · ย้อนหลัง {SYNC_LOOKBACK_DAYS} วัน</li>
        </ul>
      </Section>

      <Section title="บัญชีที่ดึง">
        <AccountsPanel
          accounts={accounts.map((a) => ({
            ...a,
            lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
            syncing: isSyncing(a.customerId),
          }))}
        />
      </Section>

      <Section title="ประวัติการซิงค์" description="50 รอบล่าสุด">
        {logs.length === 0 ? (
          <p className="text-sm text-(--ink-soft)">ยังไม่เคยซิงค์</p>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="border-b border-(--line) text-xs text-(--ink-soft)">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">เริ่ม</th>
                  <th className="px-2 py-2 text-left font-medium">บัญชี</th>
                  <th className="px-2 py-2 text-left font-medium">ประเภท</th>
                  <th className="px-2 py-2 text-left font-medium">ช่วงข้อมูล</th>
                  <th className="px-2 py-2 text-right font-medium">แถว</th>
                  <th className="px-2 py-2 text-right font-medium">เวลา</th>
                  <th className="px-2 py-2 text-left font-medium">ผล</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={String(l.id)} className="border-b border-(--line) align-top last:border-0">
                    <td className="px-2 py-2 whitespace-nowrap">{fmtDateTime(l.startedAt)}</td>
                    <td className="px-2 py-2">{(l.customerId && accountName.get(l.customerId)) ?? l.customerId}</td>
                    <td className="px-2 py-2">{JOB_TYPE_LABEL[l.jobType ?? ""] ?? l.jobType}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {l.rangeFrom && l.rangeTo ? formatPeriod({ from: fromDbDate(l.rangeFrom), to: fromDbDate(l.rangeTo) }) : "-"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtNum(l.rowsUpserted)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{l.durationMs != null ? `${fmtNum(l.durationMs / 1000, 1)} วิ` : "-"}</td>
                    <td className="px-2 py-2">
                      <span className={l.status === "failed" ? "font-medium text-[#8F1414]" : "text-[#14532D]"}>
                        {SYNC_STATUS_LABEL[l.status ?? ""] ?? l.status}
                      </span>
                      {l.errorMessage && <div className="mt-0.5 max-w-md text-xs text-(--ink-soft)">{l.errorMessage}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </AdsPage>
  );
}
