import type { ModuleManifest } from "@/module-registry";
import { HR_PERMS } from "./permissions";

/** Module.code ใน DB ต้องตรงกับค่านี้ */
export const HR_CODE = "hr";

/**
 * โมดูลบุคคล — หน้าจอเป็นของ Smartboss แต่ข้อมูลทั้งหมดมาจาก workforce API
 * (ดู docs/workforce_integration.md)
 *
 * เมนูมากกว่าโมดูล hr เดิม เพราะของใหม่มีเรื่องลงเวลาที่ของเดิมไม่มีเลย
 */
export const hrManifest: ModuleManifest = {
  id: HR_CODE,
  name: "ระบบบุคคล",
  color: "#3B82F6",
  colorBg: "#EFF5FF",
  basePath: "/hr",
  icon: "Users",
  menus: [
    { label: "ภาพรวม", path: "/hr", permission: HR_PERMS.access, icon: "LayoutDashboard" },
    { label: "พนักงาน", path: "/hr/employees", permission: HR_PERMS.employeeView, icon: "Users" },
    // แยกจาก "ผลลงเวลา" ชัดเจน — อันนี้คือข้อมูลดิบที่เครื่องส่งมา
    // อีกอันคือผลที่คำนวณแล้ว คนละเรื่องและใช้ตอนคนละสถานการณ์
    { label: "การลงเวลา", path: "/hr/time-events", permission: HR_PERMS.employeeView, icon: "Fingerprint" },
    { label: "ผลลงเวลา", path: "/hr/attendance", permission: HR_PERMS.employeeView, icon: "CalendarClock" },
    { label: "Timesheet", path: "/hr/timesheets", permission: HR_PERMS.employeeView, icon: "ClipboardList" },
    { label: "กะทำงาน", path: "/hr/shifts", permission: HR_PERMS.settingManage, icon: "Clock" },
    // ปฏิทินวันหยุดเปิดให้ทุกคนที่เข้าโมดูลได้ — พนักงานต้องขอลาเองและเห็นของเพื่อน
    { label: "ปฏิทินวันหยุด", path: "/hr/leave", permission: HR_PERMS.access, icon: "CalendarDays" },
    { label: "ตั้งวันหยุด (HR)", path: "/hr/holidays", permission: HR_PERMS.settingManage, icon: "CalendarCog" },
    { label: "เงินเดือน", path: "/hr/payroll", permission: HR_PERMS.payrollView, icon: "Wallet" },
    // ชุดกฎ (อัตราประกันสังคม/ภาษี) อยู่ใต้ payroll controller ของ workforce และ
    // ต้องการ workforce.payroll.read/prepare — ไม่ใช่ settings.manage
    // ถ้าใช้ settingManage เมนูจะโผล่ให้คนที่กดแล้วโดน 403 (เช่น SUPER_ADMIN)
    { label: "ชุดกฎตามกฎหมาย", path: "/hr/rule-sets", permission: HR_PERMS.payrollManage, icon: "Scale" },
    { label: "เครื่องสแกน", path: "/hr/devices", permission: HR_PERMS.settingManage, icon: "Fingerprint" },
    { label: "สลิปของฉัน", path: "/hr/my-payslips", permission: HR_PERMS.access, icon: "ReceiptText" },
    { label: "ประวัติการใช้งาน", path: "/hr/audit", permission: HR_PERMS.settingManage, icon: "History" },
  ],
  permissions: Object.values(HR_PERMS),
};
