import { SignJWT, jwtVerify } from "jose";

/**
 * Single sign-on ไปเว็บภายนอกของบริษัท (Multi Post, Baanpool-Chat — ดู
 * apps/web/lib/external-apps.ts) — token อายุสั้นที่เว็บปลายทางตรวจด้วย secret
 * ร่วมของแอปนั้น (คนละตัวกับ JWT_SECRET ของ SmartBoss เอง เพื่อไม่ให้แอปภายนอก
 * ปลอม session ของ SmartBoss ได้) · aud = ชื่อแอป กัน token ของแอปหนึ่งไปใช้กับอีกแอป
 */
export interface SsoClaims {
  userId: string;
  name: string;
  email: string;
  /** CEO/ADMIN/SUPER_ADMIN ของ SmartBoss — ปลายทางให้สิทธิ์ดูของทุกคน */
  isAdmin: boolean;
}

export async function signSsoToken(secret: string, audience: string, claims: SsoClaims): Promise<string> {
  return new SignJWT({ name: claims.name, email: claims.email, isAdmin: claims.isAdmin })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer("smartboss")
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(crypto.randomUUID())
    .sign(new TextEncoder().encode(secret));
}

/**
 * ขากลับ — แอปภายนอกเรียกเข้ามาหา SmartBoss (เช่น Multi Post แจ้งว่า "งานของคุณโพสเสร็จแล้ว")
 * ใช้ secret ร่วมตัวเดียวกับขาไปของแอปนั้น แต่สลับ iss/aud: iss = ชื่อแอป, aud = "smartboss"
 * จึงเอา token ที่ SmartBoss ออกให้แอป (iss "smartboss") มาเล่นย้อนใส่ปลายทางนี้ไม่ได้
 * คืน null ถ้าลายเซ็น/ผู้ออก/อายุไม่ผ่าน — ผู้เรียกตอบ 401 เฉย ๆ ไม่ต้องบอกเหตุผล
 */
export async function verifyAppToken(
  secret: string,
  issuer: string,
  token: string
): Promise<{ userId: string; payload: Record<string, unknown> } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer,
      audience: "smartboss",
    });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return { userId: payload.sub, payload: payload as Record<string, unknown> };
  } catch {
    return null;
  }
}
