import { AppScaffold } from "@/components/module/app-scaffold";
import { loadScorePeriodConfig } from "@/lib/score-period-config";
import { scorePeriodLabel, scorePeriodOf, scorePeriodRange } from "@/lib/score-period";
import { REQ_PERMS } from "@/modules/requests/permissions";
import { loadRequests, withRequestsTenant } from "@/modules/requests/lib/db";
import { requestsPage } from "@/modules/requests/lib/page";
import { PayrollForm, type PayrollItem } from "@/modules/requests/components/payroll-form";
import { round2 } from "@/modules/requests/lib/types";

export const dynamic = "force-dynamic";

/**
 * ส่งเข้าเงินเดือน — งวดเดียวกับรอบเกรด (ตัดวันที่ 25 — lib/score-period.ts)
 * บวก: OT พนักงานที่อนุมัติแล้วยังไม่จ่าย (ทำงานถึงวันสิ้นงวด) · หัก: เบิกล่วงหน้า/เงินเบิกไปก่อนที่ขาดคืน ที่ยังไม่หัก
 * ของงวดก่อนที่ยังไม่ได้ทำ ยกมาด้วย (ไม่มีอะไรหลุดหาย)
 */
export default async function RequestsPayrollPage() {
  const { session } = await requestsPage(REQ_PERMS.pay);
  const orgId = session.orgId;
  const config = await loadScorePeriodConfig(orgId);
  const period = scorePeriodOf(config, new Date());
  const range = scorePeriodRange(config, period);
  const { pays, deducts } = await withRequestsTenant(orgId, async (tx) => ({
    pays: await loadRequests(tx, orgId, { kind: "ot", status: "approved", beneficiaryKind: "staff", workDate: { lte: range.to } }, 500),
    deducts: await loadRequests(tx, orgId, { beneficiaryKind: "staff", deductedAt: null, deductAmount: { gt: 0 } }, 500),
  }));
  const toItem = (r: (typeof pays)[number], amount: number, note: string): PayrollItem => ({
    id: r.id,
    code: r.code,
    name: r.beneficiaryName,
    title: r.title,
    date: r.workDate,
    amount,
    note,
    self: r.beneficiaryUserId === session.userId,
  });

  return (
    <AppScaffold title="ส่งเข้าเงินเดือน" backHref="/requests" width="max-w-4xl">
      <div className="flex flex-col gap-4">
        <div className="rounded-(--radius-lg) border border-(--line) bg-(--bg) px-4 py-3 text-sm">
          งวด <strong>{scorePeriodLabel(config, period)}</strong> — ตามรอบตัดเกรด
        </div>
        <PayrollForm
          period={period}
          periodLabel={scorePeriodLabel(config, period)}
          pays={pays.map((r) => toItem(r, round2(r.netAmount - r.paidTotal), r.otMinutes ? `${r.otStart}–${r.otEnd}` : ""))}
          deducts={deducts.map((r) => toItem(r, r.deductAmount, r.kind === "advance" ? "เบิกล่วงหน้า" : "เบิกไปก่อนแล้วไม่ได้คืน"))}
        />
      </div>
    </AppScaffold>
  );
}
