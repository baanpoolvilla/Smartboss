import { hasPermission, hasRole, type OrgSession } from "@smartboss/auth";
import { HR_PERMS } from "@/modules/hr/permissions";

/**
 * ใครเห็นจำนวนวันลารายปีของ "คนอื่น" ได้ — ฝ่ายบุคคล (สิทธิ์จัดการพนักงาน) และ CEO เท่านั้น
 * เจ้าตัวเห็นของตัวเองผ่าน /me/yearly-leave-balances อยู่แล้ว (ผู้ใช้ 5/11/2569)
 *
 * ห้ามใช้สิทธิ์ workforce.leave.approve/manage ตัดสิน: หัวหน้าที่อนุมัติการลาได้ และผู้ดูแลคนงาน
 * (ได้ HR_OFFICER ของ workforce ตาม smartboss-mapping.ts) ไม่ควรรู้ว่าใครได้กี่วัน
 */
export function canSeeYearlyEntitlements(session: OrgSession): boolean {
  return hasPermission(session, HR_PERMS.employeeManage) || hasRole(session, "CEO");
}
