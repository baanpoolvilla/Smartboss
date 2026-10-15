import { redirect } from "next/navigation";
import { getSession, isSuperAdmin } from "@smartboss/auth";

import { WORKER_ROLE_CODE } from "@/modules/daily_worker/permissions";

/**
 * คนงาน (บทบาท WORKER) ไม่ใช้ระบบบุคคล — ลงเวลาที่ "คนงานรายวัน → ลงเวลา" (หน้าเดียวกัน)
 * เมนูซ่อนไว้แล้ว แต่พิมพ์ /hr เข้ามาเองยังเห็นเวลาเข้า–ออกของพนักงานคนอื่นได้ ⇒ พาไปหน้าลงเวลาของตัวเองแทน
 * มีผลเฉพาะคนงาน — ผู้ใช้อื่นผ่านไปตามเดิมทุกอย่าง
 */
export default async function HrLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session && session.roles.includes(WORKER_ROLE_CODE) && !isSuperAdmin(session)) {
    redirect("/daily-workers/clock");
  }
  return children;
}
