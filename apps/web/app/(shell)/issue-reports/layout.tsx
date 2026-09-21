import ReportTaskLayout from "../report-task/layout";

/**
 * "แจ้งบัค" ของ user ทั่วไป — เมนู/โมดูลของตัวเอง (ดู
 * modules/report_task/issue-report-self-manifest.ts) ไม่อยู่ใต้ /report-task
 * อีกต่อไป แต่ข้อมูลตั๋วยังเก็บใน store ของ report_task จึงใช้ตัวห่อเดียวกัน
 * (ตัวเติม store + ตัวตนผู้ใช้) ให้หน้ารายการ/รายละเอียดทำงานได้เหมือนเดิม
 */
export const dynamic = "force-dynamic";

export default ReportTaskLayout;
