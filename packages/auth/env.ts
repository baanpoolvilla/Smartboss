/** Central place to read + validate auth-related environment variables. */

export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET ต้องถูกกำหนดใน ENV และมีความยาวอย่างน้อย 32 ตัวอักษร"
    );
  }
  return new TextEncoder().encode(secret);
}

export const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL ?? "15m";
export const REFRESH_TOKEN_TTL = process.env.REFRESH_TOKEN_TTL ?? "7d";
export const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";

export const COOKIE_ACCESS = "sb_access";
export const COOKIE_REFRESH = "sb_refresh";
export const REFRESH_COOKIE_PATH = "/api/auth/refresh";

/** แปลง TTL string ("15m", "7d") เป็นวินาที */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(ttl.trim());
  if (!match) throw new Error(`รูปแบบ TTL ไม่ถูกต้อง: ${ttl}`);
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * multipliers[unit as keyof typeof multipliers]!;
}
