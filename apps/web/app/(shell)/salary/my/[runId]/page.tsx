import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@smartboss/database";

import { AppScaffold } from "@/components/module/app-scaffold";
import { CashConfirm } from "@/modules/salary/components/cash-confirm";
import { PayslipDocument } from "@/modules/salary/components/payslip-document";
import { SlipTabs } from "@/modules/salary/components/slip-tabs";
import { SlipView } from "@/modules/salary/components/slip-view";
import { outline } from "@/modules/salary/components/ui";
import { readSettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { salaryPage } from "@/modules/salary/lib/page";
import { loadSlip, positionOf } from "@/modules/salary/lib/views";
import { periodLabel } from "@/modules/salary/lib/types";

export const dynamic = "force-dynamic";

/** สลิปของตัวเอง — เห็นได้เฉพาะของตัวเอง และเฉพาะงวดที่บริษัทบันทึกจ่ายแล้ว */
export default async function MySlipPage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { session } = await salaryPage();
  const { runId } = await params;
  const detail = (await searchParams).view === "detail";
  const slip = await loadSlip(session.orgId, runId, { userId: session.userId }).catch(() => null);
  if (!slip || slip.status !== "paid") notFound();
  const org = await prisma.organization.findUnique({ where: { id: session.orgId }, select: { name: true } });
  // ตั้งค่าเงินเดือนอ่านได้ผ่าน RLS ของบริษัท (เลขผู้เสียภาษีบริษัทบนหัวสลิป — ไม่ใช่ข้อมูลเงินเดือนของใคร)
  const settings = await withSalaryTenant(session.orgId, (tx) => readSettings(tx, session.orgId));
  const position = await positionOf(session.orgId, slip.line.employmentId, slip.endsOn);
  const base = `/salary/my/${runId}`;
  return (
    <AppScaffold title={`สลิป ${periodLabel(slip.period)}`} backHref="/salary/my" width={detail ? "max-w-xl" : "max-w-5xl"}>
      <div className="flex flex-col gap-3">
        <SlipTabs docHref={base} detailHref={`${base}?view=detail`} detail={detail} />
        {detail ? (
          <SlipView s={slip} company={org?.name ?? ""} />
        ) : (
          <div className="overflow-hidden rounded-(--radius-lg) border border-(--line)">
            <PayslipDocument s={slip} company={org?.name ?? ""} companyTaxId={settings.companyTaxId} position={position} />
          </div>
        )}
        {slip.line.payChannel === "cash" && <CashConfirm runId={runId} />}
        <Link href={`/salary/slips/${runId}?mine=1`} target="_blank" className={outline}>พิมพ์ / บันทึก PDF</Link>
        <p className="text-center text-xs text-(--ink-soft)">ยอดไม่ตรงหรือสงสัยตรงไหน ติดต่อฝ่ายบุคคล</p>
      </div>
    </AppScaffold>
  );
}
