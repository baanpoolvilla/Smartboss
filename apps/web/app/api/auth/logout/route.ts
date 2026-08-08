import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  revokeRefreshToken,
  clearAuthCookies,
  verifyAccessToken,
  audit,
} from "@smartboss/auth";
import { clientIp, userAgent } from "../_lib";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = userAgent(req);
  const store = await cookies();

  const raw = store.get(COOKIE_REFRESH)?.value;
  if (raw) {
    await revokeRefreshToken(raw);
  }

  const access = store.get(COOKIE_ACCESS)?.value;
  const claims = access ? await verifyAccessToken(access) : null;

  clearAuthCookies(store);

  await audit({
    userId: claims?.sub ?? null,
    action: "LOGOUT",
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true });
}
