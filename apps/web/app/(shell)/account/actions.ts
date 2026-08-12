"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth, hashPassword, verifyPassword, audit } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { loadSecuritySettings } from "@/lib/security-settings";

/**
 * บัญชีของตัวเอง — ทุกคนที่ล็อกอินได้ใช้หน้านี้ได้ ไม่ต้องมีสิทธิ์อะไรเพิ่ม
 *
 * ต่างจาก resetPasswordAction ใน /admin ตรงที่ **ต้องกรอกรหัสผ่านเดิม** ก่อน
 * — ที่ /admin เป็นแอดมินช่วยรีเซ็ตให้คนที่ลืมรหัส จึงไม่มีรหัสเดิมให้กรอกอยู่แล้ว
 * ส่วนที่นี่คือเจ้าของบัญชีเปลี่ยนเอง ถ้าไม่ถามรหัสเดิม ใครที่เดินมาเจอ
 * เครื่องที่เปิดค้างไว้ก็ยึดบัญชีได้ทันที
 */

/**
 * สร้างตอนใช้งานจริง ไม่ใช่ตอนโหลดไฟล์ — ความยาวขั้นต่ำตั้งได้รายบริษัท
 * (ดู apps/web/lib/security-settings.ts) จึงรู้ค่าได้ก็ต่อเมื่อรู้ว่าใครเป็นคนขอ
 */
function changePasswordSchema(minLength: number) {
  return z
    .object({
      currentPassword: z.string().min(1, "กรุณากรอกรหัสผ่านปัจจุบัน"),
      newPassword: z
        .string()
        .min(minLength, `รหัสผ่านใหม่ต้องยาวอย่างน้อย ${minLength} ตัวอักษร`),
      confirmPassword: z.string(),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
      message: "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน",
      path: ["confirmPassword"],
    })
    .refine((v) => v.newPassword !== v.currentPassword, {
      message: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม",
      path: ["newPassword"],
    });
}

export async function changeOwnPasswordAction(formData: FormData) {
  const session = await requireAuth();
  const security = await loadSecuritySettings(session.orgId ?? null);

  const parsed = changePasswordSchema(security.passwordMinLength).parse({
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) throw new Error("ไม่พบบัญชีผู้ใช้");

  if (!(await verifyPassword(user.passwordHash, parsed.currentPassword))) {
    // ไม่บอกว่าผิดตรงไหน และไม่นับรวมกับตัวนับล็อกบัญชีตอน login
    // — คนที่ผ่านมาถึงหน้านี้ได้คือคนที่ล็อกอินอยู่แล้ว การล็อกบัญชีตัวเอง
    // จากการพิมพ์รหัสเดิมผิดไม่กี่ครั้งสร้างปัญหามากกว่าที่ป้องกันได้
    throw new Error("รหัสผ่านปัจจุบันไม่ถูกต้อง");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.newPassword),
      failedLogins: 0,
      lockedUntil: null,
    },
  });

  // ตัด session ทุกเครื่องรวมถึงเครื่องนี้ — คนเปลี่ยนรหัสผ่านมักเปลี่ยนเพราะ
  // สงสัยว่ารหัสหลุด การปล่อยให้ session เก่ายังใช้ได้ทำให้การเปลี่ยนไม่มีความหมาย
  await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await audit({
    userId: user.id,
    action: "USER_PASSWORD_CHANGED",
    targetId: user.id,
  });

  redirect("/login?changed=1");
}

const profileSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อ").max(120),
});

export async function updateOwnProfileAction(formData: FormData) {
  const session = await requireAuth();
  const parsed = profileSchema.parse({
    name: String(formData.get("name") ?? "").trim(),
  });

  // แก้ได้แค่ชื่อที่แสดง — อีเมลคือชื่อผู้ใช้สำหรับ login และบทบาทคือเรื่องของ
  // แอดมิน ถ้าให้แก้เองได้ที่นี่จะกลายเป็นช่องยกระดับสิทธิ์ตัวเอง
  await prisma.user.update({
    where: { id: session.userId },
    data: { name: parsed.name },
  });

  await audit({
    userId: session.userId,
    action: "USER_UPDATED",
    targetId: session.userId,
  });
  revalidatePath("/account");
}
