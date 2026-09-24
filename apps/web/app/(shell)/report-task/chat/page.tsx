import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { CHAT_PERMS } from "@/modules/chat/permissions";
import { ChatApp } from "@/modules/chat/components/chat-app";

export const dynamic = "force-dynamic";

/** แชทองค์กร — อยู่ใต้ "รายงานและงาน" (ตัวโค้ด/API ยังเป็นของ modules/chat) */
export default async function ReportTaskChatPage() {
  const session = await requireOrg();
  if (!hasPermission(session, CHAT_PERMS.access)) redirect("/report-task");

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: { id: true, name: true, avatarUrl: true },
  });

  return (
    <div className="flex h-[calc(100dvh-68px)] flex-col p-3 sm:p-4 lg:h-full lg:p-6">
      <ChatApp currentUser={me} />
    </div>
  );
}
