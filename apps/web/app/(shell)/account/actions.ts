"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth, hashPassword, verifyPassword, audit } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { loadSecuritySettings } from "@/lib/security-settings";
import { deleteFile, putFile } from "@/lib/storage";
import { sniffMime } from "@/modules/report_task/lib/upload-sniff";

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

const AVATAR_ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * รูปโปรไฟล์ของตัวเอง — คนอื่นตั้งให้ไม่ได้ ต้องเป็นเจ้าของบัญชีเท่านั้น
 * (เหตุผลเดียวกับ changeOwnPasswordAction: หน้านี้ไม่มีสิทธิ์แยกให้เช็ค
 * ใครก็ตามที่ล็อกอินได้ถือว่าจัดการของตัวเองได้เต็มที่)
 *
 * สนิฟฟ์เนื้อไฟล์จริงแทนเชื่อ file.type ตามแพตเทิร์นเดียวกับที่อัปโหลดอื่น
 * ในระบบใช้ (ดู apps/web/app/api/chat/uploads/route.ts) — ไม่งั้นใครอัปโหลด
 * ไฟล์ .html ที่ตั้งชื่อ .jpg จะได้ URL ที่เสิร์ฟ HTML กลับมาจริง ๆ
 */
export async function updateOwnAvatarAction(formData: FormData) {
  const session = await requireAuth();

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("กรุณาเลือกไฟล์รูปภาพ");
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error(`ไฟล์ใหญ่เกินไป (จำกัด ${AVATAR_MAX_BYTES / 1024 / 1024}MB)`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffMime(bytes, file.type);
  const ext = sniffed ? AVATAR_ALLOWED[sniffed] : undefined;
  if (!ext) {
    throw new Error("รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, GIF)");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { avatarUrl: true },
  });
  if (!user) throw new Error("ไม่พบบัญชีผู้ใช้");

  // แยก prefix ตามบริษัท เหมือนไฟล์แนบอื่น ๆ ในระบบ — ผู้ใช้แพลตฟอร์ม (orgId
  // เป็น null เช่น SUPER_ADMIN) ไม่มีบริษัทให้แยก จึงรวมไว้ใต้ "platform"
  const prefix = `${session.orgId ?? "platform"}/avatars`;
  const url = await putFile(
    prefix,
    new File([bytes], `${session.userId}.${ext}`, { type: sniffed! }),
    { ext }
  );

  await prisma.user.update({
    where: { id: session.userId },
    data: { avatarUrl: url },
  });

  // ลบไฟล์เก่าหลังอัปเดต DB สำเร็จแล้วเท่านั้น — ถ้าลบก่อนแล้วขั้นถัดไปพัง
  // จะเหลือ URL เก่าชี้ไปไฟล์ที่ไม่มีอยู่แล้ว (รูปหาย) แทนที่จะแค่มีไฟล์ค้าง
  if (user.avatarUrl) await deleteFile(user.avatarUrl);

  await audit({
    userId: session.userId,
    action: "USER_UPDATED",
    targetId: session.userId,
  });
  revalidatePath("/account");
}

/** เอารูปโปรไฟล์ออก — กลับไปแสดงตัวอักษรย่อชื่อแทน */
export async function removeOwnAvatarAction() {
  const session = await requireAuth();

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { avatarUrl: true },
  });
  if (!user?.avatarUrl) return;

  await prisma.user.update({
    where: { id: session.userId },
    data: { avatarUrl: null },
  });
  await deleteFile(user.avatarUrl);

  await audit({
    userId: session.userId,
    action: "USER_UPDATED",
    targetId: session.userId,
  });
  revalidatePath("/account");
}
