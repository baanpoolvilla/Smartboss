import { redirect } from "next/navigation";

/**
 * "สถานที่ทำงาน" ย้ายไปรวมกับ "นโยบายลงเวลาด้วยมือถือ" ที่ /hr/settings/attendance
 * แล้ว — รัศมีของสถานที่ทับค่าของนโยบายเสมอ แยกหน้ากันทำให้มองไม่เห็นความสัมพันธ์นี้
 * เก็บ path เดิมไว้เป็นทางผ่าน — ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้
 */
export default function SitesRedirect() {
  redirect("/hr/settings/attendance");
}
