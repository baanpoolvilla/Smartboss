/**
 * Data scope — "เห็น/แก้ข้อมูลของใครบ้าง" คนละเรื่องกับ permission ("ทำอะไรได้ใน
 * เมนู") permission มาจาก Role อย่างเดียว (ดู guard.ts/hasPermission) ส่วนไฟล์นี้
 * ตัดสินการมองเห็น record รายตัวจาก 3 อย่าง: เจ้าของ record เอง, หัวหน้าแผนกที่
 * record นั้นสังกัด, หรือสิทธิ์ core.data.view_all/SUPER_ADMIN ที่ข้าม scope ได้
 * ทั้งหมด — pure function ไม่แตะ DB จึง test ได้ตรงไปตรงมา และต้องเรียกจาก
 * server เท่านั้น (headOfDepartmentIds มาจาก loadAuthUser ที่ไม่ใส่ลง JWT)
 */

export interface ScopeCheckArgs {
  viewerId: string;
  viewerHeadOfDeptIds: readonly string[];
  /** core.data.view_all หรือ SUPER_ADMIN — ดู canViewAll ใน guard.ts */
  viewerCanViewAll: boolean;
  recordCreatorId?: string | null;
  recordDepartmentIds: readonly (string | undefined | null)[];
}

/** viewer เห็น record นี้ไหม */
export function canSeeRecord(args: ScopeCheckArgs): boolean {
  if (args.viewerCanViewAll) return true;
  if (args.recordCreatorId && args.recordCreatorId === args.viewerId) return true;
  const dept = new Set(args.recordDepartmentIds.filter(Boolean) as string[]);
  return args.viewerHeadOfDeptIds.some((d) => dept.has(d));
}

/** viewer แก้ record นี้ได้ไหม — ใช้เกณฑ์เดียวกับ see; ยกระดับแยกต่างหากภายหลังได้ถ้าจำเป็น */
export const canEditRecord = canSeeRecord;
