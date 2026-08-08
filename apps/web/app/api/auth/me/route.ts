import { NextResponse } from "next/server";
import { getSession, loadAuthUser } from "@smartboss/auth";
import { jsonError } from "../_lib";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return jsonError("ไม่ได้เข้าสู่ระบบ", 401);
  }

  const user = await loadAuthUser(session.userId);
  if (!user) {
    return jsonError("ไม่พบบัญชีผู้ใช้", 401);
  }

  return NextResponse.json({
    user: {
      id: user.id,
      orgId: user.orgId,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      roles: user.roles,
      permissions: user.permissions,
    },
  });
}
