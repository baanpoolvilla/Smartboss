"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, ChevronDown, ChevronUp } from "lucide-react";
import { maintenanceCategoryFor, maintenanceHrefFor } from "./derive";
import type { NotifCategory } from "./types";
import { useMaintenanceNotifStore, type MaintenanceNotif } from "./use-maintenance-notifications";

/**
 * "🔔 รอคุณ" — บอกว่าเลขแดงที่เมนู (NotifCountBadge) คือเรื่องอะไร (ผู้ใช้ขอ 18/10/2569
 * "เปิดมาแล้วไม่รู้ว่างานอะไรที่รอเราอยู่") ใช้ข้อมูลชุดเดียวกับเลขแดง (แจ้งเตือนที่ยังไม่อ่าน
 * ใน core.notifications ตาม category) ⇒ จำนวนตรงกันเสมอ · เปิดรายการนั้นแล้ว หน้ารายละเอียด
 * มาร์คอ่านเอง (MarkReadOnView) แถบ/ป้าย/เลขแดงหายตาม
 */

/** "who · 💬 ความคิดเห็นใหม่: ชื่อใบงาน" → { who, kind: "💬 ความคิดเห็นใหม่", subject: "ชื่อใบงาน" } */
export function splitNotifTitle(title: string): { who: string | null; kind: string; subject: string | null } {
  const dot = title.indexOf(" · ");
  const who = dot > 0 && dot < 40 ? title.slice(0, dot) : null;
  const rest = who ? title.slice(dot + 3) : title;
  const colon = rest.indexOf(": ");
  return colon > 0 ? { who, kind: rest.slice(0, colon), subject: rest.slice(colon + 2) } : { who, kind: rest, subject: null };
}

function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return "เมื่อกี้";
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ชม. ที่แล้ว`;
  return `${Math.round(h / 24)} วันที่แล้ว`;
}

function useUnread(categories: NotifCategory[]): MaintenanceNotif[] {
  const items = useMaintenanceNotifStore((s) => s.items);
  const loaded = useMaintenanceNotifStore((s) => s.loaded);
  const refresh = useMaintenanceNotifStore((s) => s.refresh);
  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);
  const key = categories.join(",");
  return useMemo(
    () => items.filter((n) => !n.readAt && categories.includes(maintenanceCategoryFor(n.type))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, key]
  );
}

/** แจ้งเตือนที่ยังไม่อ่านของรายการนี้ (ใหม่สุดก่อน) — ใช้ทำกรอบแดง/ป้ายบนการ์ด */
export function usePendingFor(referenceId: string, categories: NotifCategory[]): MaintenanceNotif[] {
  const unread = useUnread(categories);
  return useMemo(
    () => unread.filter((n) => n.referenceId === referenceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [unread, referenceId]
  );
}

/** ป้ายแดงบนการ์ด เช่น "💬 ความคิดเห็นใหม่" (+N ถ้ามีหลายเรื่อง) */
export function PendingPin({ notifs }: { notifs: MaintenanceNotif[] }) {
  if (notifs.length === 0) return null;
  const { kind } = splitNotifTitle(notifs[0]!.title);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#dc2626] px-2 py-0.5 text-[10.5px] font-bold text-white"
      title={notifs.map((n) => n.title).join("\n")}
    >
      <span className="truncate">{kind}</span>
      {notifs.length > 1 && <span className="shrink-0">+{notifs.length - 1}</span>}
    </span>
  );
}

const SHOW = 3;

export function PendingForYouStrip({ categories, className }: { categories: NotifCategory[]; className?: string }) {
  const unread = useUnread(categories);
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => [...unread].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [unread]);
  if (rows.length === 0) return null;
  const shown = open ? rows : rows.slice(0, SHOW);
  return (
    <div className={`shrink-0 border-y border-red-200 bg-white px-3 py-2 ${className ?? ""}`}>
      <div className="mb-1.5 flex items-center gap-2 text-[13px] font-bold text-red-700">
        <Bell className="h-4 w-4" />
        รอคุณ
        <span className="rounded-full bg-[#dc2626] px-2 text-[11.5px] leading-5 text-white">{rows.length}</span>
        <span className="text-[11.5px] font-normal text-(--ink-soft)">เปิดดูแล้วจะหายจากรายการนี้</span>
      </div>
      <div className="grid gap-1.5">
        {shown.map((n) => {
          const { who, kind, subject } = splitNotifTitle(n.title);
          const href = maintenanceHrefFor(n.type, n.referenceId);
          const body = (
            <>
              <span className="shrink-0 font-bold text-red-700">{kind}</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-(--ink)">{subject ?? n.body ?? ""}</span>
              <span className="hidden shrink-0 text-(--ink-soft) sm:inline">
                {who ? `${who} · ` : ""}
                {ago(n.createdAt)}
              </span>
              {href && <span className="shrink-0 font-bold text-[#1e7830]">เปิดดู →</span>}
            </>
          );
          const cls = "flex items-center gap-2 rounded-[10px] border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12.5px]";
          return href ? (
            <Link key={n.id} href={href} className={`${cls} hover:bg-red-100`}>
              {body}
            </Link>
          ) : (
            <div key={n.id} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
      {rows.length > SHOW && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-(--ink-soft) hover:text-(--ink)"
        >
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {open ? "ย่อ" : `ดูอีก ${rows.length - SHOW} เรื่อง`}
        </button>
      )}
    </div>
  );
}
