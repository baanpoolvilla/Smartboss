"use client";

import { Avatar } from "@smartboss/ui/components/avatar";
import { cn } from "@smartboss/ui/cn";
import type { ChatChannelSummary, ChatUser } from "../types";
import { formatMessageTime } from "../lib/format";
import { avatarColorFor } from "../lib/avatar-color";

function channelLabel(channel: ChatChannelSummary, currentUserId: string, usersById: Map<string, ChatUser>): string {
  if (channel.type === "org") return channel.name ?? "ห้องรวมทั้งบริษัท";
  if (channel.name) return channel.name;
  // DM ไม่มีชื่อของตัวเอง — ต่อชื่อจากสมาชิกอีกฝั่ง
  const otherId = channel.memberIds.find((id) => id !== currentUserId);
  return (otherId && usersById.get(otherId)?.name) || "แชทส่วนตัว";
}

export function ChannelList({
  channels,
  usersById,
  currentUserId,
  activeChannelId,
  onSelect,
  onStartNew,
}: {
  channels: ChatChannelSummary[];
  usersById: Map<string, ChatUser>;
  currentUserId: string;
  activeChannelId: string | null;
  onSelect: (id: string) => void;
  onStartNew: () => void;
}) {
  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">แชท</h2>
        <button
          type="button"
          onClick={onStartNew}
          className="rounded-full bg-[var(--brand-green)] px-3 py-1 text-xs font-medium text-white hover:brightness-95"
        >
          + แชทใหม่
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {channels.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-[var(--ink-soft)]">ยังไม่มีห้องแชท</p>
        )}
        {channels.map((c) => {
          const label = channelLabel(c, currentUserId, usersById);
          const isDm = c.type === "dm";
          const isOrg = c.type === "org";
          const otherId = isDm ? c.memberIds.find((id) => id !== currentUserId) : undefined;
          const avatarUser = otherId ? usersById.get(otherId) : undefined;
          // ห้อง org เป็น "ทุกคน" ไม่ใช่ของใครคนเดียว — ให้สีแบรนด์คงที่แยกจาก
          // DM/กลุ่มที่แต่ละอันมีสีของตัวเองตามคน/ตามห้อง กันสับสนว่าห้องไหน
          // เป็นห้องรวม
          const color = isOrg ? null : avatarColorFor(otherId ?? c.id);
          const active = activeChannelId === c.id;
          const unread = c.unreadCount > 0;

          const lastAuthorName =
            c.lastMessage && c.lastMessage.authorId !== currentUserId
              ? usersById.get(c.lastMessage.authorId)?.name?.split(" ")[0]
              : c.lastMessage
                ? "คุณ"
                : undefined;
          const preview = c.lastMessage
            ? `${lastAuthorName ? `${lastAuthorName}: ` : ""}${c.lastMessage.body ?? (c.lastMessage.hasAttachment ? "📎 ไฟล์แนบ" : "")}`
            : "ยังไม่มีข้อความ";

          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              className={cn(
                "mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                active ? "bg-[var(--brand-green)]/12" : "hover:bg-[var(--bg-soft)]"
              )}
            >
              <Avatar
                name={label}
                src={avatarUser?.avatarUrl}
                className="h-10 w-10 shrink-0 text-[13px] font-semibold"
                style={color ? { backgroundColor: color.bg, color: color.text } : undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm text-[var(--ink)]", unread ? "font-semibold" : "font-medium")}>
                    {label}
                  </span>
                  {c.lastMessage && (
                    <span
                      className={cn(
                        "shrink-0 text-[10.5px]",
                        unread ? "font-semibold text-[var(--brand-green-dark,var(--brand-green))]" : "text-[var(--ink-soft)]"
                      )}
                    >
                      {formatMessageTime(c.lastMessage.createdAt)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-[12.5px]", unread ? "text-[var(--ink)]" : "text-[var(--ink-soft)]")}>
                    {preview}
                  </span>
                  {unread && (
                    <span className="flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-green)] px-1 text-[10px] font-semibold text-white">
                      {c.unreadCount > 9 ? "9+" : c.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
