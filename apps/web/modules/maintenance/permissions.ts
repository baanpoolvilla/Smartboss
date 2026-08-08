/**
 * Permission codes ของโมดูล maintenance (port จาก role capabilities เดิมของ ChangYai)
 * ใช้ทั้งฝั่ง manifest (คุมเมนู), guard หน้า, และ seed (ผูกกับ role)
 */
export const MAINT_PERMS = {
  access: "maintenance.access",

  workorderView: "maintenance.workorder.view",
  workorderManage: "maintenance.workorder.manage",
  workorderComplete: "maintenance.workorder.complete",

  propertyView: "maintenance.property.view",
  propertyManage: "maintenance.property.manage",

  assetView: "maintenance.asset.view",
  assetManage: "maintenance.asset.manage",

  pmView: "maintenance.pm.view",
  pmManage: "maintenance.pm.manage",

  expenseView: "maintenance.expense.view",
  expenseManage: "maintenance.expense.manage",

  contractorView: "maintenance.contractor.view",
  contractorManage: "maintenance.contractor.manage",

  poView: "maintenance.po.view",
  poCreate: "maintenance.po.create",
  poApprove: "maintenance.po.approve",

  admin: "maintenance.admin",
} as const;

export const ALL_MAINT_PERMS: string[] = Object.values(MAINT_PERMS);

/** คำอธิบายไทยของแต่ละสิทธิ์ — ใช้บนหน้า /admin/roles */
export const MAINT_PERM_LABELS: Record<string, string> = {
  [MAINT_PERMS.access]: "เข้าใช้โมดูลแจ้งซ่อมบำรุง",
  [MAINT_PERMS.workorderView]: "ดูใบงาน",
  [MAINT_PERMS.workorderManage]: "สร้าง/แก้ไข/มอบหมายใบงาน",
  [MAINT_PERMS.workorderComplete]: "ปิดงาน (แจ้งว่าทำเสร็จ)",
  [MAINT_PERMS.propertyView]: "ดูรายชื่อบ้าน",
  [MAINT_PERMS.propertyManage]: "เพิ่ม/แก้ไข/ลบบ้าน",
  [MAINT_PERMS.assetView]: "ดูอุปกรณ์",
  [MAINT_PERMS.assetManage]: "เพิ่ม/แก้ไข/ลบอุปกรณ์",
  [MAINT_PERMS.pmView]: "ดูแผนบำรุงรักษา (PM)",
  [MAINT_PERMS.pmManage]: "สร้าง/แก้ไขแผน PM",
  [MAINT_PERMS.expenseView]: "ดูค่าใช้จ่าย",
  [MAINT_PERMS.expenseManage]: "บันทึก/แก้ไขค่าใช้จ่าย",
  [MAINT_PERMS.contractorView]: "ดูรายชื่อผู้รับเหมา/Contact",
  [MAINT_PERMS.contractorManage]: "เพิ่ม/แก้ไขผู้รับเหมา",
  [MAINT_PERMS.poView]: "ดูใบสั่งซื้อ (PR/PO)",
  [MAINT_PERMS.poCreate]: "เปิด PR / สร้างใบสั่งซื้อ",
  [MAINT_PERMS.poApprove]: "อนุมัติใบสั่งซื้อ",
  [MAINT_PERMS.admin]: "ตั้งค่าโมดูลแจ้งซ่อมบำรุง",
};
