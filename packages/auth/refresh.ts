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
  | { status: "reuse"; userId: string }
  | { status: "invalid" };

/**
 * Rotation: ตรวจ refresh token เดิม → revoke → ออกใบใหม่
 * - reuse detection: ถ้า token เคยถูก revoke แล้วถูกนำมาใช้ซ้ำ → revoke ทุก token ของ user
 */
export async function rotateRefreshToken(
  rawToken: string,
  deviceInfo?: string | null
): Promise<RotationResult> {
  const hash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
  });

  if (!existing) {
    return { status: "invalid" };
  }

  // ถูกใช้ซ้ำหลัง revoke = สัญญาณ token ถูกขโมย
  if (existing.revokedAt) {
    await revokeAllForUser(existing.userId);
    return { status: "reuse", userId: existing.userId };
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    return { status: "invalid" };
  }

  const raw = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    const next = generateRefreshToken();
    const expiresAt = new Date(
      Date.now() + ttlToSeconds(REFRESH_TOKEN_TTL) * 1000
    );
    await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: next.hash,
        deviceInfo: deviceInfo ?? existing.deviceInfo,
        expiresAt,
      },
    });
    return next.raw;
  });

  return { status: "ok", userId: existing.userId, raw };
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
