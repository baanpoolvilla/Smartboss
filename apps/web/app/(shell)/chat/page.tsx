import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { CHAT_PERMS } from "@/modules/chat/permissions";
import { ChatApp } from "@/modules/chat/components/chat-app";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await requireOrg();
  if (!hasPermission(session, CHAT_PERMS.access)) redirect("/");

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: { id: true, name: true, avatarUrl: true },
  });

  return (
    // lg:h-full ให้พอดีกับพื้นที่ที่ Shell เตรียมไว้ (lg:h-dvh lg:overflow-hidden
    // ที่ระดับ layout) — ห้องแชท/ข้อความเลื่อนของตัวเองข้างใน ChatApp แทนที่จะ
    // ให้ทั้งหน้าเลื่อน (เหมือนปัญหาที่เจอกับบอร์ด Kanban ของ report_task มาก่อน)
    <div className="flex h-[calc(100dvh-68px)] flex-col p-3 sm:p-4 lg:h-full lg:p-6">
      <ChatApp currentUser={me} />
    </div>
  );
}
