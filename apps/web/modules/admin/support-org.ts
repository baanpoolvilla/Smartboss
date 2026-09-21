/**
 * "บริษัทของเรา" (ทีม Smartboss เอง — Goodluckland) ในฐานะฝั่งรับเรื่องแจ้งบัค
 *
 * CEO/ADMIN ของบริษัทนี้เห็นตั๋วแจ้งบัคของทุกบริษัทได้ (ดูอย่างเดียว) และแก้ไข/
 * ตอบ/รับเรื่องได้เฉพาะตั๋วของบริษัทตัวเองเท่านั้น — CEO/ADMIN ของบริษัทลูกค้า
 * อื่นไม่มีสิทธิ์พวกนี้เลย เห็นแค่ตั๋วที่ตัวเองแจ้ง
 *
 * ระบุบริษัทด้วย env ISSUE_SUPPORT_ORG (ค่า code หรือ slug ของ Organization,
 * ไม่สนตัวพิมพ์เล็ก/ใหญ่) — ไม่ตั้ง = ไม่มีใครได้สิทธิ์นี้ (ปลอดภัยไว้ก่อน)
 * ไฟล์นี้ไม่ import อะไรเลยเพื่อให้เทสต์ตรง ๆ ได้
 */

/** role code ที่นับเป็นทีมรับเรื่องเมื่ออยู่ในบริษัทของเรา */
export const SUPPORT_STAFF_ROLES = ["ADMIN", "CEO"] as const;

export interface OrgIdentity {
  code?: string | null;
  slug?: string | null;
}

export function configuredSupportOrg(): string | null {
  const v = process.env.ISSUE_SUPPORT_ORG?.trim().toLowerCase();
  return v ? v : null;
}

export function isSupportOrg(org: OrgIdentity | null | undefined, configured = configuredSupportOrg()): boolean {
  if (!configured || !org) return false;
  return [org.code, org.slug].some((v) => v?.trim().toLowerCase() === configured);
}

/** CEO/ADMIN ของบริษัทของเรา (ไม่รวม Super Admin — ฝั่งนั้นมีสิทธิ์เต็มอยู่แล้ว) */
export function isSupportStaff(roles: string[], org: OrgIdentity | null | undefined, configured = configuredSupportOrg()): boolean {
  return isSupportOrg(org, configured) && roles.some((r) => (SUPPORT_STAFF_ROLES as readonly string[]).includes(r));
}

export type IssueConsoleAccess = { kind: "full" } | { kind: "home"; orgId: string };

/** แก้/ตอบ/รับเรื่อง/ลบได้ไหม — full = ทุกบริษัท, home = เฉพาะตั๋วของบริษัทตัวเอง */
export function canActOnTicketOrg(access: IssueConsoleAccess, ticketOrgId: string): boolean {
  return access.kind === "full" || access.orgId === ticketOrgId;
}
