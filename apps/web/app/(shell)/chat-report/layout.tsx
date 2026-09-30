import ReportTaskLayout from "../report-task/layout";

/**
 * "Chat & Report" — แชท + รายงาน เป็นโมดูลหลักของตัวเอง (modules/report_task/chat-report-manifest.ts)
 * ย้ายออกมาจาก /report-task แต่ข้อมูลรายงานยังเก็บใน store ของ report_task จึงใช้ตัวห่อเดียวกัน
 * (ตัวเติม store + ตัวตนผู้ใช้) เหมือน /issue-reports
 */
export const dynamic = "force-dynamic";

export default ReportTaskLayout;
