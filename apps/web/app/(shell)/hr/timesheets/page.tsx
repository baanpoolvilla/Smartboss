import { redirect } from "next/navigation";

/**
 * "Timesheet" รวมเข้ากับ "เงินเดือน" เป็น "รอบจ่าย" หน้าเดียวแล้ว (สเปคข้อ 4.7)
 * เก็บ path เดิมไว้เป็นทางผ่าน — ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้
 */
export default function TimesheetsRedirect() {
  redirect("/hr/payroll");
}
