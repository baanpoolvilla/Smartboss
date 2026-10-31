import { notFound, redirect } from "next/navigation";
import { prisma } from "@smartboss/database";

import { AppScaffold } from "@/components/module/app-scaffold";
import { listLinkableWorkOrders, listPeople, listProperties, loadSettings } from "@/modules/requests/lib/data";
import { canManageVendors, requestsPage } from "@/modules/requests/lib/page";
import { loadRequests, toVendor, withRequestsTenant } from "@/modules/requests/lib/db";
import { RequestForm, type EditInitial } from "@/modules/requests/components/request-form";
import { bangkokToday } from "@/modules/requests/lib/types";

export const dynamic = "force-dynamic";

const ROLE_TH: Record<string, string> = {
  ADMIN: "แอดมิน", MANAGER: "ผู้จัดการ", HR_OFFICER: "HR", ACCOUNTANT: "บัญชี", SALE_ADMIN: "แอดมินฝ่ายขาย",
  MARKETING: "การตลาด", CEO: "CEO", TECHNICIAN: "ช่าง", CARETAKER: "ผู้ดูแลบ้าน", STAFF: "พนักงาน",
};
const roleLabel = (roles: string[]) => roles.map((r) => ROLE_TH[r]).find(Boolean) ?? null;

/** แก้ไขใบที่ยังรออนุมัติ — เฉพาะคนยื่น · ใบที่มีคนตัดสินแล้ว (รวมขั้นแรกของ HR) กลับไปหน้าใบ */
export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, viewer } = await requestsPage();
  const { id } = await params;
  const orgId = session.orgId;
  const [r] = await withRequestsTenant(orgId, (tx) => loadRequests(tx, orgId, { id }, 1));
  if (!r) notFound();
  if (r.createdBy !== session.userId || r.status !== "pending" || r.firstDecidedAt) redirect(`/requests/${id}`);

  const [people, properties, workOrders, vendors, settings, me] = await Promise.all([
    viewer.canFileOthers ? listPeople(orgId) : Promise.resolve([]),
    listProperties(orgId),
    listLinkableWorkOrders(orgId),
    viewer.canFileOthers
      ? withRequestsTenant(orgId, (tx) => tx.moneyVendor.findMany({ where: { orgId, active: true }, orderBy: { name: "asc" } })).then((v) => v.map(toVendor))
      : Promise.resolve([]),
    loadSettings(orgId),
    prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } }),
  ]);
  // ใบงานที่ผูกไว้อาจปิดเกิน 30 วันแล้ว — ใส่กลับให้เลือกค้างไว้ได้
  if (r.workOrderId && !workOrders.some((w) => w.id === r.workOrderId)) {
    workOrders.unshift({ id: r.workOrderId, code: r.workOrderCode ?? "", title: "", propertyId: r.propertyId ?? "" });
  }

  const selfKind = r.kind === "expense" || r.kind === "cash_advance";
  const initial: EditInitial = {
    beneficiaryUserId: r.beneficiaryUserId ?? "",
    onBehalf: selfKind && r.beneficiaryUserId !== session.userId,
    workDate: r.workDate,
    otStart: r.otStart ?? "",
    otEnd: r.otEnd ?? "",
    rateId: settings.otRates.find((x) => x.label === r.otRateLabel)?.id ?? "",
    amount: r.kind === "ot" ? (r.otBaseKind === "manual" ? String(r.amount) : "") : r.kind === "expense" ? "" : String(r.amount),
    title: r.title,
    detail: r.detail,
    lines: r.kind === "expense" ? (r.lines.length ? r.lines.map((l) => ({ item: l.item, amount: String(l.amount) })) : [{ item: r.title, amount: String(r.amount) }]) : [],
    propertyId: r.propertyId ?? "",
    workOrderId: r.workOrderId ?? "",
    vendorId: r.vendorId ?? "",
    vendorName: r.kind === "contractor" && !r.vendorId ? r.beneficiaryName : "",
    vatOn: r.vatPercent > 0,
    whtPercent: r.whtPercent,
    files: r.attachments.map((a) => ({ ...a, duplicateOf: null })),
  };

  return (
    <AppScaffold title={`แก้ไข ${r.code}`} backHref={`/requests/${id}`} width="max-w-none">
      <RequestForm
        editId={id}
        initial={initial}
        kinds={[r.kind]}
        initialKind={r.kind}
        me={{ userId: session.userId, name: me?.name ?? "" }}
        canFileOthers={viewer.canFileOthers}
        canManageVendors={await canManageVendors(session)}
        people={people.map((p) => ({ userId: p.userId, name: p.name, email: p.email, roleLabel: roleLabel(p.roles), isWorker: p.isWorker, departmentName: p.departmentName }))}
        properties={properties}
        workOrders={workOrders}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, whtPercent: v.whtPercent, vatRegistered: v.vatRegistered }))}
        settings={settings}
        today={bangkokToday()}
      />
    </AppScaffold>
  );
}
