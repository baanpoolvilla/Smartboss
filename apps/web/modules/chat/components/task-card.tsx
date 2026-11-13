"use client";

import Link from "next/link";
import { CalendarClock, ChevronRight, ClipboardList, FolderKanban, Wrench } from "lucide-react";
import { cn } from "@smartboss/ui/cn";

import { formatShortDate } from "@/modules/report_task/lib/format";
import type { ChatTaskCard } from "../types";
import { ceoText } from "@/lib/ceo-title-shared";
import { useCeoTitle } from "@/lib/ceo-title-client";

/**
 * การ์ด "งานใหม่" ในแชทส่วนตัว (ChatMessage kind "task") — ผู้ใช้ 30/10/2569: มอบหมายงานจากที่ไหนก็ได้
 * ให้เด้งเป็นการ์ดบอกในแชทด้วย · กดการ์ดแล้วไปหน้ารายละเอียดงาน (data/task-cards.ts เป็นคนโพสต์)
 */
/** สีป้าย — PM/อัตโนมัติ ตรงกับ WO_TYPE_TAG_BG ของบอร์ดงาน */
const TAG_BG: Record<string, string> = {
  PM: "#7c3aed",
  อัตโนมัติ: "#475569",
  "CEO รวบ": "#1b2537",
  Task: "#2563eb",
  โปรเจกต์: "#0e7490",
  งานย่อย: "#64748b",
};

export function TaskCard({ card, body, mine }: { card: ChatTaskCard; body: string | null; mine: boolean }) {
  const ceo = useCeoTitle();
  const isWorkOrder = card.target === "work_order";
  const assigned = body?.startsWith("มอบหมาย");
  return (
    <Link
      href={card.link}
      className={cn(
        "block w-64 max-w-full overflow-hidden rounded-2xl border border-(--line) bg-(--bg) text-left shadow-[0_1px_1px_rgba(0,0,0,0.06)] hover:bg-(--bg-soft)",
        mine ? "rounded-tr-md" : "rounded-tl-md"
      )}
    >
      <div className="flex items-center gap-2 border-b border-(--line) bg-(--bg-soft) px-3 py-2 text-xs font-semibold text-(--ink-soft)">
        {isWorkOrder ? <Wrench className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span className="shrink-0">{isWorkOrder ? (assigned ? "ใบแจ้งซ่อมใหม่" : "ใบแจ้งซ่อม") : assigned ? "งานใหม่" : "งาน"}</span>
        {/* ป้ายประเภท (ผู้ใช้ 2/11/2569) — สีเดียวกับป้ายบนบอร์ดงาน · การ์ดเก่าไม่มีป้าย */}
        {card.tags?.map((t) => (
          <span key={t} className="shrink-0 rounded px-1 text-[10px] font-bold leading-4 text-white" style={{ backgroundColor: TAG_BG[t] ?? "#475569" }}>
            {ceoText(t, ceo)}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-1 px-3 py-2.5">
        {/* งานในโปรเจกต์ — บอกว่าอยู่โปรเจกต์ไหน ช่วงไหน (ผู้ใช้ 13/11/2569) */}
        {card.project && (
          <div className="flex min-w-0 items-center gap-1 text-xs font-semibold text-[#0e7490]">
            <FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {card.project.name}
              {card.project.section ? <span className="font-normal text-(--ink-soft)"> · {card.project.section}</span> : null}
            </span>
          </div>
        )}
        <div className="line-clamp-2 text-[15px] font-semibold text-(--ink)">{card.title}</div>
        {(card.dueDate || card.code) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-(--ink-soft)">
            {/* เลขที่อยู่บรรทัดนี้ ไม่ใช่หัวการ์ด — หัวการ์ดมีป้ายประเภทแล้วเลขถูกตัดเป็น "WO-..." */}
            {card.code && <span className="font-medium">{card.code}</span>}
            {card.dueDate && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                {isWorkOrder ? "ครบกำหนด" : "ส่งภายใน"} {formatShortDate(card.dueDate)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-(--line) px-3 py-2 text-sm font-semibold text-(--chat-accent,#06c755)">
        {isWorkOrder ? "เปิดดูรายละเอียดใบงาน" : "เปิดดูรายละเอียดงาน"}
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </div>
    </Link>
  );
}
