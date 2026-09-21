/**
 * "บริษัทของเรา" (ทีม Smartboss — Goodluckland) ในฐานะฝั่งรับเรื่องแจ้งบัค
 *
 * ระบุบริษัทด้วย env ISSUE_SUPPORT_ORG (ค่า code หรือ slug ของ Organization,
 * ไม่สนตัวพิมพ์เล็ก/ใหญ่) — ไม่ตั้ง = ไม่มีใครได้สิทธิ์ (เหลือแค่ Super Admin)
 *
 * คนในบริษัทเรามี 2 แบบ:
 *   - "it"       แผนก IT / ฝ่ายพัฒนาระบบ — คนรับเรื่องและแก้จริง: เห็นตั๋วทุกบริษัท, รับเรื่อง/ตอบลูกค้า/
 *                เปลี่ยนสถานะ/มอบหมายได้ทุกใบ (บริษัทอื่นแจ้งและดูตั๋วตัวเองได้อย่างเดียว เราเป็น
 *                คนแก้ให้) และได้รับแจ้งเตือนตั๋วใหม่/ผู้แจ้งตอบกลับ
 *   - "observer" CEO/ADMIN — แค่รู้ว่ามีอะไรถูกแจ้งเข้ามา: เห็นตั๋วทุกบริษัทแบบดูอย่างเดียว
 *                ไม่มอบหมายงาน ไม่ได้รับแจ้งเตือน (กันรบกวนเมื่อมีหลายบริษัท)
 * CEO/ADMIN บริษัทลูกค้าอื่นไม่มีสิทธิ์พวกนี้เลย เห็นแค่ตั๋วที่ตัวเองแจ้ง
 *
 * ไฟล์นี้ไม่ import อะไรเลยเพื่อให้เทสต์ตรง ๆ ได้
 */

/** role code ที่เป็น "ผู้สังเกตการณ์" เมื่ออยู่ในบริษัทของเรา (ถ้าไม่ได้อยู่แผนก IT) */
export const SUPPORT_OBSERVER_ROLES = ["ADMIN", "CEO"] as const;

export interface OrgIdentity {
  code?: string | null;
  slug?: string | null;
}

export function configuredSupportOrg(): string | null {
  const v = process.env.ISSUE_SUPPORT_ORG?.trim().toLowerCase();
  return v ? v : null;
}

export function isSupportOrg(org: OrgIdentity | null | undefined, configured = configuredSupportOrg()): boolean {
  const want = configured?.trim().toLowerCase();
  if (!want || !org) return false;
  return [org.code, org.slug].some((v) => v?.trim().toLowerCase() === want);
}

/** ชื่อแผนกนี้คือแผนก IT ไหม — "IT", "แผนก IT", "IT Support", "ไอที", "แผนกไอที",
 * "ฝ่ายพัฒนาระบบ" (ชื่อจริงของบริษัทเรา) ใช่;
 * "Facility", "Digital", "Kit" ไม่ใช่ (ดูเฉพาะคำว่า IT ที่ไม่ติดอักษรอังกฤษอื่น) */
export function isItDepartmentName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /(^|[^a-z])it([^a-z]|$)/i.test(name) || name.includes("ไอที") || name.includes("พัฒนาระบบ");
}

export type SupportRole = "it" | "observer";

/** ต้องตรงกับ SUPER_ADMIN_ROLE ใน @smartboss/auth/permissions (ไฟล์นี้ไม่ import อะไรเพื่อให้เทสต์ตรง ๆ ได้) */
const SUPER_ADMIN_CODE = "SUPER_ADMIN";

/**
 * Super Admin ที่ "เชื่อได้" สำหรับคอนโซลแจ้งบัค — Super Admin ที่สังกัดบริษัทเรา (ISSUE_SUPPORT_ORG)
 * เท่านั้น Super Admin ที่สังกัดบริษัทลูกค้าอื่นไม่ได้สิทธิ์ (ตั๋วของทุกบริษัทไม่ควรถูกเห็นจากบัญชี
 * ของบริษัทอื่น) ยังไม่ได้ตั้ง ISSUE_SUPPORT_ORG = ทำงานแบบเดิม (Super Admin ทุกคนผ่าน) กันไม่ให้
 * ทุกคนโดนล็อกออกก่อนตั้งค่า
 */
export function isTrustedSuperAdmin(
  roles: string[],
  org: OrgIdentity | null | undefined,
  configured = configuredSupportOrg()
): boolean {
  if (!roles.includes(SUPER_ADMIN_CODE)) return false;
  if (!configured?.trim()) return true;
  return isSupportOrg(org, configured);
}

/** บทบาทของผู้ใช้ในบริษัทเรา — null ถ้าไม่ใช่บริษัทเรา/ไม่เข้าข่าย (แผนก IT ชนะ CEO/ADMIN) */
export function supportRoleOf(
  user: { roles: string[]; departmentName?: string | null },
  org: OrgIdentity | null | undefined,
  configured = configuredSupportOrg()
): SupportRole | null {
  if (!isSupportOrg(org, configured)) return null;
  if (isItDepartmentName(user.departmentName)) return "it";
  if (user.roles.some((r) => (SUPPORT_OBSERVER_ROLES as readonly string[]).includes(r))) return "observer";
  return null;
}

export type IssueConsoleAccess = { kind: "full" } | { kind: "home"; orgId: string; role: SupportRole };

/** แก้/ตอบ/รับเรื่อง/ลบตั๋วได้ไหม — full และ IT ของบริษัทเราทำได้ทุกใบ (รวมตั๋วบริษัทอื่น);
 * ผู้สังเกตการณ์ (CEO/ADMIN) ทำไม่ได้เลย */
export function canActOnTickets(access: IssueConsoleAccess): boolean {
  return access.kind === "full" || access.role === "it";
}
