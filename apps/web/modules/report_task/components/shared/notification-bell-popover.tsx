"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { relativeTime } from "@/modules/report_task/lib/format";
import { actionMetaFor, isRoomPost } from "@/modules/report_task/components/shared/report-notification-list";

/**
 * กระดิ่งแจ้งเตือนบน AppBar — กดแล้วเด้ง dropdown สรุปแจ้งเตือนล่าสุด (สไตล์
 * Facebook) แทนการพาไปหน้าเต็มทันที มีปุ่ม "ดูทั้งหมด" ไปหน้า /notifications
 *
 * แสดงเฉพาะแจ้งเตือนที่เกี่ยวกับผู้ใช้เอง (ตัด"โพสต์ใหม่ในห้อง"/ข้ามแผนกออก
 * ด้วย isRoomPost เหมือนหน้าเต็มโหมด "เฉพาะฉัน") เอาล่าสุดสุด ~10 อัน ส่วน
 * ภาพรวมทั้งหมดของ owner ยังดูได้ที่หน้าเต็ม
 *
 * @param extraUnread จำนวนแจ้งเตือนอื่นที่ไม่ได้อยู่ใน dropdown นี้ (เช่นงาน
 *   ซ่อมบำรุงจาก ShellProvider) เอามารวมกับตัวเลขบนกระดิ่งให้ตรงกับหน้าเต็ม
 */
const MAX_ITEMS = 10;

export function NotificationBellPopover({ extraUnread = 0 }: { extraUnread?: number }) {
  const [open, setOpen] = useState(false);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const notifications = useNotificationStore((s) => s.notifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const employees = useEmployeeStore((s) => s.employees);

  const mine = notifications
    .filter((n) => n.userId === viewingAsUserId && !isRoomPost(n))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const unreadCount = mine.filter((n) => !n.read).length;
  const badge = unreadCount + extraUnread;
  const recent = mine.slice(0, MAX_ITEMS);
  const empById = new Map(employees.map((e) => [e.id, e] as const));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="การแจ้งเตือน"
        className="relative rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft)"
      >
        <Bell className="h-5 w-5" />
        {badge > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-[22rem] gap-0 p-0">
        <div className="flex items-center justify-between border-b border-(--line) px-4 py-3">
          <span className="text-base font-semibold text-(--ink)">การแจ้งเตือน</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllRead(viewingAsUserId)}
              className="text-xs font-medium text-(--brand-green-dark) hover:underline"
            >
              อ่านทั้งหมด
            </button>
          )}
        </div>

        {recent.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-(--ink-soft)">ยังไม่มีการแจ้งเตือน</p>
        ) : (
          <div className="max-h-[24rem] overflow-y-auto py-1">
            {recent.map((n) => {
              const actor = empById.get(n.byUserId);
              const { Icon, color } = actionMetaFor(n);
              const inner = (
                <div
                  className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-(--bg-soft)"
                  style={!n.read ? { backgroundColor: "color-mix(in srgb, var(--brand-green) 7%, transparent)" } : undefined}
                >
                  <div className="relative shrink-0">
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
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[13px] leading-snug text-(--ink)" style={!n.read ? { fontWeight: 600 } : undefined}>
                      {n.message}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {n.topicName && (
                        <span className="max-w-[8rem] truncate rounded-full bg-(--bg-soft) px-1.5 py-0.5 text-[10px] font-medium text-(--ink-soft)">
                          {n.topicName}
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
              function onPick() {
                markRead(n.id);
                setOpen(false);
              }
              return n.link ? (
                <Link key={n.id} href={n.link} onClick={onPick} className="block">
                  {inner}
                </Link>
              ) : (
                <button key={n.id} type="button" onClick={onPick} className="block w-full text-left">
                  {inner}
                </button>
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
