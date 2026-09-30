"use client";

import { useChatUnread } from "@/modules/chat/components/chat-nav-badge";
import { AppTileReviewBadge } from "./app-tile-review-badge";

/** ตัวเลขบน tile "Chat & Report" หน้าแรก = แชทยังไม่อ่าน + ความเคลื่อนไหวในรายงานที่เกี่ยวกับเรา */
export function ChatReportTileBadge() {
  const chatUnread = useChatUnread();
  return <AppTileReviewBadge part="reports" extra={chatUnread} />;
}
