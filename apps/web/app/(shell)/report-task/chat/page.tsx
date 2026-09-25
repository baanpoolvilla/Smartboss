import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { CHAT_PERMS } from "@/modules/chat/permissions";
import { ChatApp } from "@/modules/chat/components/chat-app";

export const dynamic = "force-dynamic";

/** แชทองค์กรแบบ LINE — อยู่ใต้ "รายงานและงาน" (ตัวโค้ด/API เป็นของ modules/chat) */
export default async function ReportTaskChatPage() {
  const session = await requireOrg();
  if (!hasPermission(session, CHAT_PERMS.access)) redirect("/report-task");

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: { id: true, name: true, avatarUrl: true },
  });

  return (
    // เต็มความสูงที่ AppScaffold (fill) จองไว้ — รายการห้อง/ข้อความเลื่อนในกรอบของตัวเอง
    // ไม่ใช่ทั้งหน้า (ดู selfScrolling ใน report-task-scaffold.tsx)
    <div className="flex h-full min-h-0 flex-col">
      <Suspense>
        <ChatApp currentUser={me} />
      </Suspense>
    </div>
  );
}
