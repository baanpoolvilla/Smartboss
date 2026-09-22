import { createElement } from "react";
import type { ModuleManifest } from "@/module-registry";
import { HR_PERMS } from "./permissions";
import { NotifCountBadge } from "@/modules/notifications/notif-count-badge";

/** Module.code ใน DB ต้องตรงกับค่านี้ */
export const HR_CODE = "hr";

/**
 * โมดูลบุคคล — หน้าจอเป็นของ Smartboss แต่ข้อมูลทั้งหมดมาจาก workforce API
 * (ดู docs/workforce_integration.md)
 *
 * เมนู 5 กลุ่มตามงานของผู้ใช้ (ยุบจาก 15 รายการเดิมที่เรียงตามโครงสร้าง
 * ฐานข้อมูล) — แต่ละกลุ่มอาจมีหลาย tab อยู่ข้างในผ่าน `?tab=` query param
 * (ดู /hr/page.tsx, /hr/employees/page.tsx) ไม่ใช่ route แยก เพื่อให้แต่ละ
 * เมนูยังคุมสิทธิ์ได้ตรงจุดเหมือนเดิม ทุก URL เดิมยัง redirect มาที่ใหม่
 * (ดูไฟล์ page.tsx ที่ path เดิมของแต่ละอัน)
 */
export const hrManifest: ModuleManifest = {
  id: HR_CODE,
  name: "ระบบบุคคล",
  color: "#3B82F6",
  colorBg: "#EFF5FF",
  basePath: "/hr",
  icon: "Users",
  menus: [
    {
      label: "หน้าหลัก",
      path: "/hr",
      permission: HR_PERMS.access,
      icon: "CalendarClock",
      // คำขอลา/แก้เวลาเข้า-ออกงานที่รออนุมัติ — ทั้งคู่จัดการอยู่ที่หน้านี้
      // (ปฏิทิน/การ์ดแก้เวลาบนแดชบอร์ด, ดู home-calendar.tsx/home-corrections.tsx)
      // ไม่มีเมนูย่อยแยกให้ผูกเฉพาะจุด เลยติดรวมไว้ที่เมนูบนสุดนี้
      badge: createElement(NotifCountBadge, {
        categories: ["hr_leave", "hr_attendance"],
        className:
          "ml-auto flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white",
      }),
    },
    { label: "พนักงาน", path: "/hr/employees", permission: HR_PERMS.employeeView, icon: "Users" },
    { label: "รอบจ่าย", path: "/hr/payroll", permission: HR_PERMS.payrollView, icon: "Wallet" },
    { label: "ตั้งค่า", path: "/hr/settings", permission: HR_PERMS.settingManage, icon: "Settings" },
    { label: "ของฉัน", path: "/hr/my-payslips", permission: HR_PERMS.access, icon: "ReceiptText" },
    // ทุกคนเข้าได้ (HR_PERMS.access เดียวกับเมนู "ของฉัน") — คนละสิทธิ์กับหน้า
    // "คะแนน & เกรด" ของทั้งบริษัท (core.performance.view, ADMIN/CEO/MANAGER
    // เท่านั้น) หน้านี้เห็น "คะแนนของฉัน" คนเดียว ยื่นคำร้องขอแก้ไขได้เอง
    // (เดิมยื่นได้แค่จากหน้าคะแนนรวมที่พนักงานทั่วไปเข้าไม่ถึงด้วยซ้ำ)
    { label: "คะแนนของฉัน", path: "/hr/my-score", permission: HR_PERMS.access, icon: "Award" },
  ],
  permissions: Object.values(HR_PERMS),
};
