import { notFound, redirect } from "next/navigation";
import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { PrintButton } from "@/modules/daily_worker/components/print-button";
import { SlipView } from "@/modules/salary/components/slip-view";
import { salaryAccess } from "@/modules/salary/lib/access";
import { withSalaryTenant } from "@/modules/salary/lib/db";
import { loadSlip, type SlipData } from "@/modules/salary/lib/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "สลิปเงินเดือน · Smartboss" };

/**
 * สลิปเงินเดือนสำหรับพิมพ์/บันทึก PDF — หน้าละคน
 *   ?mine=1  สลิปของตัวเอง (ทุกคน · เฉพาะงวดที่จ่ายแล้ว)
 *   ไม่มี    ทุกคนในรอบ (CEO + คนที่ CEO เลือกเท่านั้น)
 * อยู่นอกกลุ่ม (shell) ให้ไม่มีเมนูแอปติดตอนพิมพ์
 */
export default async function PrintSlips({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<{ mine?: string }> }) {
  const session = await requireOrg();
  const { runId } = await params;
  const sp = await searchParams;
  const orgId = session.orgId;
  let slips: SlipData[] = [];
  if (sp.mine) {
    const s = await loadSlip(orgId, runId, { userId: session.userId });
    if (!s || s.status !== "paid") notFound();
    slips = [s];
  } else {
    if (!(await salaryAccess(session)).canEdit) redirect("/salary");
    const ids = await withSalaryTenant(orgId, (tx) => tx.salaryRunLine.findMany({ where: { orgId, runId }, select: { employmentId: true, name: true } }));
    ids.sort((a, b) => a.name.localeCompare(b.name, "th"));
    for (const x of ids) {
      const s = await loadSlip(orgId, runId, { employmentId: x.employmentId });
      if (s) slips.push(s);
    }
    if (slips.length === 0) notFound();
  }
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  return (
    <div className="min-h-screen bg-(--bg-soft) py-6 text-(--ink) print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-xl justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      {slips.map((s) => (
        <div key={s.line.employmentId} className="mx-auto mb-6 max-w-xl bg-(--bg) p-6 shadow-sm print:mb-0 print:max-w-none print:break-after-page print:p-0 print:shadow-none">
          {s.status !== "paid" && <p className="mb-2 text-sm font-semibold text-amber-800">ตัวอย่าง — รอบนี้ยังไม่จ่าย</p>}
          <SlipView s={s} company={org?.name ?? ""} />
        </div>
      ))}
    </div>
  );
}
