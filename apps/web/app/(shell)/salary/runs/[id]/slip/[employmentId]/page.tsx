import { notFound } from "next/navigation";
import { prisma } from "@smartboss/database";

import { AppScaffold } from "@/components/module/app-scaffold";
import { Notice } from "@/modules/requests/components/ui";
import { SlipView } from "@/modules/salary/components/slip-view";
import { salaryPage } from "@/modules/salary/lib/page";
import { loadSlip } from "@/modules/salary/lib/views";

export const dynamic = "force-dynamic";

/** ดูสลิปของพนักงานคนหนึ่ง (CEO + คนที่ CEO เลือก) — รอบที่ยังไม่จ่ายขึ้นเป็นตัวอย่าง */
export default async function RunSlipPage({ params }: { params: Promise<{ id: string; employmentId: string }> }) {
  const { session } = await salaryPage({ edit: true });
  const { id, employmentId } = await params;
  const slip = await loadSlip(session.orgId, id, { employmentId });
  if (!slip) notFound();
  const org = await prisma.organization.findUnique({ where: { id: session.orgId }, select: { name: true } });
  return (
    <AppScaffold title="สลิปเงินเดือน" backHref={`/salary/runs/${id}?edit=${employmentId}`} width="max-w-xl">
      <div className="flex flex-col gap-3">
        {slip.status !== "paid" && <Notice tone="warn">ตัวอย่างสลิป — รอบนี้ยังไม่จ่าย ตัวเลขอาจเปลี่ยน · พนักงานยังไม่เห็น</Notice>}
        <SlipView s={slip} company={org?.name ?? ""} />
      </div>
    </AppScaffold>
  );
}
