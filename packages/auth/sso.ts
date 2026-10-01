import { SignJWT } from "jose";

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
