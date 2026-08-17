"use client";

import { useEffect, useRef } from "react";
import { cn } from "@smartboss/ui/cn";
import type { ChatMessageDTO, ChatUser } from "../types";
import { formatFileSize, formatMessageTime } from "../lib/format";
import { ChatAvatar } from "./chat-avatar";

function AttachmentView({ a }: { a: ChatMessageDTO["attachments"][number] }) {
  if (a.kind === "image") {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="mt-1.5 block max-w-[240px] overflow-hidden rounded-lg border border-[var(--line)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.url} alt={a.name} className="max-h-[240px] w-full object-cover" />
      </a>
    );
  }
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs hover:bg-[var(--bg-soft)]"
    >
      <span aria-hidden>📎</span>
      <span className="min-w-0 flex-1 truncate">{a.name}</span>
      <span className="shrink-0 text-[var(--ink-soft)]">{formatFileSize(a.size)}</span>
    </a>
  );
}

export function MessageThread({
  messages,
  currentUserId,
  usersById,
  onDelete,
}: {
  messages: ChatMessageDTO[];
  currentUserId: string;
  usersById: Map<string, ChatUser>;
  /** ลบข้อความของตัวเอง (ส่งผิด) — ไม่มี prop นี้ = ไม่โชว์ปุ่มลบเลย */
  onDelete?: (messageId: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[var(--ink-soft)]">ยังไม่มีข้อความ — เริ่มทักได้เลย</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {messages.map((m, i) => {
        const mine = m.authorId === currentUserId;
        const author = usersById.get(m.authorId);
        const prev = messages[i - 1];
        const showAuthor = !mine && (!prev || prev.authorId !== m.authorId);
        const pending = m.id.startsWith("temp-");

        const canDelete = mine && !pending && onDelete;

        return (
          <div key={m.id} className={cn("group flex items-end gap-2", mine && "flex-row-reverse")}>
            {!mine && (
              <div className="w-7 shrink-0">
                {showAuthor && (
                  <ChatAvatar name={author?.name ?? "?"} src={author?.avatarUrl} colorKey={m.authorId} className="h-7 w-7" />
                )}
              </div>
            )}
            <div className={cn("flex max-w-[70%] flex-col", mine && "items-end")}>
              {showAuthor && <span className="mb-0.5 px-1 text-[11px] text-[var(--ink-soft)]">{author?.name}</span>}
              {m.body && (
                <div
                  className={cn(
                    "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
                    mine ? "bg-[var(--brand-green)] text-white" : "bg-[var(--bg-soft)] text-[var(--ink)]",
                    pending && "opacity-60"
                  )}
                >
                  {m.body}
                </div>
              )}
              {m.attachments.map((a, ai) => (
                <AttachmentView key={ai} a={a} />
              ))}
              <span className="mt-0.5 flex items-center gap-1.5 px-1 text-[10px] text-[var(--ink-soft)]">
                {pending ? "กำลังส่ง..." : formatMessageTime(m.createdAt)}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(m.id)}
                    className="opacity-0 transition-opacity hover:text-[var(--chart-red-dark,#b91c1c)] group-hover:opacity-100"
                    title="ลบข้อความนี้ (ส่งผิด)"
                    aria-label="ลบข้อความนี้"
                  >
                    ลบ
                  </button>
                )}
              </span>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
