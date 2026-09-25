"use client";

import { memo, useMemo, useState } from "react";
import { BellOff, Building2, MoreHorizontal, Pin, Search, SquarePen, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import { useChatStore } from "../store/chat-store";
import type { ChatChannelSummary, ChatUser } from "../types";
import { channelPreview, channelTitle, formatListTime } from "../lib/format";
import { updateChannel } from "../lib/api";
import { ChatAvatar } from "./chat-avatar";
import { PushBanner } from "./push-banner";

type Tab = "all" | "dm" | "group" | "unread";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "dm", label: "ส่วนตัว" },
  { id: "group", label: "กลุ่ม" },
  { id: "unread", label: "ยังไม่อ่าน" },
];

const ORG_COLOR = { bg: "#DCFCE7", text: "#15803D" };

export function ChannelAvatar({
  channel,
  meId,
  users,
  online,
  size = "h-12 w-12",
}: {
  channel: Pick<ChatChannelSummary, "id" | "type" | "name" | "memberIds" | "departmentId">;
  meId: string;
  users: Record<string, ChatUser>;
  online?: boolean;
  size?: string;
}) {
  if (channel.type === "dm") {
    const otherId = channel.memberIds.find((id) => id !== meId) ?? channel.id;
    const other = users[otherId];
    return (
      <div className="relative shrink-0">
        <ChatAvatar name={other?.name ?? "?"} src={other?.avatarUrl} colorKey={otherId} className={size} />
        {online && <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-(--bg) bg-[#22c55e]" aria-label="ออนไลน์" />}
      </div>
    );
  }
  const Icon = channel.type === "org" ? Building2 : Users;
  const color = channel.type === "org" ? ORG_COLOR : undefined;
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full", size)}
      style={color ? { backgroundColor: color.bg, color: color.text } : { backgroundColor: "#E0E7FF", color: "#4338CA" }}
    >
      <Icon className="h-[45%] w-[45%]" />
    </div>
  );
}

const ChannelRow = memo(function ChannelRow({
  channel,
  active,
  meId,
  users,
  online,
  onSelect,
}: {
  channel: ChatChannelSummary;
  active: boolean;
  meId: string;
  users: Record<string, ChatUser>;
  online: boolean;
  onSelect: (id: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const setPrefsLocal = useChatStore((s) => s.setPrefsLocal);
  const title = channelTitle(channel, meId, users);
  const unread = channel.unreadCount > 0;
  const memberCount = channel.type === "group" ? channel.memberIds.length : null;

  const togglePref = (key: "pinned" | "muted") => {
    const value = !channel[key];
    setPrefsLocal(channel.id, { [key]: value });
    setMenu(false);
    updateChannel(channel.id, { [key]: value }).catch(() => {
      setPrefsLocal(channel.id, { [key]: !value });
      toast.error("บันทึกไม่สำเร็จ");
    });
  };

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onSelect(channel.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
          active ? "bg-(--chat-accent-soft)" : "hover:bg-(--bg-soft)"
        )}
      >
        <ChannelAvatar channel={channel} meId={meId} users={users} online={online} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("truncate text-[14.5px] text-(--ink)", unread ? "font-semibold" : "font-medium")}>{title}</span>
            {memberCount != null && <span className="shrink-0 text-[12px] text-(--ink-soft)">({memberCount})</span>}
            {channel.muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-(--ink-soft)" aria-label="ปิดเสียงอยู่" />}
            <span className="ml-auto shrink-0 pl-1 text-[11px] text-(--ink-soft)">{formatListTime(channel.activityAt)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", unread ? "text-(--ink)" : "text-(--ink-soft)")}>
              {channelPreview(channel, meId, users)}
            </span>
            {channel.pinned && <Pin className="h-3.5 w-3.5 shrink-0 rotate-45 text-(--ink-soft)" aria-label="ปักหมุด" />}
            {channel.mentionCount > 0 && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--chat-mention) text-[11px] font-bold text-white" aria-label="มีคนแท็กคุณ">
                @
              </span>
            )}
            {unread && (
              <span
                className={cn(
                  "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white tabular-nums",
                  channel.muted ? "bg-(--ink-soft)/60" : "bg-(--chat-accent)"
                )}
              >
                {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
              </span>
            )}
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={() => setMenu(true)}
        className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full bg-(--bg) text-(--ink-soft) shadow-sm ring-1 ring-(--line) group-hover:flex"
        aria-label="ตัวเลือกห้อง"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
          <div className="absolute right-2 top-9 z-40 w-44 rounded-xl border border-(--line) bg-(--bg) p-1 shadow-xl">
            <button type="button" onClick={() => togglePref("pinned")} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-(--bg-soft)">
              <Pin className="h-4 w-4 text-(--ink-soft)" /> {channel.pinned ? "เลิกปักหมุด" : "ปักหมุดไว้บนสุด"}
            </button>
            <button type="button" onClick={() => togglePref("muted")} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-(--bg-soft)">
              <BellOff className="h-4 w-4 text-(--ink-soft)" /> {channel.muted ? "เปิดเสียงแจ้งเตือน" : "ปิดเสียงแจ้งเตือน"}
            </button>
          </div>
        </>
      )}
    </div>
  );
});

export function ChannelList({ onSelect, onStartNew }: { onSelect: (id: string) => void; onStartNew: () => void }) {
  const channels = useChatStore((s) => s.channels);
  const loaded = useChatStore((s) => s.channelsLoaded);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const users = useChatStore((s) => s.users);
  const onlineIds = useChatStore((s) => s.onlineIds);
  const meId = useChatStore((s) => s.meId);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      channels.filter((c) => {
        if (tab === "dm" && c.type !== "dm") return false;
        if (tab === "group" && c.type === "dm") return false;
        if (tab === "unread" && c.unreadCount === 0) return false;
        if (q && !channelTitle(c, meId, users).toLowerCase().includes(q)) return false;
        return true;
      }),
    [channels, tab, q, meId, users]
  );

  // ค้นหาชื่อคนที่ยังไม่เคยคุยด้วย → กดแล้วเริ่มแชทได้เลย
  const peopleMatches = useMemo(() => {
    if (!q) return [];
    const dmWith = new Set(channels.filter((c) => c.type === "dm").flatMap((c) => c.memberIds));
    return Object.values(users)
      .filter((u) => u.id !== meId && !dmWith.has(u.id) && u.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [q, users, channels, meId]);

  const unreadTotal = channels.reduce((n, c) => n + (c.muted ? 0 : c.unreadCount), 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--bg)">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <h2 className="text-lg font-bold text-(--ink)">แชท</h2>
        {unreadTotal > 0 && <span className="rounded-full bg-(--chat-accent) px-2 text-[11px] font-semibold text-white">{unreadTotal > 99 ? "99+" : unreadTotal}</span>}
        <button
          type="button"
          onClick={onStartNew}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-(--ink) hover:bg-(--bg-soft)"
          aria-label="เริ่มแชทใหม่ / สร้างกลุ่ม"
          title="เริ่มแชทใหม่ / สร้างกลุ่ม"
        >
          <SquarePen className="h-5 w-5" />
        </button>
      </div>

      <div className="px-3">
        <label className="flex items-center gap-2 rounded-xl bg-(--bg-soft) px-3 py-2">
          <Search className="h-4 w-4 text-(--ink-soft)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อคนหรือกลุ่ม"
            className="min-w-0 flex-1 bg-transparent text-base text-(--ink) placeholder:text-(--ink-soft) focus:outline-none sm:text-sm"
          />
        </label>
      </div>

      <div className="flex gap-1.5 overflow-x-auto px-3 py-2.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-[12.5px] transition-colors",
              tab === t.id ? "bg-(--chat-accent) font-semibold text-white" : "bg-(--bg-soft) text-(--ink-soft) hover:text-(--ink)"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <PushBanner />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!loaded && (
          <div className="space-y-1 px-3 py-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <div className="h-12 w-12 animate-pulse rounded-full bg-(--bg-soft)" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/2 animate-pulse rounded bg-(--bg-soft)" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-(--bg-soft)" />
                </div>
              </div>
            ))}
          </div>
        )}
        {loaded && filtered.length === 0 && peopleMatches.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-(--ink-soft)">{q ? "ไม่พบชื่อที่ค้นหา" : tab === "unread" ? "อ่านครบทุกห้องแล้ว" : "ยังไม่มีห้องแชท"}</p>
        )}
        {filtered.map((c) => {
          const otherId = c.type === "dm" ? c.memberIds.find((id) => id !== meId) : undefined;
          return (
            <ChannelRow
              key={c.id}
              channel={c}
              active={c.id === activeChannelId}
              meId={meId}
              users={users}
              online={Boolean(otherId && onlineIds[otherId])}
              onSelect={onSelect}
            />
          );
        })}
        {peopleMatches.length > 0 && (
          <>
            <p className="px-4 pb-1 pt-3 text-[11.5px] font-semibold text-(--ink-soft)">เริ่มแชทใหม่กับ</p>
            {peopleMatches.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  setQuery("");
                  onSelect(`new-dm:${u.id}`);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-(--bg-soft)"
              >
                <div className="relative">
                  <ChatAvatar name={u.name} src={u.avatarUrl} colorKey={u.id} className="h-10 w-10" />
                  {onlineIds[u.id] && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-(--bg) bg-[#22c55e]" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-(--ink)">{u.name}</p>
                  {u.departmentName && <p className="truncate text-[12px] text-(--ink-soft)">{u.departmentName}</p>}
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
