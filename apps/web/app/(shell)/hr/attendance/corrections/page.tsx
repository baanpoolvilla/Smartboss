import { redirect } from "next/navigation";

/**
 * "ลงเวลาแบบ manual" ย้ายไปเป็นแท็บ "คำขอแก้เวลา" ของหน้าหลักแล้ว
 * เก็บ path เดิมไว้เป็นทางผ่าน — ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้
 */
export default function CorrectionsRedirect() {
  redirect("/hr?tab=corrections");
}
