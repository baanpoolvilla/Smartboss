import "server-only";
import { redirect } from "next/navigation";
import { getSession, type Session } from "./session";
import { SUPER_ADMIN_ROLE, resolvePermission } from "./permissions";

/** ใช้ใน Server Component: ไม่มี session → เด้งไป /login */
export async function requireAuth(nextPath?: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    const suffix =
      nextPath && nextPath.startsWith("/")
        ? `?next=${encodeURIComponent(nextPath)}`
        : "";
    redirect(`/login${suffix}`);
  }
  return session;
}

export {
  SUPER_ADMIN_ROLE,
  SUPER_ADMIN_DENIED_PERMISSIONS,
  isDeniedToSuperAdmin,
} from "./permissions";

export function isSuperAdmin(session: Session): boolean {
  return session.roles.includes(SUPER_ADMIN_ROLE);
}

/**
 * SUPER_ADMIN ข้ามการเช็คสิทธิ์ได้ **ยกเว้นกลุ่มเงินเดือนรายบุคคล**
 * (เหตุผลและขอบเขตอยู่ใน ./permissions.ts)
 */
export function hasPermission(session: Session, permission: string): boolean {
  return resolvePermission({
    permissions: session.permissions,
    roles: session.roles,
    permission,
  });
}

export function hasRole(session: Session, role: string): boolean {
  return session.roles.includes(role);
}

/** ใช้ใน Server Component: ไม่มีสิทธิ์ → เด้งไปหน้าแรก */
export async function requirePermission(permission: string): Promise<Session> {
  const session = await requireAuth();
  if (!hasPermission(session, permission)) {
    redirect("/");
  }
  return session;
}

/** session ที่การันตีว่าผูกกับบริษัท (org) แล้ว — ใช้ในหน้าโมดูล */
export interface OrgSession extends Session {
  orgId: string;
}

/**
 * ใช้ในหน้าโมดูล: ต้อง login + ต้องสังกัดบริษัท (มี orgId)
 * ผู้ใช้ระดับแพลตฟอร์ม (orgId = null) ยังไม่มีบริษัท → เด้งไปหน้าแรก
 */
export async function requireOrg(): Promise<OrgSession> {
  const session = await requireAuth();
  if (!session.orgId) {
    redirect("/");
  }
  return session as OrgSession;
}
