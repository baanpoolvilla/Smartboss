/**
 * สิทธิ์ของโมดูล "คนงานรายวัน" — เห็นเมนู/ข้อมูลคนงานเฉพาะคนที่ได้สิทธิ์ ("จะได้ไม่รก")
 * ค่าตั้งต้นให้ผู้ดูแลบ้าน (CARETAKER) กับเจ้าหน้าที่บุคคล (HR_OFFICER) เท่านั้น — CEO/ADMIN ติ๊กเพิ่มเองได้
 * ที่ /admin/roles · ติ๊ก manage/override แล้วได้ view ให้อัตโนมัติ (setRolePermissionsAction)
 *
 * แคตตาล็อกอยู่ใต้โมดูล hr (ไม่มีแถว Module ของตัวเอง — manifest ใช้ requiresModule: "hr")
 * รหัสตรงกับ DAILY_WORKER_PERMS ใน packages/database/defaults.ts
 */
export const DW_PERMS = {
  view: "daily_worker.view",
  /** ลง/ยกเลิกวันหยุด ลง OT ผูกกะ — ฝั่ง workforce ได้ HR_OFFICER (mapSmartbossRoles) เพื่อเขียนใบวันหยุด/ตารางกะ */
  manage: "daily_worker.manage",
  /** แก้สถานะ ขาด → มา (ต้องใส่เหตุผล) — แยกเพราะมีผลกับค่าแรงทีหลัง */
  override: "daily_worker.override",
} as const;

export const ALL_DW_PERMS: string[] = Object.values(DW_PERMS);

export const DW_PERM_LABELS: Record<string, string> = {
  [DW_PERMS.view]: "คนงานรายวัน: ดูตารางและสรุป",
  [DW_PERMS.manage]: "คนงานรายวัน: จัดการวันหยุด/OT/กะ",
  [DW_PERMS.override]: "คนงานรายวัน: แก้สถานะ ขาด → มา",
};

/** บทบาทของคนงาน — ไม่คิดคะแนน ใช้กติกาลงเวลาของคนงาน */
export const WORKER_ROLE_CODE = "WORKER";
