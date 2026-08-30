import { redirect } from "next/navigation";

/**
 * กะทำงานย้ายไปรวมกับค่าตั้งต้นอื่นที่ /hr/settings แล้ว
 * เก็บ path เดิมไว้เป็นทางผ่าน — ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้
 */
export default function ShiftsPage() {
  redirect("/hr/settings");
}
