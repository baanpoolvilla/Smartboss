import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { ACCESS_TOKEN_TTL, getJwtSecret } from "./env";

const ISSUER = "smartboss";
const AUDIENCE = "smartboss-web";

export interface AccessTokenClaims {
  sub: string;
  orgId: string | null;
  roles: string[];
  permissions: string[];
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({
    orgId: claims.orgId,
    roles: claims.roles,
    permissions: claims.permissions,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getJwtSecret());
}

export async function verifyAccessToken(
  token: string
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    return normalizeClaims(payload);
  } catch {
    return null;
  }
}

function normalizeClaims(payload: JWTPayload): AccessTokenClaims | null {
  if (typeof payload.sub !== "string") return null;
  const orgId = typeof payload.orgId === "string" ? payload.orgId : null;
  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((r): r is string => typeof r === "string")
    : [];
  const permissions = Array.isArray(payload.permissions)
    ? payload.permissions.filter((p): p is string => typeof p === "string")
    : [];
  return { sub: payload.sub, orgId, roles, permissions };
}
