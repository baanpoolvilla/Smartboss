import "server-only";
import { cookies } from "next/headers";
import { COOKIE_ACCESS } from "./env";
import { verifyAccessToken, type AccessTokenClaims } from "./jwt";

export interface Session {
  userId: string;
  orgId: string | null;
  roles: string[];
  permissions: string[];
}

/** อ่าน session จาก access-token cookie (สำหรับ Server Component / Route Handler) */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(COOKIE_ACCESS)?.value;
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  return toSession(claims);
}

function toSession(claims: AccessTokenClaims): Session {
  return {
    userId: claims.sub,
    orgId: claims.orgId,
    roles: claims.roles,
    permissions: claims.permissions,
  };
}
