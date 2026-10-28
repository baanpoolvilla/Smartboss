import { notFound } from "next/navigation";

import { AppScaffold } from "@/components/module/app-scaffold";
import { ProfileSection, RecurringSection, SalarySection } from "@/modules/salary/components/employee-forms";
import { readSettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { salaryPage } from "@/modules/salary/lib/page";
import { lastPaidDiligence, listStaff } from "@/modules/salary/lib/views";
import { bangkokToday, periodDates, shiftPeriod, thaiDate } from "@/modules/salary/lib/types";

export const dynamic = "force-dynamic";

/** ข้อมูลเงินเดือนรายคน — 5 หมวด (เงินเดือน · การรับเงิน · ประกันสังคม · ภาษี · รายการประจำ) */
export default async function SalaryEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { session, access } = await salaryPage({ edit: true });
  const { id } = await params;
  const orgId = session.orgId;
  const [row] = await listStaff(orgId, id);
  if (!row) notFound();
  const { items, settings } = await withSalaryTenant(orgId, async (tx) => ({
    items: await tx.salaryItem.findMany({ where: { orgId, active: true }, orderBy: [{ kind: "asc" }, { sort: "asc" }, { name: "asc" }] }),
    settings: await readSettings(tx, orgId),
  }));
  const today = bangkokToday();
  const p = today.slice(0, 7);
  const lastDiligence = settings.diligenceEnabled ? await lastPaidDiligence(orgId, row.employmentId) : null;
  // คนทำเงินเดือน (ไม่ใช่ CEO) ดูของตัวเองได้แต่แก้ไม่ได้ — server ก็กันซ้ำใน actions
  const ownLocked = !access.isCeo && row.userId === session.userId;
  const thisPeriod = periodDates(p, settings.cutoffDay, settings.payDay).endsOn >= today ? p : shiftPeriod(p, 1);
  return (
    <AppScaffold title="ข้อมูลเงินเดือน" backHref="/salary/employees" width="max-w-3xl">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-bold text-(--ink)">{row.name}</h1>
          <p className="text-sm text-(--ink-soft)">
            {[row.employeeCode, row.department, `เริ่มงาน ${thaiDate(row.hiredOn)}`].filter(Boolean).join(" · ")}
            {row.terminatedOn ? ` · ทำงานวันสุดท้าย ${thaiDate(row.terminatedOn)}` : ""} (จากระบบบุคคล)
          </p>
        </div>
        {ownLocked ? (
          <div className="rounded-(--radius) border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <strong>นี่คือข้อมูลเงินเดือนของคุณเอง</strong> — แก้เองไม่ได้ ให้ CEO เป็นคนแก้ให้ (หลักแยกหน้าที่: คนทำเงินเดือนห้ามแก้ของตัวเอง)
            <div className="mt-1 tabular-nums">เงินเดือนปัจจุบัน {row.salary !== null ? `${row.salary.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท` : "ยังไม่ได้ตั้ง"}</div>
          </div>
        ) : (
        <>
        <SalarySection employmentId={row.employmentId} salary={row.salary} history={row.history} hiredOn={row.hiredOn} today={today} />
        <ProfileSection
          employmentId={row.employmentId}
          year={Number(today.slice(0, 4))}
          taxEnabled={settings.taxEnabled}
          diligence={settings.diligenceEnabled ? { steps: settings.diligenceSteps, lastPaid: lastDiligence } : undefined}
          initial={{
            payChannel: row.profile.payChannel,
            bankName: row.profile.bankName,
            bankAccount: row.profile.bankAccount,
            accountName: row.profile.accountName || row.name,
            ssoExempt: row.profile.ssoExempt,
            ssoExemptReason: row.profile.ssoExemptReason,
            taxMode: row.profile.taxMode,
            taxFixedAmount: row.profile.taxFixedAmount,
            taxNoneReason: row.profile.taxNoneReason,
            allowances: row.profile.allowances,
            prevIncome: row.profile.prevIncome,
            prevTax: row.profile.prevTax,
            prevSso: row.profile.prevSso,
            prevYear: row.profile.prevYear,
            diligenceEligible: row.profile.diligenceEligible,
            diligenceOpening: row.profile.diligenceOpening,
          }}
        />
        <RecurringSection employmentId={row.employmentId} rows={row.recurring} items={items.map((i) => ({ id: i.id, name: i.name, kind: i.kind }))} thisPeriod={thisPeriod} />
        </>
        )}
      </div>
    </AppScaffold>
  );
}
