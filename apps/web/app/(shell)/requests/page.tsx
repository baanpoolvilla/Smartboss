import { prisma } from "@smartboss/database";

import { AppScaffold } from "@/components/module/app-scaffold";
import { REQ_PERMS } from "@/modules/requests/permissions";
import { pettyBalances, withRequestsTenant } from "@/modules/requests/lib/db";
import { canDecide, listVisibleRequests } from "@/modules/requests/lib/data";
import { beneficiaryLabel, isOpen, requestsPage, statusOf } from "@/modules/requests/lib/page";
import { RequestsHome, type ListRow } from "@/modules/requests/components/request-list";
import { Notice } from "@/modules/requests/components/ui";
import { bangkokToday, baht, costOf, hoursText, monthTitle, round2, type RequestKind } from "@/modules/requests/lib/types";

export const dynamic = "force-dynamic";

/**
 * เบิกจ่าย & OT — หน้ารวม: ตัวเลขเดือนนี้ + รายการ (รอฉันอนุมัติ / รอจ่าย / ของฉัน / ทั้งหมด)
 * ใบที่ต้องทำอะไรอยู่ขึ้นพื้นแดงอ่อน (แบบเดียวกับการ์ดบนบอร์ดงาน)
 */
export default async function RequestsPage() {
  const { session, viewer } = await requestsPage();
  const today = bangkokToday();
  const month = today.slice(0, 7);
  const all = await listVisibleRequests(session.orgId, viewer).catch((error: unknown) => {
    console.error("[requests] list failed", error);
    return null;
  });
  // เงินสดย่อยคงเหลือของคนถือเงินแต่ละคน — เห็นเฉพาะคนถือเงิน/HR/ผู้ดูทั้งหมด (คนถือเห็นแค่ของตัวเอง)
  const seesPetty = viewer.canPay || viewer.canViewAll || viewer.isPettyHolder;
  const petty = seesPetty
    ? await (async () => {
        const holders = await prisma.user.findMany({
          where: { orgId: session.orgId, isActive: true, roles: { some: { role: { permissions: { some: { permission: { code: REQ_PERMS.pettyCash } } } } } } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        const bal = await withRequestsTenant(session.orgId, (tx) => pettyBalances(tx, session.orgId)).catch(() => new Map<string, number>());
        return holders
          .filter((h) => viewer.canPay || viewer.canViewAll || h.id === viewer.userId)
          .map((h) => ({ id: h.id, name: h.name, balance: bal.get(h.id) ?? 0 }));
      })()
    : [];
  return <Body all={all} viewer={viewer} today={today} month={month} petty={petty} />;
}

async function Body({
  all,
  viewer,
  today,
  month,
  petty,
}: {
  all: Awaited<ReturnType<typeof listVisibleRequests>> | null;
  viewer: Awaited<ReturnType<typeof requestsPage>>["viewer"];
  today: string;
  month: string;
  petty: { id: string; name: string; balance: number }[];
}) {
  if (!all) {
    return (
      <AppScaffold title="เบิกจ่าย & OT" width="max-w-5xl">
        <Notice tone="danger">โหลดรายการไม่สำเร็จ — ระบบอาจยังไม่ได้อัปเดตฐานข้อมูล (migration) แจ้งไอที</Notice>
      </AppScaffold>
    );
  }
  const live = all.filter((r) => r.status !== "rejected" && r.status !== "cancelled");
  const thisMonth = live.filter((r) => r.workDate.startsWith(month));
  const sumKind = (kinds: RequestKind[]) => round2(thisMonth.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + costOf(r), 0));
  const otMinutes = thisMonth.filter((r) => r.kind === "ot").reduce((s, r) => s + (r.otMinutes ?? 0), 0);
  const advanceOutstanding = round2(
    live.filter((r) => r.kind === "advance" && r.beneficiaryKind === "staff" && r.deductAmount > 0 && !r.deductedAt).reduce((s, r) => s + r.deductAmount, 0),
  );
  const unclear = live.filter((r) => r.kind === "cash_advance" && r.status === "paid" && r.clearStatus !== "cleared");
  const overdueClear = unclear.filter((r) => r.clearDueDate && r.clearDueDate < today);

  const rows: ListRow[] = all.map((r) => {
    const meta = [
      r.kind === "ot" && r.otMinutes ? `${r.otStart}–${r.otEnd} (${hoursText(r.otMinutes)})` : null,
      r.propertyName,
      r.workOrderCode,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: r.id,
      code: r.code,
      kind: r.kind,
      title: r.title,
      meta,
      beneficiaryName: r.beneficiaryName,
      beneficiaryKind: r.beneficiaryKind,
      beneficiaryLabel: beneficiaryLabel(r),
      createdByName: r.createdByName,
      workDate: r.workDate,
      amount: r.netAmount,
      status: statusOf(r),
      waitingMe: canDecide(r, viewer),
      toPay:
        (viewer.canPay && r.status === "approved" && r.beneficiaryUserId !== viewer.userId && !(r.kind === "ot" && r.beneficiaryKind === "worker")) ||
        (viewer.canPay && r.kind === "cash_advance" && r.clearStatus === "submitted" && r.beneficiaryUserId !== viewer.userId),
      mine: r.createdBy === viewer.userId || r.beneficiaryUserId === viewer.userId,
      open: isOpen(r),
    };
  });
  const seesAll = viewer.canViewAll || viewer.canApprove || viewer.canApproveCeo || viewer.canPay;

  const stats = [
    { label: "OT", value: sumKind(["ot"]), sub: `${thisMonth.filter((r) => r.kind === "ot").length} รายการ · ${hoursText(otMinutes)}` },
    { label: "เบิกค่าใช้จ่าย", value: sumKind(["expense", "cash_advance"]), sub: "ทางด่วน น้ำมัน ซื้อของ" },
    { label: "เบิกล่วงหน้า", value: sumKind(["advance"]), sub: advanceOutstanding > 0 ? `พนักงานยังรอหักคืน ${baht(advanceOutstanding)}` : "คนงานหักคืนจากค่าแรงอัตโนมัติ" },
    { label: "ช่าง/ร้านภายนอก", value: sumKind(["contractor"]), sub: `${thisMonth.filter((r) => r.kind === "contractor").length} งาน` },
  ];

  return (
    <RequestsHome
      rows={rows}
      stats={seesAll ? stats : null}
      statsTitle={monthTitle(month)}
      petty={petty}
      overdueNote={
        overdueClear.length > 0 && seesAll
          ? `เบิกเงินไปซื้อของแล้วเลยกำหนดส่งใบเสร็จ ${overdueClear.length} ใบ (${overdueClear.map((r) => `${r.code} ${r.beneficiaryName}`).join(", ")})`
          : null
      }
      showPayTab={viewer.canPay}
      showAllTab={seesAll}
    />
  );
}
