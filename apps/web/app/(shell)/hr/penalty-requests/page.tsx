import { requireOrg, hasRole, isSuperAdmin } from "@smartboss/auth";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { PenaltyRequestsQueue } from "./penalty-requests-queue";
import { ScoreRequestsQueue } from "./score-requests-queue";
import { buildScoreQueue } from "@/lib/score-request-views";

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
      width="max-w-none"
      load={async () => {
        const session = await requireOrg();
        const canDecide = hasRole(session, "CEO") || isSuperAdmin(session);
        // คำขอแก้คะแนน งาน/ใบงาน/PM — เจ้าของเรื่อง (คนสั่งงาน/คนเปิดใบงาน/คนสร้างแผน PM) อนุมัติได้ด้วย ไม่ใช่แค่ CEO
        const score = await buildScoreQueue(session);
        const scoreQueue = <ScoreRequestsQueue pending={score.pending} decided={score.decided} isCeo={score.isCeo} />;

        if (!canDecide) {
          if (score.pending.length === 0 && score.decided.length === 0) {
            return (
              <div className="rounded-2xl border border-(--line) bg-white p-6 text-sm text-(--ink-soft)">
                ไม่มีคำขอแก้คะแนนที่รอคุณพิจารณา — คำร้องเรื่องรายงานอนุมัติได้เฉพาะ CEO
              </div>
            );
          }
          return scoreQueue;
        }

        return (
          <div className="flex flex-col gap-8">
            {scoreQueue}
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-(--ink)">คำร้องเรื่องรายงาน · CEO อนุมัติ</h2>
              <PenaltyRequestsQueue />
            </div>
          </div>
        );
      }}
    />
  );
}
