import { redirect } from "next/navigation";

/**
 * หน้าลงเวลาย้ายเข้าไปเป็นหน้าแรกของระบบบุคคลแล้ว (/hr/clock — เมนูแรก "ลงเวลา") — ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้
 * ("เอาออกจากหน้าหลัก ให้ไปอยู่ใน HR เป็นหัวข้อนึง")
 */
export default function OldClockPage() {
  redirect("/hr/clock");
}
