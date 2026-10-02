import "server-only";
import { getSession, loadAuthUser, signSsoToken } from "@smartboss/auth";
import type { ExternalApp } from "@/lib/external-apps";

/** ตรงกับ OWNER_ROLE_CODES ของ report-task — คนที่ "เห็นทั้งบริษัท" */
const ADMIN_ROLE_CODES = new Set(["SUPER_ADMIN", "ADMIN", "CEO"]);

export type SsoTarget =
  /** issuedAt = เวลาที่สร้างลิงก์ (ms) — token ในลิงก์อายุ 60 วินาที */
  | { kind: "url"; url: string; issuedAt: number }
  /** ยังไม่ล็อกอิน SmartBoss */
  | { kind: "login" };

/**
 * ลิงก์เข้าแอปภายนอกแบบล็อกอินให้เลย — เซ็น token อายุ 60 วินาทีของคนที่ล็อกอินอยู่
 * (ดู lib/external-apps.ts) ยังไม่ตั้ง secret ของแอป = ลิงก์หน้าแอปธรรมดา
 *
 * `embed` = จะเปิดในกรอบข้างใน SmartBoss — แอปที่รองรับ (sso.embedParam) ต้องรู้ เพราะ cookie
 * ที่ใช้ในกรอบต้องเป็นอีกแบบ (SameSite=None; Partitioned) ไม่งั้นล็อกอินในกรอบแล้วหลุด
 */
export async function ssoTarget(app: ExternalApp, opts: { embed: boolean }): Promise<SsoTarget> {
  const issuedAt = Date.now();
  if (!app.sso) return { kind: "url", url: app.url, issuedAt };
  const session = await getSession();
  const user = session ? await loadAuthUser(session.userId) : null;
  if (!user) return { kind: "login" };

  const secret = process.env[app.sso.secretEnv];
  if (!secret) return { kind: "url", url: app.url, issuedAt };

  const token = await signSsoToken(secret, app.sso.key, {
    userId: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.roles.some((r) => ADMIN_ROLE_CODES.has(r)),
  });
  let url = app.sso.entry.replace("{token}", encodeURIComponent(token));
  if (opts.embed && app.sso.embedParam) {
    // ต่อท้าย query (ก่อน # ถ้ามี — token บางแอปอยู่หลัง #)
    const [base, hash] = url.split("#", 2) as [string, string | undefined];
    url = `${base}${base.includes("?") ? "&" : "?"}${app.sso.embedParam}${hash !== undefined ? `#${hash}` : ""}`;
  }
  return { kind: "url", url, issuedAt };
}
