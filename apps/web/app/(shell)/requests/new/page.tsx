import { prisma } from "@smartboss/database";

import { AppScaffold } from "@/components/module/app-scaffold";
import { listLinkableWorkOrders, listPeople, listProperties, loadSettings, workerCompanyOtPercent } from "@/modules/requests/lib/data";
import { canManageVendors, requestsPage } from "@/modules/requests/lib/page";
import { loadRequests, withRequestsTenant, toVendor } from "@/modules/requests/lib/db";
import { RequestForm, type EditInitial } from "@/modules/requests/components/request-form";
import { usesSalaryModule } from "@/modules/requests/lib/pay-privacy";
import { KINDS, bangkokToday, type RequestKind } from "@/modules/requests/lib/types";
import { readSettings as readSalarySettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { periodDates, periodLabel, periodOfDate, thaiDate } from "@/modules/salary/lib/types";
import { ceoTitle } from "@/lib/ceo-title";
import { ceoText } from "@/lib/ceo-title-shared";

export const dynamic = "force-dynamic";

const ROLE_TH: Record<string, string> = {
  ADMIN: "แอดมิน", MANAGER: "ผู้จัดการ", HR_OFFICER: "HR", ACCOUNTANT: "บัญชี", SALE_ADMIN: "แอดมินฝ่ายขาย",
  MARKETING: "การตลาด", CEO: "CEO", TECHNICIAN: "ช่าง", CARETAKER: "ผู้ดูแลบ้าน", STAFF: "พนักงาน",
};
/** บทบาทหลักของคนนั้นเป็นภาษาไทย — ใช้แยกคนชื่อซ้ำในช่องค้นหา */
const roleLabel = (roles: string[]) => roles.map((r) => ROLE_TH[r]).find(Boolean) ?? null;

/** ยื่นคำขอ — ประเภทที่เห็นขึ้นกับสิทธิ์: ทุกคนเบิกค่าใช้จ่าย/เบิกไปก่อนของตัวเองได้ · OT เบิกล่วงหน้า ช่างภายนอก = คนที่ลงให้คนอื่นได้ */
export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ kind?: string; from?: string }> }) {
  const ceo = await ceoTitle();
  const { session, viewer } = await requestsPage();
  const sp = await searchParams;
  // เบิกซ้ำรายการเดิม (ผู้ใช้ 22/11/2569 — ของประจำ น้ำแข็ง แก๊ส) — เอาข้อความ/ยอด/บ้าน/หมวดจากใบเดิมของตัวเองมาเติม ไม่เอาไฟล์/วันที่
  const [source] = sp.from && /^[0-9a-f-]{36}$/.test(sp.from)
    ? await withRequestsTenant(session.orgId, (tx) => loadRequests(tx, session.orgId, { id: sp.from, kind: { in: ["expense", "cash_advance"] }, OR: [{ createdBy: session.userId }, { beneficiaryUserId: session.userId }] }, 1))
    : [];
  const repeat: EditInitial | undefined = source
    ? {
        beneficiaryUserId: source.beneficiaryUserId ?? "",
        onBehalf: source.beneficiaryUserId !== session.userId,
        workDate: bangkokToday(),
        otStart: "",
        otEnd: "",
        rateId: "",
        amount: source.kind === "expense" ? "" : String(source.amount),
        title: source.title,
        detail: source.detail,
        lines: source.kind === "expense" ? (source.lines.length ? source.lines.map((l) => ({ item: l.item, amount: String(l.amount), ...(l.propertyId ? { propertyId: l.propertyId } : {}) })) : [{ item: source.title, amount: String(source.amount) }]) : [],
        propertyId: source.propertyId ?? "",
        workOrderId: "",
        vendorId: "",
        vendorName: "",
        vatOn: false,
        whtPercent: 0,
        files: [],
        category: source.category ?? "",
        noReceipt: null,
      }
    : undefined;
  const kinds = KINDS.filter((k) => (k === "expense" || k === "cash_advance" ? true : viewer.canFileOthers));
  const [people, properties, workOrders, vendors, settings, me] = await Promise.all([
    viewer.canFileOthers ? listPeople(session.orgId) : Promise.resolve([]),
    listProperties(session.orgId, { activeOnly: true }),
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
  const initialKind = source ? source.kind : KINDS.includes(sp.kind as RequestKind) ? (sp.kind as RequestKind) : null;

  return (
    <AppScaffold title={source ? `เบิกซ้ำ: ${source.title}` : "ยื่นคำขอ"} backHref="/requests" width="max-w-none">
      <RequestForm
        initial={repeat}
        kinds={kinds}
        initialKind={initialKind}
        me={{ userId: session.userId, name: me?.name ?? "" }}
        canFileOthers={viewer.canFileOthers}
        canManageVendors={await canManageVendors(session)}
        people={people.map((p) => ({ userId: p.userId, name: p.name, email: p.email, roleLabel: ceoText(roleLabel(p.roles) ?? "", ceo) || null, isWorker: p.isWorker, departmentName: p.departmentName }))}
        properties={properties}
        workOrders={workOrders}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, whtPercent: v.whtPercent, vatRegistered: v.vatRegistered }))}
        settings={settings}
        today={today}
        advanceRound={advanceRound}
        workerOtPercent={viewer.canFileOthers ? await workerCompanyOtPercent(session.orgId) : undefined}
      />
    </AppScaffold>
  );
}
