import Link from "next/link";
import { PenLine } from "lucide-react";

import { AppScaffold } from "@/components/module/app-scaffold";
import { canDecide, listVisibleRequests } from "@/modules/requests/lib/data";
import { beneficiaryLabel, isOpen, requestsPage, statusOf } from "@/modules/requests/lib/page";
import { RequestList, type ListRow } from "@/modules/requests/components/request-list";
import { Notice } from "@/modules/requests/components/ui";
import { KIND_META, bangkokToday, baht, costOf, hoursText, monthTitle, round2, type RequestKind } from "@/modules/requests/lib/types";

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
  return <Body all={all} viewer={viewer} today={today} month={month} />;
}

async function Body({ all, viewer, today, month }: { all: Awaited<ReturnType<typeof listVisibleRequests>> | null; viewer: Awaited<ReturnType<typeof requestsPage>>["viewer"]; today: string; month: string }) {
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
    <AppScaffold
      title="เบิกจ่าย & OT"
      width="max-w-5xl"
      actions={
        <Link href="/requests/new" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-(--app) px-3.5 text-sm font-semibold text-white hover:brightness-95">
          <PenLine className="h-4 w-4" aria-hidden="true" /> ยื่นคำขอ
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        {seesAll && (
          <section aria-label={`ยอดเดือน ${monthTitle(month)}`} className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-3.5">
                <div className="text-xs text-(--ink-soft)">{s.label} · {monthTitle(month)}</div>
                <div className="mt-0.5 text-xl font-bold tabular-nums text-(--ink)">{baht(s.value)}</div>
                <div className="mt-0.5 text-[11px] text-(--ink-soft)">{s.sub}</div>
              </div>
            ))}
          </section>
        )}
        {overdueClear.length > 0 && seesAll && (
          <Notice tone="warn">
            เบิกเงินไปก่อนแล้ว<strong>เลยกำหนดเคลียร์ {overdueClear.length} ใบ</strong> ({overdueClear.map((r) => `${r.code} ${r.beneficiaryName}`).join(", ")})
          </Notice>
        )}
        <RequestList rows={rows} showPayTab={viewer.canPay} showAllTab={seesAll} />
        <section className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
          <h2 className="text-sm font-bold text-(--ink)">ใครยื่น · ใครอนุมัติ · เงินไปลงที่ไหน</h2>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(["ot", "expense", "cash_advance", "advance", "contractor"] as RequestKind[]).map((k) => (
              <div key={k} className="rounded-(--radius) bg-(--bg-soft) p-3 text-xs text-(--ink-soft)">
                <div className="text-sm font-semibold text-(--ink)">{KIND_META[k].label}</div>
                <div className="mt-0.5">{KIND_META[k].who} → {KIND_META[k].approver}</div>
                <div className="mt-0.5">{KIND_META[k].hint}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppScaffold>
  );
}
