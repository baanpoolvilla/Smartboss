"use client";

import Link from "next/link";
import { CalendarDays, FilePlus2, MapPin, ArrowUpRight } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { getUser } from "@/modules/report_task/lib/directory";
import { priorityMeta } from "@/modules/report_task/lib/task-meta";
import { formatDate } from "@/modules/report_task/lib/format";
import { cn } from "@/modules/report_task/lib/utils";
import type { MaintenanceBoardItem } from "@/modules/report_task/lib/maintenance-board";

/** สีประจำประเภท — ใบงานซ่อม = เขียวอมฟ้า (สีโมดูลแจ้งซ่อม) */
export const MAINTENANCE_KIND = {
  wo: { icon: "🔧", label: "ใบงานซ่อม", color: "#0d9488", bg: "#e6f6f4" },
} as const;

/**
 * การ์ดใบงานซ่อมบนบอร์ดงาน — หน้าตาเดียวกับการ์ดงาน มีป้ายประเภท + แถบสีซ้าย บอกว่าไม่ใช่งานปกติ
 * แสดงอย่างเดียว (ลากไม่ได้ ไม่มีเช็คลิสต์/คอมเมนต์) กดแล้วไปหน้านั้นในแจ้งซ่อม ?from=tasks = ปุ่มย้อนกลับพากลับบอร์ด
 */
export function MaintenanceCard({ item }: { item: MaintenanceBoardItem }) {
  const k = MAINTENANCE_KIND[item.kind];
  const person = item.responsibleId ? getUser(item.responsibleId) : undefined;
  const done = item.column === "done";
  return (
    <Link
      href={`${item.href}?from=tasks`}
      prefetch={false}
      className="group block rounded-xl border border-[var(--line)] bg-white p-3 shadow-sm transition-colors hover:border-[#b8c2d0]"
      style={{ borderLeft: `4px solid ${k.color}` }}
      aria-label={`${k.label} ${item.code} ${item.title} — เปิดในแจ้งซ่อม`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
          style={{ background: k.bg, color: k.color }}
        >
          {k.icon} {k.label} · {item.code}
        </span>
        {item.priority !== "medium" && (
          <span className="shrink-0 text-[10.5px] font-medium" style={{ color: priorityMeta[item.priority].accentColor }}>
            ● {priorityMeta[item.priority].label}
          </span>
        )}
      </div>
      <p className={cn("mt-1.5 text-sm font-semibold leading-snug text-[var(--ink)]", done && "text-[var(--ink-soft)]")}>
        {item.title}
      </p>
      {item.place && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-[var(--ink-soft)]">
          <MapPin className="h-3 w-3" />
          {item.place}
        </div>
      )}
      {/* วันที่สร้าง + ครบกำหนด */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--ink-soft)]">
        <span className="inline-flex items-center gap-1">
          <FilePlus2 className="h-3 w-3" />
          สร้าง {formatDate(item.createdAt)}
        </span>
        <span className={cn("inline-flex items-center gap-1", item.overdue && "font-semibold text-[var(--chart-red)]")}>
          <CalendarDays className="h-3 w-3" />
          {item.dueDate ? (
            <>
              {item.overdue ? "เลยกำหนด " : "ครบกำหนด "}
              {formatDate(item.dueDate)}
            </>
          ) : (
            "ไม่ได้ตั้งวันครบกำหนด"
          )}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--line)] pt-2">
        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ink-soft)] group-hover:text-[var(--ink)]">
          {item.statusLabel} · เปิดในแจ้งซ่อม <ArrowUpRight className="h-3 w-3" />
        </span>
        {person && (
          <Avatar className="h-6 w-6 shrink-0" title={person.name}>
            <AvatarImage src={person.avatarUrl ?? undefined} alt={person.name} />
            <AvatarFallback className="text-[9px] bg-[var(--bg-soft)]">{person.avatar}</AvatarFallback>
          </Avatar>
        )}
      </div>
    </Link>
  );
}
