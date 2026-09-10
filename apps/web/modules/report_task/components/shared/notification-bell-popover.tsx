"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { relativeTime } from "@/modules/report_task/lib/format";
import { metaForCategory } from "@/modules/notifications/derive";
import { useUnifiedNotifications } from "@/modules/notifications/use-unified-notifications";
import type { UnifiedNotification } from "@/modules/notifications/types";

/**
 * กระดิ่งแจ้งเตือนบน AppBar — กดแล้วเด้ง dropdown สรุปแจ้งเตือนล่าสุด (สไตล์
 * Facebook) แทนการพาไปหน้าเต็มทันที มีปุ่ม "ดูทั้งหมด" ไปหน้า /notifications
 *
 * รวม 2 แหล่ง (report_task + maintenance) ผ่าน useUnifiedNotifications —
 * แจ้งเตือนส่วนตัว (mention/reply/task/ตั๋ว) ของทุกคน บวก "โพสต์ใหม่ในห้อง"
 * (room_post) ของทุกห้องทั้งบริษัทด้วยสำหรับ owner โดยเฉพาะ (`isOwner` gate
 * อยู่ในตัว hook เอง — คนทั่วไปไม่มีทางเห็น room_post หลุดมาที่นี่)
 * เอาล่าสุดสุด ~10 อัน เรียงยังไม่อ่านขึ้นก่อนเสมอ ตัวเลขบนกระดิ่งจึงรวมทุก
 * module จริง ไม่ต้องรับเลขจากที่อื่นมาบวกเองอีก
 */
const MAX_ITEMS = 10;

export function NotificationBellPopover() {
  const [open, setOpen] = useState(false);
  const employees = useEmployeeStore((s) => s.employees);
  // includeRoomPosts: true — an owner explicitly asked for "ทุกโพสต์ทุกห้อง"
  // to show up right in this dropdown too, not just the full /notifications
  // page's own "ดูทั้งหมด" mode. Safe to pass unconditionally: the hook
  // re-checks isOwner itself, so a non-owner never sees room_post items no
  // matter what this call site passes.
  const { items, unreadCount, maintenanceLoaded, markRead, markAllRead, refresh } = useUnifiedNotifications({ includeRoomPosts: true });

  // โหลดแจ้งเตือนซ่อมบำรุงรอบแรกตอน mount แล้วรีเฟรชอีกทีทุกครั้งที่เปิด
  // dropdown — ของ report_task server-synced อยู่แล้วผ่าน ServerStoreSync
  // ที่อื่น ไม่ต้อง refresh เอง
  useEffect(() => {
    if (!maintenanceLoaded) void refresh();
  }, [maintenanceLoaded, refresh]);
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const recent = items.slice(0, MAX_ITEMS);
  const empById = new Map(employees.map((e) => [e.id, e] as const));

  function onPick(id: string) {
    markRead(id);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="การแจ้งเตือน"
        className="relative rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft)"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-[22rem] gap-0 p-0">
        <div className="flex items-center justify-between border-b border-(--line) px-4 py-3">
          <span className="text-base font-semibold text-(--ink)">การแจ้งเตือน</span>
          {unreadCount > 0 && (
            <button type="button" onClick={markAllRead} className="text-xs font-medium text-(--brand-green-dark) hover:underline">
              อ่านทั้งหมด
            </button>
          )}
        </div>

        {recent.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-(--ink-soft)">ยังไม่มีการแจ้งเตือน</p>
        ) : (
          <div className="max-h-[24rem] overflow-y-auto py-1">
            {recent.map((n) => {
              const actor = n.byUserId ? empById.get(n.byUserId) : undefined;
              const { Icon, color } = metaForCategory(n.category);
              const row = (
                <div
                  className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-(--bg-soft)"
                  style={!n.read ? { backgroundColor: "color-mix(in srgb, var(--brand-green) 7%, transparent)" } : undefined}
                >
                  <div className="relative shrink-0">
                    {/* report items แนบคนที่ทำมาด้วยเสมอ → โชว์ avatar จริง +
                        แบดจ์ไอคอนมุมล่าง maintenance ไม่มีคนแนบ → ใช้วงกลม
                        ไอคอนสีตาม category แทนทั้งดวง */}
                    {n.module === "report" ? (
                      <>
                        <Avatar>
                          <AvatarImage src={actor?.avatarUrl ?? undefined} alt={actor?.name ?? ""} />
                          <AvatarFallback className="bg-(--bg-soft) text-[11px] text-(--ink)">
                            {actor?.avatar ?? "?"}
                          </AvatarFallback>
                        </Avatar>
                        <span
                          className="absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-(--bg)"
                          style={{ backgroundColor: color }}
                        >
                          <Icon className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
                        </span>
                      </>
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: `${color}22` }}>
                        <Icon className="h-[18px] w-[18px]" style={{ color }} strokeWidth={2.2} />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[13px] leading-snug text-(--ink)" style={!n.read ? { fontWeight: 600 } : undefined}>
                      {n.message}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {n.roomName && (
                        <span className="max-w-[8rem] truncate rounded-full bg-(--bg-soft) px-1.5 py-0.5 text-[10px] font-medium text-(--ink-soft)">
                          {n.roomName}
                        </span>
                      )}
                      <span
                        className="text-[11px]"
                        style={!n.read ? { color: "var(--brand-green-dark)", fontWeight: 600 } : { color: "var(--ink-soft)" }}
                      >
                        {relativeTime(n.createdAt)}
                      </span>
                    </div>
                  </div>
                  {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-(--brand-green-dark)" />}
                </div>
              );
              return (
                <NotificationRow key={n.id} n={n} onPick={onPick}>
                  {row}
                </NotificationRow>
              );
            })}
          </div>
        )}

        <Link
          href="/notifications"
          onClick={() => setOpen(false)}
          className="block border-t border-(--line) px-4 py-3 text-center text-sm font-medium text-(--brand-green-dark) hover:bg-(--bg-soft)"
        >
          ดูทั้งหมด
        </Link>
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({ n, onPick, children }: { n: UnifiedNotification; onPick: (id: string) => void; children: ReactNode }) {
  return n.link ? (
    <Link href={n.link} onClick={() => onPick(n.id)} className="block">
      {children}
    </Link>
  ) : (
    <button type="button" onClick={() => onPick(n.id)} className="block w-full text-left">
      {children}
    </button>
  );
}
