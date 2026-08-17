"use client";

import { Avatar } from "@smartboss/ui/components/avatar";
import { cn } from "@smartboss/ui/cn";
import type { ChatChannelSummary, ChatUser } from "../types";
import { formatMessageTime } from "../lib/format";

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

      <div className="flex-1 overflow-y-auto">
        {channels.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-[var(--ink-soft)]">ยังไม่มีห้องแชท</p>
        )}
        {channels.map((c) => {
          const label = channelLabel(c, currentUserId, usersById);
          const isDm = c.type === "dm";
          const otherId = isDm ? c.memberIds.find((id) => id !== currentUserId) : undefined;
          const avatarUser = otherId ? usersById.get(otherId) : undefined;
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
                "flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-soft)]",
                activeChannelId === c.id && "bg-[var(--accent,var(--bg-soft))]"
              )}
            >
              <Avatar name={label} src={avatarUser?.avatarUrl} className={cn(c.type === "group" && "bg-[var(--chart-violet,#e5e7eb)]")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-[var(--ink)]">{label}</span>
                  {c.lastMessage && (
                    <span className="shrink-0 text-[10px] text-[var(--ink-soft)]">
                      {formatMessageTime(c.lastMessage.createdAt)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-[var(--ink-soft)]">{preview}</span>
                  {c.unreadCount > 0 && (
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
