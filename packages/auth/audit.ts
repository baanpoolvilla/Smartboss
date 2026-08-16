import { prisma } from "@smartboss/database";

export type AuditAction =
  // ── auth ──
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "ACCOUNT_LOCKED"
  | "LOGOUT"
  | "TOKEN_REFRESH"
  | "TOKEN_REUSE_DETECTED"
  // ── หลังบ้าน (/admin) ──
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_DELETED"
  | "USER_ENABLED"
  | "USER_DISABLED"
  | "USER_ROLES_CHANGED"
  | "USER_PASSWORD_RESET"
  | "USER_PASSWORD_CHANGED"
  | "USER_ORG_MOVED"
  | "ROLE_CREATED"
  | "ROLE_UPDATED"
  | "ROLE_DELETED"
  | "ROLE_PERMISSIONS_CHANGED"
  | "DEPARTMENT_CREATED"
  | "DEPARTMENT_UPDATED"
  | "DEPARTMENT_DELETED"
  | "DEPARTMENT_HEAD_ADDED"
  | "DEPARTMENT_HEAD_REMOVED"
  | "USER_DEPARTMENT_CHANGED"
  | "MODULE_ENABLED"
  | "MODULE_DISABLED"
  | "ORG_UPDATED"
  | "ORG_CREATED"
  | "ORG_WORKFORCE_PROVISIONED"
  | "PERFORMANCE_SETTINGS_UPDATED"
  | "SECURITY_SETTINGS_UPDATED"
  | "ACCOUNT_UNLOCKED"
  // ── เงินเดือน ──
  | "PAYROLL_RUN_CREATED"
  | "PAYROLL_RUN_RECALCULATED"
  | "PAYROLL_RUN_APPROVED"
  | "PAYROLL_RUN_PAID"
  | "PAYROLL_RUN_DELETED"
  | "SALARY_CHANGED";

/** ป้ายไทยของ action — ใช้บนหน้า /admin/audit */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "เข้าสู่ระบบสำเร็จ",
  LOGIN_FAILED: "เข้าสู่ระบบไม่สำเร็จ",
  ACCOUNT_LOCKED: "บัญชีถูกล็อก",
  LOGOUT: "ออกจากระบบ",
  TOKEN_REFRESH: "ต่ออายุ session",
  TOKEN_REUSE_DETECTED: "ตรวจพบการใช้ token ซ้ำ",
  USER_CREATED: "สร้างผู้ใช้",
  USER_UPDATED: "แก้ไขผู้ใช้",
  USER_DELETED: "ลบผู้ใช้",
  USER_ENABLED: "เปิดใช้งานผู้ใช้",
  USER_DISABLED: "ปิดใช้งานผู้ใช้",
  USER_ROLES_CHANGED: "เปลี่ยนบทบาทผู้ใช้",
  USER_ORG_MOVED: "ย้ายผู้ใช้ไปบริษัทอื่น",
  USER_PASSWORD_RESET: "รีเซ็ตรหัสผ่าน (แอดมินทำให้)",
  USER_PASSWORD_CHANGED: "เปลี่ยนรหัสผ่านด้วยตัวเอง",
  ROLE_CREATED: "สร้างบทบาท",
  ROLE_UPDATED: "แก้ไขบทบาท",
  ROLE_DELETED: "ลบบทบาท",
  ROLE_PERMISSIONS_CHANGED: "เปลี่ยนสิทธิ์ของบทบาท",
  DEPARTMENT_CREATED: "สร้างแผนก",
  DEPARTMENT_UPDATED: "แก้ไขแผนก",
  DEPARTMENT_DELETED: "ลบแผนก",
  DEPARTMENT_HEAD_ADDED: "เพิ่มหัวหน้าแผนก",
  DEPARTMENT_HEAD_REMOVED: "เอาหัวหน้าแผนกออก",
  USER_DEPARTMENT_CHANGED: "เปลี่ยนแผนกผู้ใช้",
  MODULE_ENABLED: "เปิดใช้โมดูล",
  MODULE_DISABLED: "ปิดใช้โมดูล",
  ORG_UPDATED: "แก้ไขข้อมูลบริษัท",
  ORG_CREATED: "เปิดบริษัทใหม่",
  ORG_WORKFORCE_PROVISIONED: "เปิดใช้โมดูลบุคคลให้บริษัท",
  PERFORMANCE_SETTINGS_UPDATED: "แก้ไขเกณฑ์คะแนนผลงาน",
  SECURITY_SETTINGS_UPDATED: "แก้ไขการตั้งค่าความปลอดภัย",
  ACCOUNT_UNLOCKED: "ปลดล็อกบัญชี",
  PAYROLL_RUN_CREATED: "สร้างรอบจ่ายเงินเดือน",
  PAYROLL_RUN_RECALCULATED: "คำนวณรอบจ่ายใหม่",
  PAYROLL_RUN_APPROVED: "อนุมัติรอบจ่าย",
  PAYROLL_RUN_PAID: "ปิดรอบจ่าย (จ่ายแล้ว)",
  PAYROLL_RUN_DELETED: "ลบรอบจ่าย",
  SALARY_CHANGED: "ปรับฐานเงินเดือน",

  // ── legacy (ตัดออกจาก AuditAction แล้ว ไม่มีทางเขียนใหม่อีก) ──
  // แถวเก่าในฐานข้อมูลก่อน 20260816120000_role_only_department_heads ยังใช้
  // action code พวกนี้อยู่ — เก็บป้ายไทยไว้ไม่ให้ประวัติเก่าอ่านไม่รู้เรื่อง
  // (fallback เดิมคือโชว์ code ดิบ) ไม่ต้องเพิ่มกลับเข้า AuditAction union
  DEPARTMENT_PERMISSIONS_CHANGED: "เปลี่ยนสิทธิ์ของแผนก (เลิกใช้แล้ว)",
  POSITION_CREATED: "สร้างตำแหน่ง (เลิกใช้แล้ว)",
  POSITION_UPDATED: "แก้ไขตำแหน่ง (เลิกใช้แล้ว)",
  POSITION_DELETED: "ลบตำแหน่ง (เลิกใช้แล้ว)",
  POSITION_PERMISSIONS_CHANGED: "เปลี่ยนสิทธิ์ของตำแหน่ง (เลิกใช้แล้ว)",
  USER_DEPARTMENT_POSITION_CHANGED: "เปลี่ยนแผนก/ตำแหน่งผู้ใช้ (เลิกใช้แล้ว)",
};

export interface AuditInput {
  userId?: string | null;
  action: AuditAction;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown> | null;
}

/** บันทึก AuditLog — ห้าม throw ให้ล้ม flow หลัก */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        module: "core",
        userId: input.userId ?? null,
        action: input.action,
        targetId: input.targetId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        detail: (input.detail ?? undefined) as never,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log:", err);
  }
}
