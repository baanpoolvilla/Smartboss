import { notFound } from "next/navigation";
import { prisma } from "@smartboss/database";

import { AppScaffold } from "@/components/module/app-scaffold";
import { Notice } from "@/modules/requests/components/ui";
import { PayslipDocument } from "@/modules/salary/components/payslip-document";
import { SlipTabs } from "@/modules/salary/components/slip-tabs";
import { SlipView } from "@/modules/salary/components/slip-view";
import { readSettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { salaryPage } from "@/modules/salary/lib/page";
import { loadSlip, positionOf } from "@/modules/salary/lib/views";

export const dynamic = "force-dynamic";

/** ดูสลิปของพนักงานคนหนึ่ง (CEO + คนที่ CEO เลือก) — รอบที่ยังไม่จ่ายขึ้นเป็นตัวอย่าง */
export default async function RunSlipPage({ params, searchParams }: { params: Promise<{ id: string; employmentId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { session } = await salaryPage({ edit: true });
  const { id, employmentId } = await params;
  const detail = (await searchParams).view === "detail";
  const slip = await loadSlip(session.orgId, id, { employmentId });
  if (!slip) notFound();
  const org = await prisma.organization.findUnique({ where: { id: session.orgId }, select: { name: true } });
  const settings = await withSalaryTenant(session.orgId, (tx) => readSettings(tx, session.orgId));
  const position = await positionOf(session.orgId, employmentId, slip.endsOn);
  const base = `/salary/runs/${id}/slip/${employmentId}`;
  return (
    <AppScaffold title="สลิปเงินเดือน" backHref={`/salary/runs/${id}?edit=${employmentId}`} width={detail ? "max-w-xl" : "max-w-5xl"}>
      <div className="flex flex-col gap-3">
        {slip.status !== "paid" && <Notice tone="warn">ตัวอย่างสลิป — รอบนี้ยังไม่จ่าย ตัวเลขอาจเปลี่ยน · พนักงานยังไม่เห็น</Notice>}
        <SlipTabs docHref={base} detailHref={`${base}?view=detail`} detail={detail} printHref={`/salary/slips/${id}?only=${employmentId}`} />
        {detail ? (
          <SlipView s={slip} company={org?.name ?? ""} />
        ) : (
          <div className="overflow-hidden rounded-(--radius-lg) border border-(--line)">
            <PayslipDocument s={slip} company={org?.name ?? ""} companyTaxId={settings.companyTaxId} position={position} />
          </div>
        )}
      </div>
    </AppScaffold>
  );
}
