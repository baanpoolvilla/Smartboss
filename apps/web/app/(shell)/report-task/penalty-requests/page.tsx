import { requireOrg, hasRole, isSuperAdmin } from "@smartboss/auth";
import { PageHeader } from "@/modules/report_task/components/shared/page-header";
import { PenaltyRequestsQueue } from "./penalty-requests-queue";

export const dynamic = "force-dynamic";

/** คิวคำร้องขอแก้ไข/ขอส่งย้อนหลังของคะแนนรายงาน — CEO เท่านั้น (ยืนยันจากผู้ใช้ตรง ๆ) */
export default async function PenaltyRequestsPage() {
  const session = await requireOrg();
  const canDecide = hasRole(session, "CEO") || isSuperAdmin(session);

  if (!canDecide) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="คำร้องขอแก้ไขคะแนน" subtitle="อนุมัติ/ไม่อนุมัติได้เฉพาะ CEO" />
        <div className="rounded-2xl border border-[var(--line)] bg-white p-6 text-sm text-[var(--ink-soft)]">
          หน้านี้เห็นได้เฉพาะ CEO ครับ
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="คำร้องขอแก้ไขคะแนน" subtitle="อนุมัติแล้วคืนคะแนนทันที ไม่ต้องส่งรายงานซ้ำ" />
      <PenaltyRequestsQueue />
    </div>
  );
}
