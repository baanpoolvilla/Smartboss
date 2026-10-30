"use client";

import Link from "next/link";
import { CalendarClock, ChevronRight, ClipboardList } from "lucide-react";
import { cn } from "@smartboss/ui/cn";

import { formatShortDate } from "@/modules/report_task/lib/format";
import type { ChatTaskCard } from "../types";

/**
 * การ์ด "งานใหม่" ในแชทส่วนตัว (ChatMessage kind "task") — ผู้ใช้ 30/10/2569: มอบหมายงานจากที่ไหนก็ได้
 * ให้เด้งเป็นการ์ดบอกในแชทด้วย · กดการ์ดแล้วไปหน้ารายละเอียดงาน (data/task-cards.ts เป็นคนโพสต์)
 */
export function TaskCard({ card, body, mine }: { card: ChatTaskCard; body: string | null; mine: boolean }) {
  return (
    <Link
      href={card.link}
      className={cn(
        "block w-64 max-w-full overflow-hidden rounded-2xl border border-(--line) bg-(--bg) text-left shadow-[0_1px_1px_rgba(0,0,0,0.06)] hover:bg-(--bg-soft)",
        mine ? "rounded-tr-md" : "rounded-tl-md"
      )}
    >
      <div className="flex items-center gap-2 border-b border-(--line) bg-(--bg-soft) px-3 py-2 text-xs font-semibold text-(--ink-soft)">
        <ClipboardList className="h-4 w-4" aria-hidden="true" />
        {body?.startsWith("มอบหมาย") ? "งานใหม่" : "งาน"}
      </div>
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <div className="line-clamp-2 text-[15px] font-semibold text-(--ink)">{card.title}</div>
        {card.dueDate && (
          <div className="flex items-center gap-1 text-xs text-(--ink-soft)">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            ส่งภายใน {formatShortDate(card.dueDate)}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-(--line) px-3 py-2 text-sm font-semibold text-(--chat-accent,#06c755)">
        เปิดดูรายละเอียดงาน
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </div>
    </Link>
  );
}
