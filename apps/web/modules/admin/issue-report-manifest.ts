import type { ModuleManifest } from "@/module-registry";
import { ADMIN_PERMS } from "./permissions";

export const ADMIN_ISSUE_REPORT_CODE = "admin_issue_report";

/**
 * "แจ้งบัค" (รับเรื่องทุกบริษัท) เป็นเมนูหลักแยกของตัวเอง ไม่ซ้อนอยู่ใต้
 * "หลังบ้าน" อีกต่อไป — หน้าจริงยังอยู่ที่ /admin/issue-reports เหมือนเดิม
 * ทุกอย่าง (route/ข้อมูล/สิทธิ์ไม่ย้าย) แค่เปลี่ยนตำแหน่งบน Sidebar ตามที่ขอ
 * ("อยากให้ไปอยู่ในเมนูแยกเลยอะ แบบเป็นของแจ้งบัคเองเลย")
 *
 * alwaysOn เหมือน "หลังบ้าน" เอง — ไม่ใช่โมดูลที่ต้องซื้อ ไม่มีแถว `Module`
 * ของ code นี้ใน DB (ดู listOrgModules ที่กรองแถว alwaysOn ออกจากหน้า
 * /admin/modules อยู่แล้วโดยไม่ต้องมีแถวจริงให้กรอง)
 *
 * ใช้ ADMIN_PERMS.orgCreate เป็นตัวคุมการมองเห็นเหมือนเดิมเป๊ะ — permission
 * เดียวกับที่เมนูนี้เคยใช้ตอนยังอยู่ใต้ manifest.ts ("บริษัททั้งหมด"/"พื้นที่
 * จัดเก็บไฟล์" ก็ใช้ตัวเดียวกัน) ไม่มีบทบาทไหนถือ core.org.create นอกจาก
 * SUPER_ADMIN (ดู packages/database/defaults.ts) จึงเห็นเฉพาะทีม Smartboss
 * เท่านั้น ไม่ใช่ ADMIN/CEO ของบริษัทลูกค้าทั่วไป
 *
 * basePath ซ้อนอยู่ใต้ "/admin" ของ adminManifest ตั้งใจ — shell.tsx's
 * findActiveModule() เลือก basePath ที่ยาวที่สุดที่ match แทน first-match
 * อยู่แล้ว (แก้ไว้รอบที่ทำ manifest ลักษณะนี้ให้ "แจ้งบัค" ฝั่งลูกค้าตอนแรก)
 * จึงไม่ชนกับ "หลังบ้าน" — เข้า /admin/issue-reports แล้ว Sidebar จะโชว์แค่
 * เมนูของโมดูลนี้ ไม่ปนกับเมนูอื่นของ "หลังบ้าน"
 */
export const adminIssueReportManifest: ModuleManifest = {
  id: ADMIN_ISSUE_REPORT_CODE,
  name: "แจ้งบัค",
  color: "#dc2626",
  colorBg: "#fef2f2",
  basePath: "/admin/issue-reports",
  icon: "Bug",
  alwaysOn: true,
  menus: [{ label: "แจ้งบัค", path: "/admin/issue-reports", permission: ADMIN_PERMS.orgCreate, icon: "Bug" }],
  permissions: [ADMIN_PERMS.orgCreate],
};
