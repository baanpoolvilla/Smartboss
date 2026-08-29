import type { ModuleManifest } from "@/module-registry";
import { ADMIN_PERMS } from "./permissions";

export const ADMIN_CODE = "admin";

/**
 * หลังบ้าน — โมดูลแกน (alwaysOn) ทุกบริษัทมีเสมอ ไม่ต้องซื้อ
 * ใครเห็นบ้างขึ้นกับ permission core.* เท่านั้น (ไม่มีสิทธิ์เลย = ไม่เห็นไอคอนบนหน้ารวมแอป)
 */
export const adminManifest: ModuleManifest = {
  id: ADMIN_CODE,
  name: "หลังบ้าน",
  color: "#1B2537",
  colorBg: "#EEF1F6",
  basePath: "/admin",
  icon: "ShieldCheck",
  alwaysOn: true,
  menus: [
    { label: "ภาพรวม", path: "/admin", permission: ADMIN_PERMS.access, icon: "LayoutDashboard" },
    { label: "ผู้ใช้งาน", path: "/admin/users", permission: ADMIN_PERMS.userView, icon: "Users" },
    { label: "บทบาท & สิทธิ์", path: "/admin/roles", permission: ADMIN_PERMS.roleView, icon: "KeyRound" },
    { label: "แผนก", path: "/admin/departments", permission: ADMIN_PERMS.departmentView, icon: "Network" },
    { label: "โมดูล", path: "/admin/modules", permission: ADMIN_PERMS.moduleManage, icon: "Boxes" },
    { label: "ข้อมูลบริษัท", path: "/admin/organization", permission: ADMIN_PERMS.orgManage, icon: "Building2" },
    // เมนูนี้โผล่เฉพาะ SUPER_ADMIN เพราะไม่มีบทบาทไหนถือ core.org.create
    { label: "บริษัททั้งหมด", path: "/admin/organizations", permission: ADMIN_PERMS.orgCreate, icon: "Building" },
    // เมนูนี้โผล่เฉพาะ SUPER_ADMIN เช่นกัน — รวมตั๋วแจ้งปัญหาจากทุกบริษัทมาไว้ที่เดียว
    { label: "แจ้งปัญหาระบบ (ทุกบริษัท)", path: "/admin/issue-reports", permission: ADMIN_PERMS.orgCreate, icon: "LifeBuoy" },
    { label: "ผลงานรายคน", path: "/admin/performance", permission: ADMIN_PERMS.performanceView, icon: "ChartColumn" },
    { label: "ความปลอดภัย", path: "/admin/security", permission: ADMIN_PERMS.securitySettingManage, icon: "ShieldCheck" },
    { label: "ประวัติการใช้งาน", path: "/admin/audit", permission: ADMIN_PERMS.auditView, icon: "History" },
  ],
  permissions: Object.values(ADMIN_PERMS),
};
