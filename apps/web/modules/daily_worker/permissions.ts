/**
 * สิทธิ์ของโมดูล "คนงานรายวัน" — เห็นเมนู/ข้อมูลคนงานเฉพาะคนที่ได้สิทธิ์ ("จะได้ไม่รก")
 * ค่าตั้งต้น: ผู้ดูแลบ้าน (CARETAKER) = view/manage/override · เจ้าหน้าที่บุคคล (HR_OFFICER) = ทุกตัว
 * CEO = view + pay (ดูยอดเงิน + ตั้งค่าแรง ไม่ทำงานหน้างาน — ผู้ใช้ตกลง 19/10/2569) · ADMIN ติ๊กเพิ่มเองที่ /admin/roles
 * ติ๊ก manage/override/pay แล้วได้ view ให้อัตโนมัติ (setRolePermissionsAction)
 *
 * แคตตาล็อกอยู่ใต้โมดูล hr (ไม่มีแถว Module ของตัวเอง — manifest ใช้ requiresModule: "hr")
 * รหัสตรงกับ DAILY_WORKER_PERMS ใน packages/database/defaults.ts
 */
export const DW_PERMS = {
  view: "daily_worker.view",
  /** ลง/ยกเลิกวันหยุด ลง OT ผูกกะ — ฝั่ง workforce ได้ HR_OFFICER (mapSmartbossRoles) เพื่อเขียนใบวันหยุด/ตารางกะ */
  manage: "daily_worker.manage",
  /** แก้เวลาเข้า-ออก / แก้สถานะ (ต้องใส่เหตุผล) — แยกเพราะมีผลกับค่าแรง */
  override: "daily_worker.override",
  /** ตั้งค่าแรงต่อวัน / % OT — แยกจากงานหน้างาน: คนแก้เวลาไม่ควรเป็นคนตั้งเงินเองด้วย (19/10/2569) */
  pay: "daily_worker.pay",
} as const;

export const ALL_DW_PERMS: string[] = Object.values(DW_PERMS);

export const DW_PERM_LABELS: Record<string, string> = {
  [DW_PERMS.view]: "คนงานรายวัน: ดูตารางและสรุป",
  [DW_PERMS.manage]: "คนงานรายวัน: จัดการวันหยุด/OT/กะ",
  [DW_PERMS.override]: "คนงานรายวัน: แก้เวลาเข้า-ออก",
  [DW_PERMS.pay]: "คนงานรายวัน: ตั้งค่าแรง/% OT",
};

/** บทบาทของคนงาน — ไม่คิดคะแนน ใช้กติกาลงเวลาของคนงาน */
export const WORKER_ROLE_CODE = "WORKER";
