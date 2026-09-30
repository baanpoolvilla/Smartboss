import { redirect } from "next/navigation";
import { hasPermission, requireOrg } from "@smartboss/auth";

import { CHAT_PERMS } from "@/modules/chat/permissions";
import { CHAT_PAGE_PATH } from "@/modules/chat/constants";
import { REPORT_FEED_PATH } from "@/modules/report_task/constants";
import { REPORT_TASK_PERMS } from "@/modules/report_task/permissions";

export const dynamic = "force-dynamic";

/** หน้าแรกของโมดูล Chat & Report = แชท (ไม่มีสิทธิ์แชท → รายงาน) */
export default async function ChatReportHome() {
  const session = await requireOrg();
  if (hasPermission(session, CHAT_PERMS.access)) redirect(CHAT_PAGE_PATH);
  if (hasPermission(session, REPORT_TASK_PERMS.reportView)) redirect(REPORT_FEED_PATH);
  redirect("/");
}
