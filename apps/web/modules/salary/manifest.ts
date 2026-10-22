import type { ModuleManifest } from "@/module-registry";
import { WORKER_ROLE_CODE } from "@/modules/daily_worker/permissions";
import { SALARY_PERMS } from "./permissions";

/** Module.code — ไม่มีแถว Module ใน DB · เปิดตามโมดูลบุคคลของบริษัท (requiresModule) */
export const SALARY_CODE = "salary";

/**
 * เงินเดือนพนักงานประจำ (แบบ FlowAccount — ผู้ใช้ 22/10/2569) — เมนูเดียว:
 * พนักงานทั่วไปเปิดแล้วเห็นสลิปของตัวเอง · CEO + คนที่ CEO เลือกเห็นหน้าจัดการ (รอบจ่าย รายชื่อ ตั้งค่า)
 * คนงานรายวันไม่เห็น (จ่ายรายวันที่โมดูลคนงาน)
 */
export const salaryManifest: ModuleManifest = {
  id: SALARY_CODE,
  name: "เงินเดือน",
  color: "#0F766E",
  colorBg: "#ECFDF5",
  basePath: "/salary",
  icon: "Banknote",
  requiresModule: "hr",
  hideForRoles: [WORKER_ROLE_CODE],
  menus: [{ label: "เงินเดือน", path: "/salary", permission: SALARY_PERMS.access, icon: "Banknote" }],
  permissions: Object.values(SALARY_PERMS),
};
