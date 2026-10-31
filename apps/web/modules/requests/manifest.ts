import type { ModuleManifest } from "@/module-registry";
import { WORKER_ROLE_CODE } from "@/modules/daily_worker/permissions";
import { PETTY_PAGE_PERMS, REQ_PERMS, VENDOR_PERMS } from "./permissions";

/** Module.code — ไม่มีแถว Module ใน DB · เปิดตามโมดูลบุคคลของบริษัท (requiresModule) */
export const REQUESTS_CODE = "requests";

/**
 * เบิกจ่าย & OT — ทุกบาทที่ออกนอกเงินเดือนมาลงที่นี่ที่เดียว: OT งานนอกเวลา · เบิกล่วงหน้า ·
 * เบิกค่าใช้จ่าย (ทางด่วน น้ำมัน ซื้อของ) · เบิกเงินไปก่อน · ค่าช่าง/ร้านภายนอก · เงินสดย่อย
 * คนงาน (WORKER) ไม่เห็นเมนู — แอดมิน/ผู้ดูแลลงให้ ยอดเข้าบัญชีคนงานเอง
 */
export const requestsManifest: ModuleManifest = {
  id: REQUESTS_CODE,
  name: "เบิกจ่าย & OT",
  color: "#7C3AED",
  colorBg: "#F4F0FF",
  basePath: "/requests",
  icon: "ReceiptText",
  requiresModule: "hr",
  menus: [
    { label: "รายการคำขอ", path: "/requests", permission: REQ_PERMS.access, icon: "ClipboardList", hideForRoles: [WORKER_ROLE_CODE] },
    { label: "ยื่นคำขอ", path: "/requests/new", permission: REQ_PERMS.access, icon: "PenLine", hideForRoles: [WORKER_ROLE_CODE] },
    { label: "ส่งเข้าเงินเดือน", path: "/requests/payroll", permission: REQ_PERMS.pay, icon: "ScrollText" },
    { label: "เงินสดย่อย", path: "/requests/petty-cash", permission: REQ_PERMS.pettyCash, anyPermission: PETTY_PAGE_PERMS, icon: "Wallet" },
    { label: "รายงาน", path: "/requests/report", permission: REQ_PERMS.viewAll, icon: "ChartColumn" },
    { label: "ช่าง/ร้านภายนอก", path: "/requests/vendors", permission: REQ_PERMS.pettyCash, anyPermission: VENDOR_PERMS, icon: "Contact" },
    { label: "ตั้งค่า", path: "/requests/settings", permission: REQ_PERMS.settings, icon: "Settings" },
  ],
  permissions: Object.values(REQ_PERMS),
};
