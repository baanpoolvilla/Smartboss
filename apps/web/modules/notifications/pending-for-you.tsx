"use client";

import { useEffect, useMemo } from "react";
import { maintenanceCategoryFor } from "./derive";
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

/**
 * แถบแดงขอบบนการ์ด "ยังไม่ได้อ่าน · 💬 ความคิดเห็นใหม่" (+N ถ้ามีหลายเรื่อง) — ผู้ใช้ขอ 18/10/2569
 * "ขอบบนว่ายังไม่ได้อ่าน ทำให้รู้" · เปิดดูแล้วแจ้งเตือนถูกอ่าน แถบ/พื้นแดงหายเอง
 * วางเป็นลูกตัวแรกของการ์ด (ผู้เรียกจัดให้ชิดขอบบนเอง)
 */
export function PendingBand({ notifs, className }: { notifs: MaintenanceNotif[]; className?: string }) {
  if (notifs.length === 0) return null;
  const { kind } = splitNotifTitle(notifs[0]!.title);
  return (
    <div
      className={`flex items-center gap-1 bg-[#dc2626] px-3 py-1 text-[11px] font-bold leading-4 text-white ${className ?? ""}`}
      title={`ยังไม่ได้อ่าน — เปิดดูแล้วการ์ดจะกลับเป็นสีปกติ\n${notifs.map((n) => n.title).join("\n")}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" aria-hidden />
      <span className="shrink-0">ยังไม่ได้อ่าน ·</span>
      <span className="truncate">{kind}</span>
      {notifs.length > 1 && <span className="shrink-0">+{notifs.length - 1}</span>}
    </div>
  );
}
