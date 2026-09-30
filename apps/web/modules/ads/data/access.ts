import "server-only";
import { redirect } from "next/navigation";
import { getSession, hasPermission, requireOrg, type OrgSession } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { ADS_CODE } from "../constants";

/**
 * การตรวจสิทธิ์ของโมดูล (spec §9 "ทุก endpoint ตรวจ role ของผู้ใช้ Smartboss")
 * ต้องผ่าน 3 ชั้น: สังกัดบริษัท → บริษัทเปิดใช้โมดูล ads → มี permission ที่ขอ
 */

async function moduleEnabled(orgId: string): Promise<boolean> {
  const row = await prisma.orgModule.findFirst({
    where: { orgId, isEnabled: true, module: { code: ADS_CODE } },
    select: { orgId: true },
  });
  return !!row;
}

/** ใช้ใน Server Component — ไม่ผ่านเด้งกลับหน้าแรก */
export async function requireAdsPage(permission: string): Promise<OrgSession> {
  const session = await requireOrg();
  if (!hasPermission(session, permission) || !(await moduleEnabled(session.orgId))) redirect("/");
  return session;
}

export type ApiGuard = { ok: true; session: OrgSession } | { ok: false; response: Response };

/** ใช้ใน Route Handler — คืน JSON 401/403 แทนการ redirect */
export async function requireAdsApi(permission: string): Promise<ApiGuard> {
  const session = await getSession();
  if (!session) return { ok: false, response: Response.json({ error: "ต้องเข้าสู่ระบบ" }, { status: 401 }) };
  if (!session.orgId) return { ok: false, response: Response.json({ error: "ผู้ใช้ไม่ได้สังกัดบริษัท" }, { status: 403 }) };
  if (!hasPermission(session, permission)) {
    return { ok: false, response: Response.json({ error: "ไม่มีสิทธิ์" }, { status: 403 }) };
  }
  if (!(await moduleEnabled(session.orgId))) {
    return { ok: false, response: Response.json({ error: "บริษัทยังไม่ได้เปิดใช้โมดูล Google Ads Report" }, { status: 403 }) };
  }
  return { ok: true, session: session as OrgSession };
}

/** แปลง error เป็น JSON — ข้อความจาก data layer เป็นภาษาไทยที่แสดงผู้ใช้ได้ */
export function apiError(err: unknown, status = 400): Response {
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status });
}

/**
 * ห่อ Route Handler ของโมดูล: ตรวจสิทธิ์ → เรียก handler → แปลงผลเป็น JSON
 * (BigInt แปลงเป็น string) · error จาก data layer ตอบ 400 พร้อมข้อความ
 */
export function adsRoute<P = Record<string, string>>(
  permission: string,
  handler: (req: Request, session: OrgSession, params: P) => Promise<unknown>
) {
  return async (req: Request, ctx: { params: Promise<P> }): Promise<Response> => {
    const guard = await requireAdsApi(permission);
    if (!guard.ok) return guard.response;
    try {
      const result = await handler(req, guard.session, await ctx.params);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? String(v) : v)), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return apiError(err);
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
