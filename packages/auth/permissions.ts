/*
 * ค่าคงที่เรื่องสิทธิ์ที่ทั้งฝั่ง server และ client ต้องใช้ร่วมกัน
 *
 * แยกออกจาก guard.ts เพราะไฟล์นั้นเป็น "server-only" — แต่ตัวกรองเมนูบน Shell
 * ทำงานฝั่ง client ด้วย ถ้า import จาก guard.ts จะพังตอน build
 */

export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

/**
 * สิทธิ์ที่ SUPER_ADMIN **ข้ามไม่ได้** — ต้องได้รับมอบมาจริงเท่านั้น
 *
 * เจ้าของแพลตฟอร์มต้องดูแลระบบให้บริษัทลูกค้าได้ทุกอย่าง (ผู้ใช้ บทบาท โมดูล ตั้งค่า)
 * แต่ **เงินเดือนรายบุคคลไม่ใช่ข้อมูลที่ผู้ให้บริการควรเห็น** — เป็นข้อมูลส่วนบุคคล
 * ของพนักงานบริษัทลูกค้า ไม่เกี่ยวกับการดูแลระบบ
 *
 * ครอบเฉพาะ "ตัวเลขรายคน" — การตั้งค่าวิธีคำนวณ (hr.setting.manage เช่น
 * ชุดกฎประกันสังคม/ภาษี) ยังทำได้ เพราะเป็นการตั้งค่าระบบ ไม่ใช่ข้อมูลส่วนบุคคล
 *
 * รหัสตรงกับ HR_PERMS ใน apps/web/modules/hr/permissions.ts
 * (ประกาศซ้ำที่นี่เพราะ packages/auth ต้องไม่ import จาก apps/)
 *
 * ⚠ ขอบเขตของการป้องกันนี้: กันไม่ให้ "เห็นโดยปริยาย" ไม่ใช่กันคนที่ตั้งใจเลี่ยง
 * SUPER_ADMIN ยังสร้าง role ใหม่ในบริษัทแล้วมอบสิทธิ์ให้ตัวเองได้ — แต่ต้องทำ
 * อย่างจงใจและถูกบันทึกใน audit log ต่างจากเดิมที่เห็นได้ทันทีโดยไม่มีร่องรอย
 */
export const SUPER_ADMIN_DENIED_PERMISSIONS: ReadonlySet<string> = new Set([
  "hr.salary.view",
  "hr.salary.manage",
  "hr.payroll.view",
  "hr.payroll.manage",
  "hr.payroll.approve",
]);

/** true = สิทธิ์นี้ SUPER_ADMIN ข้ามไม่ได้ ต้องถือจริงถึงจะผ่าน */
export function isDeniedToSuperAdmin(permission: string): boolean {
  return SUPER_ADMIN_DENIED_PERMISSIONS.has(permission);
}

/**
 * ตัวตัดสินกลางว่าผู้ใช้มีสิทธิ์นี้ไหม — ใช้ทั้งฝั่ง server (guard) และ client (เมนู)
 * เขียนที่เดียวเพื่อไม่ให้ทั้งสองฝั่งตัดสินไม่ตรงกัน
 */
export function resolvePermission({
  permissions,
  roles,
  permission,
}: {
  permissions: readonly string[];
  roles: readonly string[];
  permission: string;
}): boolean {
  if (permissions.includes(permission)) return true;
  return roles.includes(SUPER_ADMIN_ROLE) && !isDeniedToSuperAdmin(permission);
}
