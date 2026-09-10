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
    /*
     * หน้าแรกของโมดูล = การลงเวลาของวันนี้
     *
     * เดิมเป็นการ์ดสรุปผลคำนวณย้อนหลัง 30 วัน ซึ่งถูกตัดออกทั้งหมด — สิ่งที่คน
     * เปิดโมดูลบุคคลอยากรู้ก่อนคือ "วันนี้ใครมาแล้ว ใครยังไม่มา" ไม่ใช่ยอดรวม
     * ย้อนหลัง เมนู "การลงเวลา" เดิมจึงถูกยุบมารวมที่นี่ (/hr/attendance
     * ยัง redirect มาให้ ลิงก์เก่าไม่พัง)
     */
    { label: "การลงเวลา", path: "/hr", permission: HR_PERMS.access, icon: "CalendarClock" },
    { label: "พนักงาน", path: "/hr/employees", permission: HR_PERMS.employeeView, icon: "Users" },
    { label: "Timesheet", path: "/hr/timesheets", permission: HR_PERMS.employeeView, icon: "ClipboardList" },
    // แก้เวลาลงงานกระทบเงินเดือนตรง ๆ — ใช้สิทธิ์เดียวกับหน้าจัดการพนักงาน
    // (ตัวบังคับ "ต้อง 2 ผู้จัดการอนุมัติ" จริง ๆ อยู่ที่ workforce API ไม่ใช่ที่นี่)
    { label: "ลงเวลาแบบ manual", path: "/hr/attendance/corrections", permission: HR_PERMS.employeeManage, icon: "ClipboardEdit" },
    // ปฏิทินวันหยุดเปิดให้ทุกคนที่เข้าโมดูลได้ — พนักงานต้องลงวันหยุดเองและเห็นของเพื่อน
    { label: "ปฏิทินวันหยุด", path: "/hr/leave", permission: HR_PERMS.access, icon: "CalendarDays" },
    { label: "ตั้งวันหยุด (HR)", path: "/hr/holidays", permission: HR_PERMS.settingManage, icon: "CalendarCog" },
    /*
     * ผลงานรายคนย้ายมาจากหลังบ้าน — เป็นเรื่องของ HR ไม่ใช่ของผู้ดูแลระบบ
     * ใช้สิทธิ์ core.performance.view ตามเดิม (เมนูรับสิทธิ์ข้ามโมดูลได้)
     * ⇒ กำหนดที่ /admin/roles ว่าให้ผู้จัดการ/CEO เห็น ไม่ต้องเพิ่ม permission ใหม่
     */
    { label: "ผลงานรายคน", path: "/hr/performance", permission: "core.performance.view", icon: "ChartColumn" },
    { label: "เงินเดือน", path: "/hr/payroll", permission: HR_PERMS.payrollView, icon: "Wallet" },
    // ชุดกฎ (อัตราประกันสังคม/ภาษี) อยู่ใต้ payroll controller ของ workforce และ
    // ต้องการ workforce.payroll.read/prepare — ไม่ใช่ settings.manage
    // ถ้าใช้ settingManage เมนูจะโผล่ให้คนที่กดแล้วโดน 403 (เช่น SUPER_ADMIN)
    { label: "ชุดกฎตามกฎหมาย", path: "/hr/rule-sets", permission: HR_PERMS.payrollManage, icon: "Scale" },
    { label: "เครื่องสแกน", path: "/hr/devices", permission: HR_PERMS.settingManage, icon: "Fingerprint" },
    /*
     * พิกัด + รัศมีของแต่ละสถานที่ — ตัวตัดสินว่าการลงเวลาด้วยมือถือผ่านหรือไม่
     * แยกเมนูของตัวเองเพราะต้องตั้งก่อนเปิดใช้ลงเวลาด้วยมือถือ ถ้าซ่อนไว้ใต้
     * "ตั้งค่า HR" จะไม่มีใครรู้ว่าต้องมาตั้งที่นี่ก่อน แล้วพนักงานจะลงเวลาไม่ผ่าน
     * โดยไม่มีอะไรชี้ว่าสาเหตุอยู่ที่ไหน (ดู docs/line-mini-app-checkin-spec.md ข้อ 4.1)
     */
    { label: "สถานที่ทำงาน", path: "/hr/sites", permission: HR_PERMS.settingManage, icon: "MapPin" },
    // คู่กับ "สถานที่ทำงาน" — ต้องตั้งทั้งคู่ถึงจะลงเวลาด้วยมือถือผ่าน
    { label: "นโยบายลงเวลามือถือ", path: "/hr/checkin-policy", permission: HR_PERMS.settingManage, icon: "ShieldCheck" },
    { label: "สลิปของฉัน", path: "/hr/my-payslips", permission: HR_PERMS.access, icon: "ReceiptText" },
    /*
     * ค่าตั้งต้นที่ตั้งครั้งเดียวแล้วมีผลทุกหน้า — กะทำงาน + นโยบายการมาสาย +
     * ประเภทการลา · เดิมกะอยู่เมนูของตัวเองส่วนประเภทการลาซ่อนท้ายปฏิทินวันหยุด
     * จนไม่มีใครหาเจอ /hr/shifts ยังอยู่แต่ redirect มาที่นี่
     */
    { label: "ตั้งค่า HR", path: "/hr/settings", permission: HR_PERMS.settingManage, icon: "Settings" },
    { label: "ประวัติการใช้งาน", path: "/hr/audit", permission: HR_PERMS.settingManage, icon: "History" },
  ],
  permissions: Object.values(HR_PERMS),
};
