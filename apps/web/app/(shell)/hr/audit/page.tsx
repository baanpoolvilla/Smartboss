import { redirect } from "next/navigation";

/**
 * "ประวัติการใช้งาน" ย้ายไปอยู่ใต้ /hr/settings แล้ว (ยุบเมนู 15 → 5 กลุ่ม)
 * เก็บ path เดิมไว้เป็นทางผ่าน — ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้
 */
export default function AuditRedirect() {
  redirect("/hr/settings/audit");
}
