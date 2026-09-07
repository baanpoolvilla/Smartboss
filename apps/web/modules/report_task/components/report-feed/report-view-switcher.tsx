"use client";

import { useState } from "react";
import { Rows3, Clock, AtSign, Globe, ChevronDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { ALL_TOPICS_ID, PENDING_ID, MENTIONS_ID } from "@/modules/report_task/components/report-feed/topic-sidebar";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * ตัวสลับ "มุมมองรวมทุกห้อง" — โพสต์ทั้งหมด / รอฉันส่ง / กล่าวถึงฉัน
 * เดิมเป็นบล็อก "ภาพรวม" บนสุดของแถบซ้าย ทำให้แถบซ้ายดูรก ("อยากเอาออก")
 * ย้ายมาเป็น dropdown เดียวมุมขวาบนของเนื้อหา แถบซ้ายเหลือแค่รายการหัวข้อ
 *
 * เป็นมุมมอง "ข้ามทุกห้อง" ไม่ใช่ของห้องที่เปิดอยู่ — จึงมี label
 * "ทุกห้องรวมกัน" กำกับในเมนู กันเข้าใจผิดว่าเป็นฟิลเตอร์ของห้องเดียว
 */
export function ReportViewSwitcher({
  activeId,
  onSelect,
  pendingCount,
  mentionCount,
}: {
  activeId: string;
  onSelect: (id: string) => void;
  pendingCount: number;
  mentionCount: number;
}) {
  const [open, setOpen] = useState(false);

  const items = [
    { id: ALL_TOPICS_ID, label: "โพสต์ทั้งหมด", Icon: Rows3, iconBg: "var(--green-soft,#dcfce7)", iconColor: "var(--brand-green-dark)", count: 0 },
    { id: PENDING_ID, label: "รอฉันส่ง", Icon: Clock, iconBg: "#fef3c7", iconColor: "var(--chart-amber,#d97706)", count: pendingCount },
    { id: MENTIONS_ID, label: "กล่าวถึงฉัน", Icon: AtSign, iconBg: "#dbeafe", iconColor: "var(--chart-blue,#2563eb)", count: mentionCount },
  ];

  const current = items.find((it) => it.id === activeId);

  function pick(id: string) {
    onSelect(id);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-semibold shadow-sm transition-colors",
          current
            ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]"
            : "border-[var(--line)] bg-[var(--bg)] text-[var(--ink)] hover:bg-[var(--bg-soft)]"
        )}
        aria-label="มุมมองรวมทุกห้อง"
      >
        <Globe className="h-3.5 w-3.5 text-[var(--brand-green-dark)]" />
        <span className="hidden sm:inline">มุมมอง{current ? ":" : ""}</span>
        {current && <span>{current.label}</span>}
        <ChevronDown className="h-3.5 w-3.5 text-[var(--ink-soft)]" />
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={6} className="w-[240px] gap-0 p-0">
        <div className="flex items-center gap-1.5 border-b border-[var(--line)] px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wide text-[var(--ink-soft)]">
          <Globe className="h-3.5 w-3.5 text-[var(--brand-green-dark)]" />
          มุมมอง · ทุกห้องรวมกัน
        </div>
        {items.map((it) => {
          const on = it.id === activeId;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => pick(it.id)}
              className={cn(
                "flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors",
                on ? "bg-[var(--accent)]" : "hover:bg-[var(--bg-soft)]"
              )}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: it.iconBg }}
              >
                <it.Icon className="h-3.5 w-3.5" style={{ color: it.iconColor }} />
              </span>
              <span className={cn("flex-1 truncate", on && "font-bold text-[var(--brand-green-dark)]")}>{it.label}</span>
              {it.count > 0 && (
                <span className="shrink-0 min-w-[18px] rounded-full bg-[var(--danger)] px-1.5 text-center text-[10px] font-semibold text-white">
                  {it.count}
                </span>
              )}
              {on && <Check className="h-4 w-4 shrink-0 text-[var(--brand-green)]" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
