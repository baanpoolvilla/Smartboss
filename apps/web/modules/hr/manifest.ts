import type { ModuleManifest } from "@/module-registry";
import { HR_PERMS } from "./permissions";

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
    { label: "หน้าหลัก", path: "/hr", permission: HR_PERMS.access, icon: "CalendarClock" },
    { label: "พนักงาน", path: "/hr/employees", permission: HR_PERMS.employeeView, icon: "Users" },
    { label: "รอบจ่าย", path: "/hr/payroll", permission: HR_PERMS.payrollView, icon: "Wallet" },
    { label: "ตั้งค่า", path: "/hr/settings", permission: HR_PERMS.settingManage, icon: "Settings" },
    { label: "ของฉัน", path: "/hr/my-payslips", permission: HR_PERMS.access, icon: "ReceiptText" },
  ],
  permissions: Object.values(HR_PERMS),
};
