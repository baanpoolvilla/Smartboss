"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  requireOrg,
  hasPermission,
  hashPassword,
  audit,
  isSuperAdmin,
  type OrgSession,
} from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { organizationExists } from "@/modules/admin/data/orgs";
import { PERFORMANCE_CATEGORIES } from "@/lib/performance";

/** ทุก action ต้องผ่านด่านนี้ก่อน — คืน session ที่มี orgId แน่นอน */
async function guard(permission: string) {
  const session = await requireOrg();
  if (!hasPermission(session, permission)) redirect("/admin");
  return session;
}

/**
 * บริษัทที่ action นี้จะไปเขียนข้อมูล
 *
 * ปกติ = บริษัทของผู้ใช้เอง ห้ามข้าม แม้จะยิง orgId แปลก ๆ เข้ามาใน form
 * SUPER_ADMIN เท่านั้นที่ระบุบริษัทอื่นได้ (ใช้ในหน้าเพิ่ม/ย้ายผู้ใช้ข้ามบริษัท)
 */
async function resolveTargetOrgId(
  session: OrgSession,
  formData: FormData
): Promise<string> {
  const requested = String(formData.get("orgId") ?? "").trim();
  if (!requested || requested === session.orgId) return session.orgId;

  if (!isSuperAdmin(session)) throw new Error("ไม่มีสิทธิ์จัดการข้อมูลข้ามบริษัท");
  if (!(await organizationExists(requested))) throw new Error("ไม่พบบริษัทนี้");
  return requested;
}

/**
 * ผู้ใช้ที่ action นี้แก้ได้
 *
 * SUPER_ADMIN แก้ได้ทุกบริษัท ส่วนแอดมินบริษัทแก้ได้เฉพาะคนในบริษัทตัวเอง
 * — เช็คทุกครั้งก่อนเขียน เพื่อไม่ให้ยิง userId ข้ามบริษัทเข้ามาแก้ได้
 */
async function assertManageableUser(session: OrgSession, userId: string) {
  const user = isSuperAdmin(session)
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst({ where: { id: userId, orgId: session.orgId } });
  if (!user) throw new Error("ไม่พบผู้ใช้ที่จัดการได้");
  return user;
}

/**
 * role ที่บริษัทนี้ "แก้ได้" ต้องเป็นของบริษัทตัวเองและไม่ใช่ role ระบบ
 * เช็คทุกครั้งก่อนเขียน เพื่อไม่ให้ยิง id ข้ามบริษัทเข้ามาแก้ได้
 */
async function assertEditableRole(orgId: string, roleId: string) {
  const role = await prisma.role.findFirst({ where: { id: roleId, orgId } });
  if (!role || role.isSystem) {
    throw new Error("ไม่มีสิทธิ์แก้ไขบทบาทนี้");
  }
  return role;
}

/** role ที่กำหนดให้ผู้ใช้ได้ = ของบริษัทตัวเอง (role ระบบต้องตั้งจากแพลตฟอร์มเท่านั้น) */
async function assertAssignableRole(orgId: string, roleId: string) {
  const role = await prisma.role.findFirst({ where: { id: roleId, orgId } });
  if (!role) throw new Error("ไม่พบบทบาทนี้ในบริษัท");
  return role;
}

/* ═══════════════════════ ผู้ใช้งาน ═══════════════════════ */

const createUserSchema = z.object({
  email: z.string().email("อีเมลไม่ถูกต้อง"),
  name: z.string().min(1, "กรุณากรอกชื่อ").max(120),
  password: z.string().min(8, "รหัสผ่านอย่างน้อย 8 ตัวอักษร"),
  roleId: z.string().min(1, "กรุณาเลือกบทบาท"),
});

export async function createUserAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.userManage);
  const parsed = createUserSchema.parse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    name: String(formData.get("name") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    roleId: String(formData.get("roleId") ?? ""),
  });

  // SUPER_ADMIN เลือกบริษัทปลายทางได้ คนอื่นถูกล็อกที่บริษัทตัวเอง
  const targetOrgId = await resolveTargetOrgId(session, formData);
  await assertAssignableRole(targetOrgId, parsed.roleId);

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) throw new Error("อีเมลนี้ถูกใช้งานแล้ว");

  const user = await prisma.user.create({
    data: {
      email: parsed.email,
      name: parsed.name,
      passwordHash: await hashPassword(parsed.password),
      orgId: targetOrgId,
      roles: { create: { roleId: parsed.roleId } },
    },
  });

  await audit({
    userId: session.userId,
    action: "USER_CREATED",
    targetId: user.id,
    detail: { email: user.email, orgId: targetOrgId },
  });
  revalidatePath("/admin/users");
}

export async function updateUserAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.userManage);
  const userId = String(formData.get("userId") ?? "");
  await assertManageableUser(session, userId);

  const name = String(formData.get("name") ?? "").trim();
  const lineUserId = String(formData.get("lineUserId") ?? "").trim();
  if (!name) throw new Error("กรุณากรอกชื่อ");

  await prisma.user.update({
    where: { id: userId },
    data: { name, lineUserId: lineUserId || null },
  });

  await audit({ userId: session.userId, action: "USER_UPDATED", targetId: userId });
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

/**
 * ย้ายผู้ใช้ไปอีกบริษัท — SUPER_ADMIN เท่านั้น
 *
 * บทบาทผูกกับบริษัท (Role.orgId) การย้ายจึงต้องล้างบทบาทเดิมทิ้งแล้วมอบใหม่
 * ในบริษัทปลายทาง ไม่งั้นผู้ใช้จะถือสิทธิ์ของบริษัทที่ไม่ได้สังกัดแล้ว
 *
 * ตัด session ที่ค้างอยู่ด้วย เพราะ token เดิมฝัง orgId เก่าไว้
 */
export async function moveUserOrgAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.userManage);
  if (!isSuperAdmin(session)) throw new Error("เฉพาะผู้ดูแลระบบสูงสุดเท่านั้น");

  const userId = String(formData.get("userId") ?? "");
  const roleId = String(formData.get("roleId") ?? "");
  if (!roleId) throw new Error("กรุณาเลือกบทบาทในบริษัทใหม่");

  const target = await assertManageableUser(session, userId);
  if (userId === session.userId) throw new Error("ย้ายบริษัทของบัญชีตัวเองไม่ได้");

  const targetOrgId = await resolveTargetOrgId(session, formData);
  if (targetOrgId === target.orgId) throw new Error("ผู้ใช้อยู่บริษัทนี้อยู่แล้ว");
  await assertAssignableRole(targetOrgId, roleId);

  await prisma.$transaction([
    // role ระบบ (SUPER_ADMIN) ไม่ผูกบริษัท จึงคงไว้ ตัดเฉพาะ role ของบริษัทเดิม
    prisma.userRole.deleteMany({ where: { userId, role: { isSystem: false } } }),
    prisma.user.update({ where: { id: userId }, data: { orgId: targetOrgId } }),
    prisma.userRole.create({ data: { userId, roleId } }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await audit({
    userId: session.userId,
    action: "USER_ORG_MOVED",
    targetId: userId,
    detail: { fromOrgId: target.orgId, toOrgId: targetOrgId, roleId },
  });
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

export async function setUserRolesAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.userManage);
  const userId = String(formData.get("userId") ?? "");
  // role ที่มอบได้ต้องเป็นของบริษัท "ที่ผู้ใช้คนนั้นสังกัด" ไม่ใช่บริษัทของคนกด
  const target = await assertManageableUser(session, userId);
  if (!target.orgId) throw new Error("ผู้ใช้ระดับแพลตฟอร์มไม่มีบทบาทรายบริษัท");

  const roleIds = formData.getAll("roleIds").map(String).filter(Boolean);
  for (const id of roleIds) await assertAssignableRole(target.orgId, id);

  // role ระบบที่ผู้ใช้ถืออยู่ต้องคงไว้ — หน้าจอนี้จัดการเฉพาะ role ของบริษัท
  const systemRoleIds = (
    await prisma.userRole.findMany({
      where: { userId, role: { isSystem: true } },
      select: { roleId: true },
    })
  ).map((r) => r.roleId);

  await prisma.$transaction([
    prisma.userRole.deleteMany({
      where: { userId, roleId: { notIn: systemRoleIds.length ? systemRoleIds : ["-"] } },
    }),
    prisma.userRole.createMany({
      data: roleIds.map((roleId) => ({ userId, roleId })),
      skipDuplicates: true,
    }),
  ]);

  await audit({
    userId: session.userId,
    action: "USER_ROLES_CHANGED",
    targetId: userId,
    detail: { roleIds },
  });
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

export async function setUserActiveAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.userManage);
  const userId = String(formData.get("userId") ?? "");
  const isActive = String(formData.get("isActive") ?? "") === "1";
  await assertManageableUser(session, userId);

  if (userId === session.userId && !isActive) {
    throw new Error("ปิดการใช้งานบัญชีตัวเองไม่ได้");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { isActive, ...(isActive ? { failedLogins: 0, lockedUntil: null } : {}) },
  });

  // ปิดใช้งาน = ตัด session ที่ค้างอยู่ทิ้งด้วย ไม่งั้น token เดิมยังใช้ได้จนหมดอายุ
  if (!isActive) {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  await audit({
    userId: session.userId,
    action: isActive ? "USER_ENABLED" : "USER_DISABLED",
    targetId: userId,
  });
  revalidatePath("/admin/users");
}

export async function resetPasswordAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.userManage);
  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) throw new Error("รหัสผ่านอย่างน้อย 8 ตัวอักษร");
  await assertManageableUser(session, userId);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(password),
      failedLogins: 0,
      lockedUntil: null,
    },
  });
  // เปลี่ยนรหัสผ่านแล้วต้องเตะ session เดิมออกทั้งหมด
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await audit({
    userId: session.userId,
    action: "USER_PASSWORD_RESET",
    targetId: userId,
  });
  revalidatePath(`/admin/users/${userId}`);
}

export async function deleteUserAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.userManage);
  const userId = String(formData.get("userId") ?? "");
  if (userId === session.userId) throw new Error("ลบบัญชีตัวเองไม่ได้");
  await assertManageableUser(session, userId);

  await prisma.user.delete({ where: { id: userId } });
  await audit({ userId: session.userId, action: "USER_DELETED", targetId: userId });
  redirect("/admin/users");
}

/* ═══════════════════════ บทบาท & สิทธิ์ ═══════════════════════ */

export async function createRoleAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.roleManage);
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!/^[A-Z0-9_]{2,40}$/.test(code)) {
    throw new Error("รหัสบทบาทใช้ได้เฉพาะ A-Z 0-9 _ ความยาว 2-40 ตัว");
  }
  if (!name) throw new Error("กรุณากรอกชื่อบทบาท");

  const dup = await prisma.role.findFirst({
    where: { code, OR: [{ orgId: session.orgId }, { orgId: null }] },
  });
  if (dup) throw new Error("มีบทบาทรหัสนี้อยู่แล้ว");

  const role = await prisma.role.create({
    data: { orgId: session.orgId, code, name, description: description || null },
  });
  await audit({
    userId: session.userId,
    action: "ROLE_CREATED",
    targetId: role.id,
    detail: { code },
  });
  redirect(`/admin/roles/${role.id}`);
}

export async function updateRoleAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.roleManage);
  const roleId = String(formData.get("roleId") ?? "");
  await assertEditableRole(session.orgId, roleId);

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) throw new Error("กรุณากรอกชื่อบทบาท");

  await prisma.role.update({
    where: { id: roleId },
    data: { name, description: description || null },
  });
  await audit({ userId: session.userId, action: "ROLE_UPDATED", targetId: roleId });
  revalidatePath(`/admin/roles/${roleId}`);
  revalidatePath("/admin/roles");
}

export async function setRolePermissionsAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.roleManage);
  const roleId = String(formData.get("roleId") ?? "");
  await assertEditableRole(session.orgId, roleId);

  const permissionIds = formData.getAll("permissionIds").map(String).filter(Boolean);

  // รับเฉพาะ id ที่มีจริงในแคตตาล็อก — กันค่าที่ยิงมั่วมาจากฟอร์ม
  const valid = await prisma.permission.findMany({
    where: { id: { in: permissionIds } },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({
      data: valid.map((p) => ({ roleId, permissionId: p.id })),
      skipDuplicates: true,
    }),
  ]);

  await audit({
    userId: session.userId,
    action: "ROLE_PERMISSIONS_CHANGED",
    targetId: roleId,
    detail: { count: valid.length },
  });
  revalidatePath(`/admin/roles/${roleId}`);
  revalidatePath("/admin/roles");
}

export async function deleteRoleAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.roleManage);
  const roleId = String(formData.get("roleId") ?? "");
  await assertEditableRole(session.orgId, roleId);

  const inUse = await prisma.userRole.count({ where: { roleId } });
  if (inUse > 0) {
    throw new Error(`ยังมีผู้ใช้ ${inUse} คนถือบทบาทนี้อยู่ — ย้ายผู้ใช้ออกก่อน`);
  }

  await prisma.role.delete({ where: { id: roleId } });
  await audit({ userId: session.userId, action: "ROLE_DELETED", targetId: roleId });
  redirect("/admin/roles");
}

/* ═══════════════════════ โมดูล & บริษัท ═══════════════════════ */

export async function toggleModuleAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.moduleManage);
  const moduleId = String(formData.get("moduleId") ?? "");
  const enable = String(formData.get("enable") ?? "") === "1";

  const mod = await prisma.module.findUnique({ where: { id: moduleId } });
  if (!mod) throw new Error("ไม่พบโมดูล");

  await prisma.orgModule.upsert({
    where: { orgId_moduleId: { orgId: session.orgId, moduleId } },
    update: { isEnabled: enable },
    create: { orgId: session.orgId, moduleId, isEnabled: enable },
  });

  await audit({
    userId: session.userId,
    action: enable ? "MODULE_ENABLED" : "MODULE_DISABLED",
    targetId: moduleId,
    detail: { code: mod.code },
  });
  revalidatePath("/admin/modules");
  revalidatePath("/", "layout");
}

export async function updateOrganizationAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.orgManage);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("กรุณากรอกชื่อบริษัท");

  await prisma.organization.update({
    where: { id: session.orgId },
    data: { name },
  });
  await audit({
    userId: session.userId,
    action: "ORG_UPDATED",
    targetId: session.orgId,
  });
  revalidatePath("/admin/organization");
}

/* ═══════════════════════ เกณฑ์คะแนนผลงาน ═══════════════════════ */

/**
 * บันทึกเกณฑ์คะแนนของบริษัท
 *
 * ทุกตัวเลขที่ตัดสินว่า "ผลงานดีหรือไม่ดี" ตั้งได้ที่นี่ ไม่มีค่าฝังในโค้ด
 * เพราะแต่ละบริษัทผ่อนผันไม่เท่ากัน — บางที่สาย 5 นาทีถือว่าสาย บางที่ 30 นาที
 *
 * ไม่ย้อนไปแก้เหตุการณ์ที่บันทึกไปแล้ว (points ถูกตรึงไว้ตอนบันทึก)
 * ตั้งใจให้เป็นอย่างนั้น — ไม่งั้นการปรับเกณฑ์วันนี้จะเปลี่ยนคะแนนย้อนหลัง
 * ของทุกคนโดยไม่มีใครรู้ตัว
 */
const perfNumbers = z.object({
  baseScore: z.number().int().min(0).max(1000),
  lateThresholdMinutes: z.number().int().min(0).max(480),
  absenceThresholdMinutes: z.number().int().min(0).max(1440),
  pmGraceDays: z.number().int().min(0).max(365),
  attendanceLookbackDays: z.number().int().min(1).max(365),
});

/** ช่องว่าง = ใช้ค่าเริ่มต้น ไม่ใช่ 0 — Number("") คืน 0 ซึ่งผิดความหมาย */
function optionalInt(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export async function savePerformanceSettingsAction(formData: FormData) {
  const session = await guard(ADMIN_PERMS.performanceSettingManage);
  const orgId = await resolveTargetOrgId(session, formData);

  const numbers = perfNumbers.parse({
    baseScore: Number(formData.get("baseScore")),
    lateThresholdMinutes: Number(formData.get("lateThresholdMinutes")),
    absenceThresholdMinutes: Number(formData.get("absenceThresholdMinutes")),
    pmGraceDays: Number(formData.get("pmGraceDays")),
    attendanceLookbackDays: Number(formData.get("attendanceLookbackDays")),
  });

  // เก็บเฉพาะคีย์ที่ระบบรู้จัก — ที่เหลือปล่อยว่างไว้ให้ใช้ค่าเริ่มต้น
  // (เหตุการณ์ชนิดใหม่ที่เพิ่มทีหลังจึงไม่ต้องให้ทุกบริษัทมาตั้งใหม่)
  const rulePoints: Record<string, number> = {};
  for (const key of Object.keys(PERFORMANCE_CATEGORIES)) {
    const n = optionalInt(formData.get(`rule_${key}`));
    if (n !== null && n >= -100 && n <= 100) rulePoints[key] = n;
  }

  // เกรดตั้งชื่อเองได้ (A-F, ผ่าน/ไม่ผ่าน, ดีมาก/ดี/พอใช้ ...) แถวที่เว้นว่างถูกตัดทิ้ง
  const gradeThresholds: Record<string, number> = {};
  for (const [index, name] of formData.getAll("gradeName").entries()) {
    const label = String(name).trim();
    const min = optionalInt(formData.getAll("gradeMin")[index] ?? null);
    if (!label || min === null || min < 0 || min > 1000) continue;
    if (label in gradeThresholds) throw new Error(`ชื่อเกรด "${label}" ซ้ำกัน`);
    gradeThresholds[label] = min;
  }
  if (Object.keys(gradeThresholds).length === 0) {
    throw new Error("ต้องมีเกณฑ์เกรดอย่างน้อยหนึ่งระดับ");
  }

  const data = {
    enabled: formData.get("enabled") === "1",
    ...numbers,
    rulePoints,
    gradeThresholds,
    updatedBy: session.userId,
  };

  await prisma.performanceSetting.upsert({
    where: { orgId },
    update: data,
    create: { orgId, ...data },
  });

  await audit({
    userId: session.userId,
    action: "PERFORMANCE_SETTINGS_UPDATED",
    targetId: orgId,
    detail: data,
  });
  revalidatePath("/admin/performance");
  revalidatePath("/admin/performance/settings");
}
