import type { ModuleManifest } from "@/module-registry";

import { COMPANY_FILES_BASE, COMPANY_FILES_CODE } from "./constants";
import { ALL_COMPANY_FILES_PERMS, COMPANY_FILES_PERMS } from "./permissions";

/**
 * โมดูลไฟล์บริษัท — ที่เก็บไฟล์กลางแบบ SharePoint/Teams Files: โฟลเดอร์ +
 * อัปโหลด/ดาวน์โหลดไฟล์ทุกชนิดที่อนุญาต + พรีวิวในระบบ (รูป/PDF) + เวอร์ชัน
 * ย้อนหลัง + ลิงก์แชร์ (ดู/แก้ไข)
 *
 * ปิดใช้งานทุกบริษัทโดยดีฟอลต์ (ไม่อยู่ใน ENABLED_MODULES ของ
 * packages/database/defaults.ts) — เปิดทีละบริษัทได้ที่ /admin/modules
 * เหมือนโมดูลแชท
 */
export const companyFilesManifest: ModuleManifest = {
  id: COMPANY_FILES_CODE,
  name: "ไฟล์บริษัท",
  color: "#0EA5E9",
  colorBg: "#F0F9FF",
  basePath: COMPANY_FILES_BASE,
  icon: "Folder",
  menus: [
    {
      label: "ไฟล์บริษัท",
      path: COMPANY_FILES_BASE,
      permission: COMPANY_FILES_PERMS.access,
      icon: "Folder",
    },
  ],
  permissions: ALL_COMPANY_FILES_PERMS,
};
