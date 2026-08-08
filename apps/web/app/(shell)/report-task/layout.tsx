import { requireOrg } from "@smartboss/auth";

import { ReportTaskScaffold } from "@/modules/report_task/components/shared/report-task-scaffold";

/**
 * ตัวห่อระดับโมดูลรายงานและงาน
 *
 * เดิมงานพวกนี้อยู่ใน AppShell ของแอป workspace ที่รันเดี่ยว ๆ (พร้อม sidebar/topbar)
 * ตอนพอร์ตเข้ามา sidebar/topbar เป็นของ shell กลาง เหลือแค่ AppScaffold กับ
 * ตัวเติมข้อมูลให้ store ซึ่งย้ายไปอยู่ใน ReportTaskScaffold ทั้งหมด
 *
 * ส่ง userId ของคนที่ล็อกอินลงไปด้วย เพราะโมดูลต้นทางออกแบบไว้ตอนยังไม่มี auth
 * (มีตัวสลับ "ดูในนามของ") — ที่นี่ต้องผูกกับคนจริงเพื่อให้คะแนนที่หักไปเข้าคนถูก
 */
export default async function ReportTaskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireOrg();
  return <ReportTaskScaffold currentUserId={session.userId}>{children}</ReportTaskScaffold>;
}
