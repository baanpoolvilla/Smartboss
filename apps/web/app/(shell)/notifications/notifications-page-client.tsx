"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { isOwner, canManage } from "@/modules/report_task/lib/directory";
import { relativeTime } from "@/modules/report_task/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { useUnifiedNotifications } from "@/modules/notifications/use-unified-notifications";
import { metaForCategory, labelForCategory } from "@/modules/notifications/derive";
import { matchesRange, RANGE_LABEL, type NotifRange } from "@/modules/notifications/date-range";
import type { NotifCategory, NotifModule, UnifiedNotification } from "@/modules/notifications/types";

const SHOW_ALL_KEY = "sb.notif.showAll";

type StatusFilter = "all" | "unread";
type ModuleFilter = "all" | NotifModule;

const MODULE_LABEL: Record<ModuleFilter, string> = {
  all: "ทุกโมดูล",
  report: "รายงาน-งาน",
  maintenance: "ซ่อมบำรุง",
};

/**
 * รวมแจ้งเตือนทุกแหล่ง (report_task + maintenance) เป็นลิสต์เดียว พร้อม
 * ฟิลเตอร์เต็ม — แทนที่ 2 section แยกเดิม (ReportTaskNotificationsSection +
 * การ์ดซ่อมบำรุงต่างหาก) ด้วยลิสต์เดียวเรียง unread-first
 *
 * สิทธิ์: ทุกคนเห็นเฉพาะแจ้งเตือนของตัวเอง โหมด "ภาพรวมทั้งหมด" (เห็น
 * "โพสต์ใหม่ในห้อง" ด้วย) เปิดได้เฉพาะ owner/หัวหน้าแผนก (canManage) —
 * useUnifiedNotifications เองก็เช็ค canManage ซ้ำอีกชั้นก่อนจะยอมรวม
 * room_post เข้ามาจริง ขอบเขตต่างกันตาม role: owner เห็นทั้งบริษัท
 * หัวหน้าแผนกเห็นแค่ห้องในแผนกตัวเอง — ตัดสินใจตอนสร้าง notification เอง
 * (report-feed-store.ts's addPost) ไม่ใช่ตรงนี้ สวิตช์นี้แค่เลือกว่าจะรวม
 * room_post เข้ามาไหม ไม่ได้เลือกขอบเขต
 */
export function NotificationsPageClient() {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const employees = useEmployeeStore((s) => s.employees);
  const owner = isOwner(viewingAsUserId);
  const manager = canManage(viewingAsUserId);

  const [showAll, setShowAll] = useState(false);
  // จำค่าสวิตช์ภาพรวมไว้ในเครื่อง (เฉพาะคนมีสิทธิ์) — อ่านหลัง mount เท่านั้น
  // เพราะ server ไม่รู้จัก localStorage เลยเริ่มด้วย false เสมอ อ่านตรงๆ ใน
  // useState initializer จะได้ค่าจริงจากเครื่อง client ทันที ต่างจากที่ server
  // render มาให้ตอน hydrate → hydration mismatch — คีย์เดียวกับสวิตช์เล็กบน
  // กระดิ่ง (notification-bell-popover.tsx) เจตนาให้สลับที่ไหนก็ตรงกันทั้งคู่
  useEffect(() => {
    if (!manager) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowAll(localStorage.getItem(SHOW_ALL_KEY) === "1");
    } catch {
      /* private mode ฯลฯ — คงค่าเริ่มต้น เฉพาะฉัน */
    }
  }, [manager]);
  function toggleShowAll(next: boolean) {
    setShowAll(next);
    try {
      localStorage.setItem(SHOW_ALL_KEY, next ? "1" : "0");
    } catch {
      /* best-effort */
    }
  }

  const { items, maintenanceLoaded, markRead, markAllRead, refresh } = useUnifiedNotifications({
    includeRoomPosts: manager && showAll,
  });
  useEffect(() => {
    if (!maintenanceLoaded) void refresh();
  }, [maintenanceLoaded, refresh]);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>("all");
  const [category, setCategory] = useState<NotifCategory | "all">("all");
  const [room, setRoom] = useState<string>("all");
  const [range, setRange] = useState<NotifRange>("all");

  // ตัวเลือกในฟิลเตอร์ "ประเภท"/"ห้อง" แสดงเฉพาะค่าที่มีจริงในลิสต์ — กันเมนู
  // ยาวเปล่าๆ ด้วยตัวเลือกที่ไม่มีแจ้งเตือนไหนตรงเลยสักอัน
  const availableCategories = useMemo(() => {
    const set = new Set<NotifCategory>();
    for (const n of items) set.add(n.category);
    return Array.from(set);
  }, [items]);
  const availableRooms = useMemo(() => {
    const set = new Set<string>();
    for (const n of items) if (n.roomName) set.add(n.roomName);
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter((n) => {
        if (status === "unread" && n.read) return false;
        if (moduleFilter !== "all" && n.module !== moduleFilter) return false;
        if (category !== "all" && n.category !== category) return false;
        if (room !== "all" && n.roomName !== room) return false;
        if (!matchesRange(n.createdAt, range)) return false;
        return true;
      }),
    [items, status, moduleFilter, category, room, range]
  );

  const hasActiveFilters = status !== "all" || moduleFilter !== "all" || category !== "all" || room !== "all" || range !== "all";
  function clearFilters() {
    setStatus("all");
    setModuleFilter("all");
    setCategory("all");
    setRoom("all");
    setRange("all");
  }

  const unread = filtered.filter((n) => !n.read);
  const earlier = filtered.filter((n) => n.read);
  const hasUnread = unread.length > 0;
  const empById = new Map(employees.map((e) => [e.id, e] as const));

  function Row({ n }: { n: UnifiedNotification }) {
    const actor = n.byUserId ? empById.get(n.byUserId) : undefined;
    const { Icon, color } = metaForCategory(n.category);
    const inner = (
      <div
        className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-(--bg-soft)"
        style={!n.read ? { backgroundColor: "color-mix(in srgb, var(--brand-green) 7%, transparent)" } : undefined}
      >
        <div className="relative shrink-0">
          {n.module === "report" ? (
            <>
              <Avatar size="lg">
                <AvatarImage src={actor?.avatarUrl ?? undefined} alt={actor?.name ?? ""} />
                <AvatarFallback className="bg-(--bg-soft) text-xs text-(--ink)">{actor?.avatar ?? "?"}</AvatarFallback>
              </Avatar>
              <span
                className="absolute -right-0.5 -bottom-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-(--bg)"
                style={{ backgroundColor: color }}
              >
                <Icon className="h-3 w-3 text-white" strokeWidth={2.5} />
              </span>
            </>
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: `${color}22` }}>
              <Icon className="h-5 w-5" style={{ color }} strokeWidth={2.2} />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-(--ink)" style={!n.read ? { fontWeight: 600 } : undefined}>
            {n.message}
          </p>
          {n.body && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-(--ink-soft)">{n.body}</p>}
          <div className="mt-0.5 flex items-center gap-2">
            {n.roomName && (
              <span className="inline-block max-w-[10rem] truncate rounded-full bg-(--bg-soft) px-2 py-0.5 text-[11px] font-medium text-(--ink-soft)">
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

        {!n.read && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-(--brand-green-dark)" />}
      </div>
    );

    return n.link ? (
      <Link key={n.id} href={n.link} className="block" onClick={() => markRead(n.id)}>
        {inner}
      </Link>
    ) : (
      <button key={n.id} type="button" onClick={() => markRead(n.id)} className="block w-full text-left">
        {inner}
      </button>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-(--ink)">การแจ้งเตือน</h1>
        <div className="flex items-center gap-3">
          {manager && (
            <div className="inline-flex rounded-full border border-(--line) bg-(--bg) p-0.5 text-xs">
              <button
                type="button"
                onClick={() => toggleShowAll(false)}
                className="rounded-full px-3 py-1 font-medium transition-colors"
                style={!showAll ? { backgroundColor: "var(--brand-green-dark)", color: "#fff" } : { color: "var(--ink-soft)" }}
              >
                เฉพาะฉัน
              </button>
              <button
                type="button"
                onClick={() => toggleShowAll(true)}
                className="rounded-full px-3 py-1 font-medium transition-colors"
                style={showAll ? { backgroundColor: "var(--brand-green-dark)", color: "#fff" } : { color: "var(--ink-soft)" }}
              >
                {owner ? "ภาพรวมทั้งบริษัท" : "ภาพรวมแผนกที่ดูแล"}
              </button>
            </div>
          )}
          {hasUnread && (
            <button type="button" onClick={markAllRead} className="whitespace-nowrap text-xs font-medium text-(--brand-green-dark) hover:underline">
              อ่านทั้งหมดแล้ว
            </button>
          )}
        </div>
      </header>

      {/* แถบฟิลเตอร์ — sticky บนสุด ไม่ต้องเลื่อนขึ้นไปหาเวลาสลับ */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-(--line) bg-(--bg)/95 px-4 py-2.5 backdrop-blur">
        <div className="inline-flex rounded-full border border-(--line) bg-(--bg-soft) p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setStatus("all")}
            className="rounded-full px-3 py-1 font-medium transition-colors"
            style={status === "all" ? { backgroundColor: "var(--brand-green-dark)", color: "#fff" } : { color: "var(--ink-soft)" }}
          >
            ทั้งหมด
          </button>
          <button
            type="button"
            onClick={() => setStatus("unread")}
            className="rounded-full px-3 py-1 font-medium transition-colors"
            style={status === "unread" ? { backgroundColor: "var(--brand-green-dark)", color: "#fff" } : { color: "var(--ink-soft)" }}
          >
            ยังไม่อ่าน
          </button>
        </div>

        <Select value={moduleFilter} onValueChange={(v) => setModuleFilter((v ?? "all") as ModuleFilter)}>
          <SelectTrigger className="h-8 w-auto min-w-[7.5rem] text-xs">
            <SelectValue>{MODULE_LABEL[moduleFilter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(["all", "report", "maintenance"] as const).map((m) => (
              <SelectItem key={m} value={m}>
                {MODULE_LABEL[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={(v) => setCategory((v ?? "all") as NotifCategory | "all")}>
          <SelectTrigger className="h-8 w-auto min-w-[8rem] text-xs">
            <SelectValue>{category === "all" ? "ทุกประเภท" : labelForCategory(category)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกประเภท</SelectItem>
            {availableCategories.map((c) => (
              <SelectItem key={c} value={c}>
                {labelForCategory(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {availableRooms.length > 0 && (
          <Select value={room} onValueChange={(v) => setRoom(v ?? "all")}>
            <SelectTrigger className="h-8 w-auto min-w-[8rem] text-xs">
              <SelectValue>{room === "all" ? "ทุกห้อง" : room}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกห้อง</SelectItem>
              {availableRooms.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={range} onValueChange={(v) => setRange((v ?? "all") as NotifRange)}>
          <SelectTrigger className="h-8 w-auto min-w-[7.5rem] text-xs">
            <SelectValue>{RANGE_LABEL[range]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(["today", "7d", "month", "all"] as const).map((r) => (
              <SelectItem key={r} value={r}>
                {RANGE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
          >
            <X className="h-3 w-3" />
            ล้างฟิลเตอร์
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-(--ink-soft)">
          {items.length === 0
            ? "ไม่มีการแจ้งเตือน"
            : hasActiveFilters
              ? "ไม่มีแจ้งเตือนที่ตรงกับตัวกรองนี้"
              : "ไม่มีการแจ้งเตือนที่เกี่ยวกับคุณ"}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {unread.length > 0 && (
            <div>
              <p className="mb-1 px-1 text-xs font-semibold text-(--ink)">ใหม่</p>
              <div className="flex flex-col gap-0.5">
                {unread.map((n) => (
                  <Row key={n.id} n={n} />
                ))}
              </div>
            </div>
          )}
          {earlier.length > 0 && (
            <div>
              <p className="mb-1 px-1 text-xs font-semibold text-(--ink-soft)">ก่อนหน้านี้</p>
              <div className="flex flex-col gap-0.5">
                {earlier.map((n) => (
                  <Row key={n.id} n={n} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
