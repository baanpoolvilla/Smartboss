import { hasPermission, requireOrg } from "@smartboss/auth";

import { listOrgUsersForPicker } from "@/modules/chat/data/channels";
import { CHAT_PERMS } from "@/modules/chat/permissions";

export const dynamic = "force-dynamic";

/** รายชื่อเพื่อนร่วมบริษัท — ตัวเลือกเริ่ม DM ใหม่ / สร้างกลุ่ม */
export async function GET() {
  const session = await requireOrg();
  if (!hasPermission(session, CHAT_PERMS.access)) {
    return Response.json({ error: "ไม่มีสิทธิ์ใช้งานโมดูลแชท" }, { status: 403 });
  }
  const users = await listOrgUsersForPicker(session.orgId, session.userId);
  return Response.json({ users });
}
