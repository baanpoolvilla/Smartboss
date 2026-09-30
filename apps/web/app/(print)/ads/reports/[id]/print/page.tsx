import { notFound } from "next/navigation";
import { requireAdsPage } from "@/modules/ads/data/access";
import { getAiReport } from "@/modules/ads/data/ai";
import { ADS_PERMS } from "@/modules/ads/permissions";
import { ReportView } from "@/modules/ads/components/report-view";
import { AutoPrint } from "@/modules/ads/components/auto-print";

export const dynamic = "force-dynamic";

/**
 * หน้าพิมพ์รายงาน AI — ปลายทางของ /api/ads/export?format=pdf (spec §8)
 * อยู่นอก (shell) จึงไม่มีเมนู/แถบบน เหลือแต่เนื้อรายงานสำหรับพิมพ์
 */
export default async function AdsReportPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdsPage(ADS_PERMS.access);
  const { id } = await params;
  const report = await getAiReport(session.orgId, id);
  if (!report) notFound();

  return (
    <main className="mx-auto max-w-5xl bg-(--bg) px-6 py-6 print:max-w-none print:px-0 print:py-0 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-(--ink-soft)">รายงานวิเคราะห์ Google Ads</div>
          <h1 className="text-xl font-bold text-(--ink)">{report.input.account.name ?? report.customerId}</h1>
        </div>
        <AutoPrint />
      </div>
      <ReportView report={report} interactive={false} />
    </main>
  );
}
