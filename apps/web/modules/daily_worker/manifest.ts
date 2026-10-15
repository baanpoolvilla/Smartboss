import type { ModuleManifest } from "@/module-registry";
import { DW_PERMS } from "./permissions";

/** Module.code — ไม่มีแถว Module ใน DB · เปิดตามโมดูลบุคคลของบริษัท (requiresModule) */
export const DAILY_WORKER_CODE = "daily_worker";

/**
 * โมดูลคนงานรายวัน — คนงาน (บทบาท WORKER) ไม่คิดคะแนน เก็บแค่ลงเวลา วันหยุด และ OT
 * เมนูเห็นเฉพาะคนที่มีสิทธิ์ดู (จัดการ/แก้สถานะได้ = ได้สิทธิ์ดูให้อัตโนมัติ ดู setRolePermissionsAction)
 */
export const dailyWorkerManifest: ModuleManifest = {
  id: DAILY_WORKER_CODE,
  name: "คนงานรายวัน",
  color: "#B45309",
  colorBg: "#FDF3E2",
  basePath: "/daily-workers",
  icon: "HardHat",
  requiresModule: "hr",
  menus: [
    // แยกจาก "ภาพรวม" ของพนักงานประจำ — ใครมา/ไม่มา มากี่โมง กลับกี่โมง แก้ขาดเป็นมาได้ทันที
    { label: "ลงเวลาวันนี้", path: "/daily-workers/today", permission: DW_PERMS.view, icon: "Clock" },
    { label: "ตารางคนงาน", path: "/daily-workers", permission: DW_PERMS.view, icon: "CalendarDays" },
  ],
  permissions: Object.values(DW_PERMS),
};
