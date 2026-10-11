import { redirect } from "next/navigation";

/** หน้าลงเวลาอยู่ที่ /hr (แท็บแรก "ลงเวลา") — ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้ */
export default function OldClockPage() {
  redirect("/hr");
}
