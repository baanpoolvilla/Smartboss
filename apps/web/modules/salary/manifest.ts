import type { ModuleManifest, ModuleMenuItem } from "@/module-registry";
import { WORKER_ROLE_CODE } from "@/modules/daily_worker/permissions";
import { REQ_PERMS } from "@/modules/requests/permissions";
import { SALARY_EDIT_MENU, SALARY_PERMS } from "./permissions";

/** Module.code — ไม่มีแถว Module ใน DB · เปิดตามโมดูลบุคคลของบริษัท (requiresModule) */
export const SALARY_CODE = "salary";

/**
 * การเงินพนักงาน — เงินเดือน + ค่าคอม + เบิกจ่าย & OT + เงินสดย่อย ในที่เดียว (ผู้ใช้เลือก "แบบ B เมนูซ้ายแบ่งกลุ่ม" 30/10/2569)
 * หน้าเดิมทั้งหมดอยู่ที่ path เดิม (/salary, /requests) — แค่รวมเมนูไว้ในโมดูลเดียว (extraPaths)
 *
 * ใครเห็นเมนูไหน:
 *  - SALARY_EDIT_MENU = คนทำเงินเดือน (CEO + คนที่ CEO เลือก — lib/nav.ts กรองให้ ไม่ใช่สิทธิ์ตามบทบาท)
 *  - เมนูเบิกจ่ายใช้สิทธิ์ requests.* เดิมทุกอัน · พนักงานทั่วไปเห็นแค่ คำขอ / ยื่นคำขอ / สลิปของฉัน
 * คนงานรายวันไม่เห็นทั้งโมดูล (จ่ายรายวันที่โมดูลคนงาน · OT/เบิกของคนงานแอดมินลงให้)
 */
/**
 * เมนูการเงินพนักงาน — แสดงเป็นกลุ่มในระบบบุคคล (modules/hr/manifest.ts) ตั้งแต่ 30/10/2569
 * salaryManifest ไม่อยู่ใน moduleRegistry แล้ว (ไม่มีไอคอนแยกบนหน้าแรก) — เก็บไว้เป็นที่รวมเมนูชุดนี้
 */
export const MONEY_MENUS: ModuleMenuItem[] = [
    { group: "การเงิน · ทำทุกเดือน", label: "ทำเงินเดือน", path: "/salary", permission: SALARY_EDIT_MENU, icon: "Banknote", activeFor: ["/salary/runs"], hideForRoles: [WORKER_ROLE_CODE] },
    { group: "การเงิน · ทำทุกเดือน", label: "ค่าคอม", path: "/salary/commission", permission: SALARY_EDIT_MENU, icon: "HandCoins", hideForRoles: [WORKER_ROLE_CODE] },

    { group: "การเงิน · คำขอเงิน", label: "OT & เบิกจ่าย", path: "/requests", permission: REQ_PERMS.access, icon: "ClipboardList", hideForRoles: [WORKER_ROLE_CODE] },
    { group: "การเงิน · คำขอเงิน", label: "ยื่นคำขอ", path: "/requests/new", permission: REQ_PERMS.access, icon: "PenLine", hideForRoles: [WORKER_ROLE_CODE] },
    { group: "การเงิน · คำขอเงิน", label: "เงินสดย่อย", path: "/requests/petty-cash", permission: REQ_PERMS.pettyCash, icon: "Wallet", hideForRoles: [WORKER_ROLE_CODE] },
    { group: "การเงิน · คำขอเงิน", label: "ส่งเข้าเงินเดือน", path: "/requests/payroll", permission: REQ_PERMS.pay, icon: "ScrollText", hideForRoles: [WORKER_ROLE_CODE] },
    { group: "การเงิน · คำขอเงิน", label: "ช่าง/ร้านภายนอก", path: "/requests/vendors", permission: REQ_PERMS.fileOthers, icon: "Contact", hideForRoles: [WORKER_ROLE_CODE] },

    { group: "การเงิน · ข้อมูล", label: "เงินเดือนรายคน", path: "/salary/employees", permission: SALARY_EDIT_MENU, icon: "Users", hideForRoles: [WORKER_ROLE_CODE] },
    { group: "การเงิน · ข้อมูล", label: "รายงานเบิกจ่าย", path: "/requests/report", permission: REQ_PERMS.viewAll, icon: "ChartColumn", hideForRoles: [WORKER_ROLE_CODE] },

    { group: "การเงิน · ตั้งค่า & อื่น ๆ", label: "ตั้งค่าเงินเดือน", path: "/salary/settings", permission: SALARY_EDIT_MENU, icon: "Settings", hideForRoles: [WORKER_ROLE_CODE] },
    { group: "การเงิน · ตั้งค่า & อื่น ๆ", label: "ตั้งค่าเบิกจ่าย", path: "/requests/settings", permission: REQ_PERMS.settings, icon: "Settings", hideForRoles: [WORKER_ROLE_CODE] },
    { group: "การเงิน · ตั้งค่า & อื่น ๆ", label: "คู่มือ", path: "/salary/guide", permission: SALARY_EDIT_MENU, icon: "BookOpen", hideForRoles: [WORKER_ROLE_CODE] },
    { group: "การเงิน · ตั้งค่า & อื่น ๆ", label: "สลิปของฉัน", path: "/salary/my", permission: SALARY_PERMS.access, icon: "ReceiptText", hideForRoles: [WORKER_ROLE_CODE] },
];

export const salaryManifest: ModuleManifest = {
  id: SALARY_CODE,
  name: "การเงินพนักงาน",
  // สีเดียวกับเบิกจ่าย & OT เดิม (packages/ui/tokens.css [data-app="salary"])
  color: "#7C3AED",
  colorBg: "#F4F0FF",
  basePath: "/salary",
  extraPaths: ["/requests"],
  icon: "Banknote",
  requiresModule: "hr",
  hideForRoles: [WORKER_ROLE_CODE],
  menus: MONEY_MENUS,
  permissions: Object.values(SALARY_PERMS),
};
