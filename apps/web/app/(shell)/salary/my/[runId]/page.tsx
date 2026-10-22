import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@smartboss/database";

import { AppScaffold } from "@/components/module/app-scaffold";
import { CashConfirm } from "@/modules/salary/components/cash-confirm";
import { SlipView } from "@/modules/salary/components/slip-view";
import { outline } from "@/modules/salary/components/ui";
import { salaryPage } from "@/modules/salary/lib/page";
import { loadSlip } from "@/modules/salary/lib/views";
import { periodLabel } from "@/modules/salary/lib/types";

export const dynamic = "force-dynamic";

/** สลิปของตัวเอง — เห็นได้เฉพาะของตัวเอง และเฉพาะงวดที่บริษัทบันทึกจ่ายแล้ว */
export default async function MySlipPage({ params }: { params: Promise<{ runId: string }> }) {
  const { session } = await salaryPage();
  const { runId } = await params;
  const slip = await loadSlip(session.orgId, runId, { userId: session.userId }).catch(() => null);
  if (!slip || slip.status !== "paid") notFound();
  const org = await prisma.organization.findUnique({ where: { id: session.orgId }, select: { name: true } });
  return (
    <AppScaffold title={`สลิป ${periodLabel(slip.period)}`} backHref="/salary/my" width="max-w-xl">
      <div className="flex flex-col gap-3">
        <SlipView s={slip} company={org?.name ?? ""} />
        {slip.line.payChannel === "cash" && <CashConfirm runId={runId} />}
        <Link href={`/salary/slips/${runId}?mine=1`} target="_blank" className={outline}>พิมพ์ / บันทึก PDF</Link>
        <p className="text-center text-xs text-(--ink-soft)">ยอดไม่ตรงหรือสงสัยตรงไหน ติดต่อฝ่ายบุคคล</p>
      </div>
    </AppScaffold>
  );
}
