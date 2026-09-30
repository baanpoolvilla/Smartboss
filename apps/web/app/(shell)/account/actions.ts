"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth, hashPassword, audit } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { loadSecuritySettings } from "@/lib/security-settings";
import { deleteFile, putFile } from "@/lib/storage";
import { linePushConfigured, pushLineText } from "@/lib/line";
import { notifyUser } from "@/modules/maintenance/data/notify";
import { sniffMime } from "@/modules/report_task/lib/upload-sniff";

import { fileTooLargeMessage } from "@/lib/file-limits";
/**
 * บัญชีของตัวเอง — ทุกคนที่ล็อกอินได้ใช้หน้านี้ได้ ไม่ต้องมีสิทธิ์อะไรเพิ่ม
 *
 * เปลี่ยนรหัสผ่านของตัวเอง **ไม่ต้องกรอกรหัสเดิม** — เดิมบังคับกรอก แต่คนที่ลืมรหัส
 * ทั้งที่ยัง login อยู่เปลี่ยนเองไม่ได้ ต้องไปขอแอดมินทุกครั้ง ("ถ้าเราเข้าอยู่แล้ว
 * กดเปลี่ยนรหัสเลยได้ไหม") รหัสเก็บเป็น argon2 hash แสดงรหัสเดิมให้ดูไม่ได้ จึงให้
 * ตั้งใหม่แทน — เจ้าของระบบเลือกเองโดยรู้ว่าแลกกับ: ใครเจอเครื่องที่ login ค้างไว้
 * ก็เปลี่ยนรหัสได้ กันไว้ด้วย (1) audit ทุกครั้ง (2) เตะออกทุกเครื่อง (3) แจ้ง LINE
 * ของเจ้าของบัญชี (ถ้าผูกไว้) ให้รู้ตัวทันทีถ้าไม่ได้เปลี่ยนเอง
 */

/**
 * สร้างตอนใช้งานจริง ไม่ใช่ตอนโหลดไฟล์ — ความยาวขั้นต่ำตั้งได้รายบริษัท
 * (ดู apps/web/lib/security-settings.ts) จึงรู้ค่าได้ก็ต่อเมื่อรู้ว่าใครเป็นคนขอ
 */
function changePasswordSchema(minLength: number) {
  return z
    .object({
      newPassword: z
        .string()
        .min(minLength, `รหัสผ่านใหม่ต้องยาวอย่างน้อย ${minLength} ตัวอักษร`),
      confirmPassword: z.string(),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
      message: "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน",
      path: ["confirmPassword"],
    });
}

export async function changeOwnPasswordAction(formData: FormData) {
  const session = await requireAuth();
  const security = await loadSecuritySettings(session.orgId ?? null);

  const parsed = changePasswordSchema(security.passwordMinLength).parse({
    newPassword: String(formData.get("newPassword") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) throw new Error("ไม่พบบัญชีผู้ใช้");

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

  // ไม่ต้องกรอกรหัสเดิมแล้ว — แจ้งเจ้าของบัญชีให้รู้ตัวถ้าไม่ได้เปลี่ยนเอง ส่งไม่ได้ก็ไม่เป็นไร
  // การเปลี่ยนรหัสสำเร็จไปแล้ว
  const when = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date());
  // 1) ในแอปเอง: กระดิ่ง + เด้งแจ้งเตือนเข้ามือถือ/คอมทุกเครื่องที่เปิดแจ้งเตือนไว้ — ถึงทุกคน
  //    (Web Push ยังส่งถึงเครื่องได้แม้ถูกออกจากระบบไปแล้ว เพราะผูกกับเครื่อง ไม่ใช่ session)
  if (user.orgId) {
    await notifyUser(user.orgId, user.id, {
      title: "รหัสผ่านของคุณถูกเปลี่ยนแล้ว",
      body: `เปลี่ยนเมื่อ ${when} และออกจากระบบทุกเครื่องแล้ว — ถ้าคุณไม่ได้เปลี่ยนเอง ติดต่อแอดมินทันที`,
      type: "account_security",
    }).catch(() => undefined);
  }
  // 2) LINE: สำรองอีกทาง เผื่อเครื่องไม่ได้เปิดแจ้งเตือนของแอปไว้
  if (user.lineUserId && linePushConfigured()) {
    await pushLineText(
      user.lineUserId,
      `SmartBoss: รหัสผ่านของคุณถูกเปลี่ยนเมื่อ ${when} และออกจากระบบทุกเครื่องแล้ว\nถ้าคุณไม่ได้เปลี่ยนเอง ติดต่อแอดมินทันที`,
    ).catch(() => false);
  }

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
/**
 * คืน { error } แทนการ throw — throw จาก server action บน production ขึ้นหน้า "This page couldn't
 * load" ทั้งหน้า ผู้ใช้ไม่รู้ว่าผิดอะไร (เจอจริงตอนอัปรูปจากมือถือที่ใหญ่เกิน 5MB) · ฟอร์มย่อรูป
 * ในเครื่องก่อนส่งแล้ว (avatar-form.tsx) ขนาดจึงไม่ควรเกินอีก
 */
export async function updateOwnAvatarAction(formData: FormData): Promise<{ error?: string }> {
  const session = await requireAuth();

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "กรุณาเลือกไฟล์รูปภาพ" };
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return { error: fileTooLargeMessage(file, AVATAR_MAX_BYTES) };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffMime(bytes, file.type);
  const ext = sniffed ? AVATAR_ALLOWED[sniffed] : undefined;
  if (!ext) {
    return { error: "รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, GIF)" };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { avatarUrl: true },
  });
  if (!user) return { error: "ไม่พบบัญชีผู้ใช้" };

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
  return {};
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
