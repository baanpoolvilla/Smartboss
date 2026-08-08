import { requireOrg } from "@smartboss/auth";

import { getIcsLinks } from "@/modules/report_task/lib/db/ics-link-repo";

/**
 * ปฏิทินที่ผู้ใช้คนนี้ต่อไว้
 *
 * ต้นทางรับ userId จาก query string — ที่นี่ใช้จาก session แทน
 * ใครก็เดา userId คนอื่นแล้วดูปฏิทินเขาไม่ได้
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireOrg();
  const links = await getIcsLinks(session.orgId, session.userId);
  return Response.json({ links });
}
