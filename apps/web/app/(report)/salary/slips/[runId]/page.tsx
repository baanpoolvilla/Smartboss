import { notFound, redirect } from "next/navigation";
import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { PrintButton } from "@/modules/daily_worker/components/print-button";
import { PayslipDocument } from "@/modules/salary/components/payslip-document";
import { salaryAccess } from "@/modules/salary/lib/access";
import { readSettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { loadSlip, positionOf, type SlipData } from "@/modules/salary/lib/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "สลิปเงินเดือน · Smartboss" };

/**
 * สลิปเงินเดือนสำหรับพิมพ์/บันทึก PDF — หน้าละคน
 *   ?mine=1  สลิปของตัวเอง (ทุกคน · เฉพาะงวดที่จ่ายแล้ว)
 *   ไม่มี    ทุกคนในรอบ (CEO + คนที่ CEO เลือกเท่านั้น) · ?only=<employmentId> = คนเดียว
 * รูปแบบเอกสาร (payslip-document.tsx) พิมพ์แนวนอน A4
 * อยู่นอกกลุ่ม (shell) ให้ไม่มีเมนูแอปติดตอนพิมพ์
 */
export default async function PrintSlips({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<{ mine?: string; only?: string }> }) {
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
    const ids = await withSalaryTenant(orgId, (tx) => tx.salaryRunLine.findMany({ where: { orgId, runId, ...(sp.only ? { employmentId: sp.only } : {}) }, select: { employmentId: true, name: true } }));
    ids.sort((a, b) => a.name.localeCompare(b.name, "th"));
    for (const x of ids) {
      const s = await loadSlip(orgId, runId, { employmentId: x.employmentId });
      if (s) slips.push(s);
    }
    if (slips.length === 0) notFound();
  }
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  const settings = await withSalaryTenant(orgId, (tx) => readSettings(tx, orgId));
  const positions = await Promise.all(slips.map((s) => positionOf(orgId, s.line.employmentId, s.endsOn)));
  return (
    <div className="min-h-screen bg-(--bg-soft) py-6 text-(--ink) print:bg-white print:py-0">
      <style>{"@page { size: A4 landscape; margin: 12mm; }"}</style>
      <div className="mx-auto mb-4 flex max-w-5xl justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      {slips.map((s, i) => (
        <div key={s.line.employmentId} className="mx-auto mb-6 max-w-5xl bg-(--bg) shadow-sm print:mb-0 print:max-w-none print:break-after-page print:shadow-none">
          {s.status !== "paid" && <p className="px-8 pt-4 text-sm font-semibold text-amber-800 print:px-0">ตัวอย่าง — รอบนี้ยังไม่จ่าย</p>}
          <PayslipDocument s={s} company={org?.name ?? ""} companyTaxId={settings.companyTaxId} position={positions[i]} />
        </div>
      ))}
    </div>
  );
}
