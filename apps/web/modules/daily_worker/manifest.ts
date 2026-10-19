import type { ModuleManifest } from "@/module-registry";
import { DW_PERMS, WORKER_ROLE_CODE } from "./permissions";
import { HR_PERMS } from "@/modules/hr/permissions";

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
    // คนงาน: ลงเวลาที่นี่ที่เดียว (หน้าเดียวกับ HR → ลงเวลา) — เมนูนี้ขึ้นเฉพาะคนงาน ผู้ดูแลไม่เห็น
    { label: "ลงเวลา", path: "/daily-workers/clock", permission: HR_PERMS.access, icon: "Clock", onlyForRoles: [WORKER_ROLE_CODE] },
    // คนงาน: เข้า–ออกของตัวเองทั้งเดือน แยกจากหน้าลงเวลา
    { label: "เข้าออกของฉัน", path: "/daily-workers/me", permission: HR_PERMS.access, icon: "CalendarDays", onlyForRoles: [WORKER_ROLE_CODE] },
    // แยกจาก "ภาพรวม" ของพนักงานประจำ — ใครมา/ไม่มา มากี่โมง กลับกี่โมง แก้ขาดเป็นมาได้ทันที
    { label: "ลงเวลาวันนี้", path: "/daily-workers/today", permission: DW_PERMS.view, icon: "Clock" },
    { label: "ตารางคนงาน", path: "/daily-workers", permission: DW_PERMS.view, icon: "CalendarDays" },
    // เงินอยู่ที่นี่ที่เดียว (+ หน้ารายคน) — บัญชีค้างจ่าย เบิกก่อน/เก็บไว้ได้ (ผู้ใช้ตกลง 19/10/2569)
    { label: "จ่ายเงิน", path: "/daily-workers/pay", permission: DW_PERMS.view, icon: "Wallet" },
  ],
  permissions: Object.values(DW_PERMS),
};
