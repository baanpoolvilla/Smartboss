import { prisma } from "@smartboss/database";

import { AppScaffold } from "@/components/module/app-scaffold";
import { AccessForm, GeneralSettingsForm, ItemsList, SsoRates, TaxAndItemsSwitch, TaxRates } from "@/modules/salary/components/settings-forms";
import { SalaryTabs } from "@/modules/salary/components/tabs";
import { readRates, readSettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { ensureDefaultItems } from "@/modules/salary/lib/items";
import { salaryPage } from "@/modules/salary/lib/page";
import { DEFAULT_SSO, DEFAULT_TAX, bangkokToday, rateOn } from "@/modules/salary/lib/types";

export const dynamic = "force-dynamic";

/** ตั้งค่าเงินเดือน (ต่อบริษัท) — ทุกตัวเลขแก้ได้ที่นี่ ไม่ต้องแก้โปรแกรม · ทุกการแก้บันทึกว่าใครแก้ */
export default async function SalarySettingsPage() {
  const { session, access } = await salaryPage({ edit: true });
  const orgId = session.orgId;
  const { settings, rates, items } = await withSalaryTenant(orgId, async (tx) => {
    await ensureDefaultItems(tx, orgId);
    return {
      settings: await readSettings(tx, orgId),
      rates: await readRates(tx, orgId),
      items: await tx.salaryItem.findMany({ where: { orgId }, orderBy: [{ kind: "asc" }, { sort: "asc" }, { name: "asc" }] }),
    };
  });
  const users = await prisma.user.findMany({
    where: { orgId, isActive: true, roles: { none: { role: { code: { in: ["WORKER", "CEO"] } } } } },
    select: { id: true, name: true, roles: { select: { role: { select: { name: true } } } } },
    orderBy: { name: "asc" },
  });
  const today = bangkokToday();
  return (
    <AppScaffold title="เงินเดือน" width="max-w-4xl">
      <div className="flex flex-col gap-4">
        <SalaryTabs active="settings" />
        <AccessForm
          canManage={access.canManageAccess}
          users={users.map((u) => ({ id: u.id, name: u.name, roles: u.roles.map((r) => r.role.name).join(", ") }))}
          initial={{ editorUserIds: settings.editorUserIds, superAdminAccess: settings.superAdminAccess }}
        />
        {/* key: สวิตช์รวมเปลี่ยนภาษีแล้ว ฟอร์มนี้ต้องอ่านค่าใหม่ ไม่งั้นกดบันทึกทีหลังจะเขียนค่าเดิมทับ */}
        <GeneralSettingsForm
          key={String(settings.taxEnabled)}
          initial={{
            cutoffDay: settings.cutoffDay,
            payDay: settings.payDay,
            approvalMode: settings.approvalMode,
            changeThreshold: settings.changeThreshold,
            deductLate: settings.deductLate,
            lateMode: settings.lateMode,
            latePerTime: settings.latePerTime,
            deductAbsent: settings.deductAbsent,
            deductUnpaidLeave: settings.deductUnpaidLeave,
            otSsoBase: settings.otSsoBase,
            taxEnabled: settings.taxEnabled,
            otMode: settings.otMode,
            diligenceEnabled: settings.diligenceEnabled,
            diligenceSteps: settings.diligenceSteps,
            diligencePartial: settings.diligencePartial,
            companyTaxId: settings.companyTaxId,
            ssoEmployerNo: settings.ssoEmployerNo,
            ssoBranch: settings.ssoBranch,
            payBankName: settings.payBankName,
            payBankAccount: settings.payBankAccount,
          }}
        />
        <SsoRates current={rateOn(rates.sso, today, DEFAULT_SSO)} isDefault={rates.sso.length === 0} history={rates.sso.map((r) => ({ from: r.effectiveFrom, p: r.params }))} />
        <TaxAndItemsSwitch taxEnabled={settings.taxEnabled} activeItems={items.filter((i) => i.active).length} totalItems={items.length} />
        {settings.taxEnabled && <TaxRates current={rateOn(rates.tax, today, DEFAULT_TAX)} isDefault={rates.tax.length === 0} />}
        <ItemsList items={items.map((i) => ({ id: i.id, name: i.name, kind: i.kind as "earning" | "deduction", taxable: i.taxable, ssoBase: i.ssoBase, active: i.active }))} />
      </div>
    </AppScaffold>
  );
}
