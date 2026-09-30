import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@smartboss/database";
import { REFRESH_TOKEN_TTL, ttlToSeconds } from "./env";

/** สร้าง raw refresh token (64 bytes) — คืน raw ให้ set cookie, และ hash เก็บ DB */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(64).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function issueRefreshToken(
  userId: string,
  deviceInfo?: string | null
): Promise<string> {
  const { raw, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + ttlToSeconds(REFRESH_TOKEN_TTL) * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hash, deviceInfo: deviceInfo ?? null, expiresAt },
  });
  return raw;
}

export type RotationResult =
  | { status: "ok"; userId: string; raw: string }
  /** ใบที่หมุนไปนานแล้วถูกเอามาใช้อีก — ตัดเฉพาะเครื่องนี้ (บันทึก audit ไว้) */
  | { status: "reuse"; userId: string }
  | { status: "invalid" };

/**
 * ช่วงที่ยังกู้ใบที่เพิ่งหมุนไปได้ — การหมุนสำเร็จฝั่งเซิร์ฟเวอร์แต่ "คำตอบไปไม่ถึงเครื่อง" เกิดบ่อย:
 * แอปถูกพัก/โหลดหน้าใหม่ (ตัว auto-reload) กลางคำขอ, เน็ตมือถือสะดุด, หลายแท็บแข่งกัน, เซิร์ฟเวอร์
 * รีสตาร์ทตอน deploy — เครื่องยังถือใบเก่าอยู่โดยไม่ผิดอะไร
 */
const ROTATION_RECOVERY_MS = 5 * 60_000;

async function issueSuccessor(existing: { id: string; userId: string; deviceInfo: string | null }, deviceInfo?: string | null, markRotated = true) {
  return prisma.$transaction(async (tx) => {
    // เวลาเดียวกันทั้งคู่ — rotateRefreshToken เช็ค "ใบลูก createdAt >= rotatedAt" นาฬิกาต่างกันนิดเดียวก็พลาด
    const now = new Date();
    if (markRotated) {
      await tx.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: now, rotatedAt: now } });
    }
    const next = generateRefreshToken();
    await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: next.hash,
        deviceInfo: deviceInfo ?? existing.deviceInfo,
        expiresAt: new Date(now.getTime() + ttlToSeconds(REFRESH_TOKEN_TTL) * 1000),
        createdAt: now,
      },
    });
    return next.raw;
  });
}

/**
 * Rotation: ตรวจ refresh token เดิม → revoke → ออกใบใหม่
 *
 * เดิมใบที่ revoke แล้วถูกใช้ซ้ำเกิน 30 วิ = "ถูกขโมย" → revoke ทุกใบของคนนั้น ⇒ เตะออกทุกเครื่อง
 * แต่ของจริงแทบทั้งหมดคือคำตอบหาย (ดู ROTATION_RECOVERY_MS) และแย่กว่านั้น: หลังโดนเตะ เครื่องอื่นที่
 * ยังถือใบที่ "ถูกเตะ" อยู่ พอตื่นมาต่ออายุก็ถูกนับว่าขโมยอีก → เตะเครื่องที่เพิ่งล็อกอินใหม่ วนไม่จบ
 * (audit TOKEN_REUSE_DETECTED 5 ครั้งใน 23 นาทีของคนเดียว) ตอนนี้:
 *  - หมุนไปไม่เกิน 5 นาที และสายนั้นยังไม่ถูกตัด → ออกใบใหม่ให้ (กู้คำตอบที่หาย)
 *  - นอกนั้น (หมุนไปนานแล้ว / ออกจากระบบ / เปลี่ยนรหัส / แอดมินตัด) → ใช้ไม่ได้ เฉพาะเครื่องนี้
 */
export async function rotateRefreshToken(
  rawToken: string,
  deviceInfo?: string | null
): Promise<RotationResult> {
  const hash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
  });

  if (!existing || existing.expiresAt.getTime() <= Date.now()) {
    return { status: "invalid" };
  }

  if (!existing.revokedAt) {
    return { status: "ok", userId: existing.userId, raw: await issueSuccessor(existing, deviceInfo) };
  }

  if (!existing.rotatedAt) return { status: "invalid" };

  if (Date.now() - existing.rotatedAt.getTime() < ROTATION_RECOVERY_MS) {
    // สายนี้ยังมีใบที่ใช้ได้อยู่ไหม — ถ้าเปลี่ยนรหัส/แอดมินตัด/ออกจากระบบหลังหมุน ใบลูกถูกตัดไปด้วย ห้ามกู้
    const alive = await prisma.refreshToken.count({
      where: { userId: existing.userId, revokedAt: null, createdAt: { gte: existing.rotatedAt } },
    });
    if (alive > 0) {
      return { status: "ok", userId: existing.userId, raw: await issueSuccessor(existing, deviceInfo, false) };
    }
    return { status: "invalid" };
  }

  return { status: "reuse", userId: existing.userId };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const hash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
