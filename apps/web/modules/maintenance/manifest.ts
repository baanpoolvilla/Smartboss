import { createElement } from "react";
import type { ModuleManifest } from "@/module-registry";
import { MAINT_PERMS } from "./permissions";
import { NotifCountBadge } from "@/modules/notifications/notif-count-badge";

/** Shell's RailItem badge slot — เดียวกับที่ report_task's manifest.ts ใช้กับ
 * TaskReviewNavBadge, ให้ตัวเลขที่นี่หน้าตาตรงกัน */
const RAIL_BADGE_CLASS =
  "ml-auto flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white";

/** Module.code ใน DB ต้องตรงกับค่านี้ */
export const MAINTENANCE_CODE = "maintenance";

/** เมนู + ลำดับ ตรงกับ nav ของ ChangYai (shell_screen.dart) */
export const maintenanceManifest: ModuleManifest = {
  id: MAINTENANCE_CODE,
  name: "แจ้งซ่อมบำรุง",
  color: "#0D9488", // teal — ตรงกับสีโมดูล maintenance ใน tokens
  colorBg: "#ECFDF7",
  basePath: "/maintenance",
  icon: "Wrench",
  /**
   * 9 เมนู เรียงและใช้ไอคอนตรงกับ NavigationRail ของ ChangYai
   * หน้า /maintenance/assets และ /maintenance/equipment-overview ไม่อยู่บนราง
   * (ของเดิมก็ไม่มี) — เข้าจากปุ่มบน AppBar ของหน้า "บ้าน" และ "บำรุงรักษา" แทน
   */
  menus: [
    { label: "แดชบอร์ด", path: "/maintenance", permission: MAINT_PERMS.access, icon: "LayoutDashboard" },
    {
      label: "ใบงาน",
      path: "/maintenance/work-orders",
      permission: MAINT_PERMS.workorderView,
      icon: "ClipboardList",
      badge: createElement(NotifCountBadge, { categories: ["work_order"], className: RAIL_BADGE_CLASS }),
    },
    {
      label: "สั่งซื้ออุปกรณ์",
      path: "/maintenance/purchase-orders",
      permission: MAINT_PERMS.poView,
      icon: "ShoppingCart",
      badge: createElement(NotifCountBadge, { categories: ["purchase_order"], className: RAIL_BADGE_CLASS }),
    },
    { label: "บ้าน", path: "/maintenance/properties", permission: MAINT_PERMS.propertyView, icon: "Home" },
    {
      label: "ค่าใช้จ่าย",
      path: "/maintenance/expenses",
      permission: MAINT_PERMS.expenseView,
      icon: "ReceiptText",
      badge: createElement(NotifCountBadge, { categories: ["expense"], className: RAIL_BADGE_CLASS }),
    },
    {
      label: "บำรุงรักษา",
      path: "/maintenance/pm",
      permission: MAINT_PERMS.pmView,
      icon: "Wrench",
      badge: createElement(NotifCountBadge, { categories: ["pm"], className: RAIL_BADGE_CLASS }),
    },
    { label: "Contact", path: "/maintenance/contractors", permission: MAINT_PERMS.contractorView, icon: "Contact" },
    // เดิมชื่อ "จัดการ Roles" ตาม ChangYai — ตอนนี้ผู้ใช้/บทบาทย้ายไป /admin แล้ว
    // หน้านี้เหลือเฉพาะตั้งค่า LINE ของโมดูล จึงเปลี่ยนชื่อให้ตรงกับสิ่งที่ทำจริง
    { label: "ตั้งค่าโมดูล", path: "/maintenance/settings", permission: MAINT_PERMS.admin, icon: "Settings" },
    { label: "Log LINE", path: "/maintenance/settings/line-log", permission: MAINT_PERMS.admin, icon: "History" },
  ],
  permissions: Object.values(MAINT_PERMS),
};
