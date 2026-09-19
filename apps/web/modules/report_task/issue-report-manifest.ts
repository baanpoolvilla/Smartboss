import type { ModuleManifest } from "@/module-registry";
import { REPORT_TASK_PERMS } from "./permissions";

export const ISSUE_REPORT_CODE = "issue_report";

/**
 * "แจ้งบัค" เป็นรายการเมนูหลักของตัวเองบน Sidebar แยกจาก "รายงานและงาน"
 * โดยตั้งใจ — หน้าจริงยังอยู่ที่ /report-task/issue-reports เหมือนเดิมทุก
 * อย่าง (route/ข้อมูล/สิทธิ์ไม่ย้ายไปไหน) แค่เปลี่ยนทางเข้าบนเมนู เดิมกดถึง
 * ได้แค่ทาง tile หน้าแรก/ปุ่มบน AppBar เท่านั้น ไม่มีในเมนูข้างเลย
 * ("ให้แจ้งบัคมาอยู่ในนี้เลย...เป็นตัวของตัวเองเลยไม่ไปยุ่งกับใคร")
 *
 * alwaysOn เหมือน "หลังบ้าน" — แจ้งปัญหาไม่ใช่โมดูลที่ต้องซื้อ ใครก็แจ้งได้
 * เสมอ (ดู issue-report-app-tile.tsx) จึงข้ามการเช็ค OrgModule ไปเลย ไม่มีแถว
 * `Module` ของ code นี้ใน DB — listOrgModules() กรองแถวที่ alwaysOn ออกจาก
 * หน้า /admin/modules อยู่แล้วโดยไม่ต้องมีแถวจริงให้กรอง
 *
 * คุมการมองเห็นด้วย REPORT_TASK_PERMS.issueView แทน REPORT_TASK_PERMS.access
 * โดยตั้งใจ — ตัวนั้นผูกกับโมดูล "รายงานและงาน" ตรงๆ, ส่วน issueView อยู่ใน
 * BASELINE_PERMS (packages/database/defaults.ts) ทุกบทบาทถือมาตั้งแต่ต้นอยู่
 * แล้วไม่ว่าบริษัทจะเปิดโมดูลรายงานและงานหรือไม่ก็ตาม — ตรงกับที่ตั้งใจให้
 * เมนูนี้ไม่ผูกกับการเปิด/ปิดโมดูลอื่น
 */
export const issueReportManifest: ModuleManifest = {
  id: ISSUE_REPORT_CODE,
  name: "แจ้งบัค",
  color: "#dc2626",
  colorBg: "#fef2f2",
  basePath: "/report-task/issue-reports",
  icon: "Bug",
  alwaysOn: true,
  menus: [{ label: "แจ้งบัค", path: "/report-task/issue-reports", permission: REPORT_TASK_PERMS.issueView, icon: "Bug" }],
  permissions: [REPORT_TASK_PERMS.issueView],
};
