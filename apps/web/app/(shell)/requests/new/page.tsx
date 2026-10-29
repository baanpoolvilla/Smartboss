import { prisma } from "@smartboss/database";

import { AppScaffold } from "@/components/module/app-scaffold";
import { listLinkableWorkOrders, listPeople, listProperties, loadSettings } from "@/modules/requests/lib/data";
import { requestsPage } from "@/modules/requests/lib/page";
import { withRequestsTenant, toVendor } from "@/modules/requests/lib/db";
import { RequestForm } from "@/modules/requests/components/request-form";
import { usesSalaryModule } from "@/modules/requests/lib/pay-privacy";
import { KINDS, bangkokToday, type RequestKind } from "@/modules/requests/lib/types";
import { readSettings as readSalarySettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { periodDates, periodLabel, periodOfDate, thaiDate } from "@/modules/salary/lib/types";

export const dynamic = "force-dynamic";

const ROLE_TH: Record<string, string> = {
  ADMIN: "แอดมิน", MANAGER: "ผู้จัดการ", HR_OFFICER: "HR", ACCOUNTANT: "บัญชี", SALE_ADMIN: "แอดมินฝ่ายขาย",
  MARKETING: "การตลาด", CEO: "CEO", TECHNICIAN: "ช่าง", CARETAKER: "ผู้ดูแลบ้าน", STAFF: "พนักงาน",
};
/** บทบาทหลักของคนนั้นเป็นภาษาไทย — ใช้แยกคนชื่อซ้ำในช่องค้นหา */
const roleLabel = (roles: string[]) => roles.map((r) => ROLE_TH[r]).find(Boolean) ?? null;

/** ยื่นคำขอ — ประเภทที่เห็นขึ้นกับสิทธิ์: ทุกคนเบิกค่าใช้จ่าย/เบิกไปก่อนของตัวเองได้ · OT เบิกล่วงหน้า ช่างภายนอก = คนที่ลงให้คนอื่นได้ */
export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { session, viewer } = await requestsPage();
  const sp = await searchParams;
  const kinds = KINDS.filter((k) => (k === "expense" || k === "cash_advance" ? true : viewer.canFileOthers));
  const [people, properties, workOrders, vendors, settings, me] = await Promise.all([
    viewer.canFileOthers ? listPeople(session.orgId) : Promise.resolve([]),
    listProperties(session.orgId),
    listLinkableWorkOrders(session.orgId),
    viewer.canFileOthers
      ? withRequestsTenant(session.orgId, (tx) => tx.moneyVendor.findMany({ where: { orgId: session.orgId, active: true }, orderBy: { name: "asc" } })).then((v) => v.map(toVendor))
      : Promise.resolve([]),
    loadSettings(session.orgId),
    prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } }),
  ]);
  // เบิกล่วงหน้าหักตามรอบของวันที่เบิก — บอกตั้งแต่ตอนยื่นว่าจะหักรอบไหน
  const today = bangkokToday();
  const advanceRound =
    kinds.includes("advance") && (await usesSalaryModule(session.orgId))
      ? await withSalaryTenant(session.orgId, async (tx) => {
          const { cutoffDay, payDay } = await readSalarySettings(tx, session.orgId);
          const p = periodOfDate(today, cutoffDay);
          const d = periodDates(p, cutoffDay, payDay);
          return `เบิกวันนี้ → หักคืนในเงินเดือนรอบ ${periodLabel(p)} (${thaiDate(d.startsOn, false)}–${thaiDate(d.endsOn, false)} จ่าย ${thaiDate(d.payDate, false)})`;
        })
      : null;
  const initialKind = KINDS.includes(sp.kind as RequestKind) ? (sp.kind as RequestKind) : null;

  return (
    <AppScaffold title="ยื่นคำขอ" backHref="/requests" width="max-w-6xl">
      <RequestForm
        kinds={kinds}
        initialKind={initialKind}
        me={{ userId: session.userId, name: me?.name ?? "" }}
        canFileOthers={viewer.canFileOthers}
        people={people.map((p) => ({ userId: p.userId, name: p.name, email: p.email, roleLabel: roleLabel(p.roles), isWorker: p.isWorker, departmentName: p.departmentName }))}
        properties={properties}
        workOrders={workOrders}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, whtPercent: v.whtPercent, vatRegistered: v.vatRegistered }))}
        settings={settings}
        today={today}
        advanceRound={advanceRound}
      />
    </AppScaffold>
  );
}
