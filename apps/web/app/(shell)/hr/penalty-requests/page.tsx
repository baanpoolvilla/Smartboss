import { requireOrg, hasRole, isSuperAdmin } from "@smartboss/auth";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { PenaltyRequestsQueue } from "./penalty-requests-queue";

/**
 * คิวคำร้องขอแก้ไข/ขอส่งย้อนหลังของคะแนนรายงาน — ย้ายมาอยู่ในระบบบุคคล
 * (เดิมอยู่ที่ /report-task/penalty-requests เพราะสร้างพร้อมฟีเจอร์หักคะแนน
 * รายงาน แต่โดยเนื้อหาเป็นเรื่องคะแนนผลงาน/HR ไม่ใช่รายงานและงาน — ย้ายให้ตรง
 * โมดูลจริง) เปิดดูได้ทุกคน (HR_PERMS.access) แต่**อนุมัติได้เฉพาะ CEO เท่านั้น**
 * (ยืนยันจากผู้ใช้ตรง ๆ, เช็คซ้ำในนี้ ไม่ได้พึ่งแค่การซ่อนเมนู)
 */
export default async function PenaltyRequestsPage() {
  return (
    <HrPage
      title="คำร้องขอแก้ไขคะแนน"
      permission={HR_PERMS.access}
      width="max-w-3xl"
      load={async () => {
        const session = await requireOrg();
        const canDecide = hasRole(session, "CEO") || isSuperAdmin(session);

        if (!canDecide) {
          return (
            <div className="rounded-2xl border border-(--line) bg-white p-6 text-sm text-(--ink-soft)">
              หน้านี้อนุมัติได้เฉพาะ CEO ครับ
            </div>
          );
        }

        return <PenaltyRequestsQueue />;
      }}
    />
  );
}
