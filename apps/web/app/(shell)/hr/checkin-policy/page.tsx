import { redirect } from "next/navigation";

/**
 * "นโยบายลงเวลาด้วยมือถือ" ย้ายไปรวมกับ "สถานที่ทำงาน" ที่ /hr/settings/attendance
 * แล้ว — เก็บ path เดิมไว้เป็นทางผ่าน ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้
 */
export default function CheckinPolicyRedirect() {
  redirect("/hr/settings/attendance");
}
