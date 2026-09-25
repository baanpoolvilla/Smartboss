"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Info, Loader2, Megaphone, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import { useChatStore, type RoomMessage } from "../store/chat-store";
import type { ChatAttachment, ChatChannelSummary, ChatMessageDTO } from "../types";
import * as api from "../lib/api";
import { attachmentLabel, channelTitle, formatDayLabel, formatClock } from "../lib/format";
import { jumpToMessage } from "../lib/chat-actions";
import { ChannelAvatar } from "./channel-list";
import { ChatAvatar } from "./chat-avatar";
import { Composer, type ComposerHandle } from "./composer";
import { Lightbox } from "./lightbox";
import { MessageList } from "./message-list";
import { ChatModal } from "./new-chat-dialog";
import { RoomInfo } from "./room-info";

function SearchBar({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const users = useChatStore((s) => s.users);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ term: string; messages: ChatMessageDTO[] } | null>(null);
  const term = q.trim();
  // ผลลัพธ์ของคำที่พิมพ์อยู่ตอนนี้เท่านั้น — พิมพ์ต่อระหว่างรอ จะไม่เห็นผลของคำเก่า
  const results = term && found?.term === term ? found.messages : null;
  const loading = Boolean(term) && found?.term !== term;

  useEffect(() => {
    if (!term) return;
    const t = setTimeout(() => {
      api
        .searchChannelMessages(channelId, term)
        .then((r) => setFound({ term, messages: r.messages }))
        .catch(() => setFound({ term, messages: [] }));
    }, 300);
    return () => clearTimeout(t);
  }, [term, channelId]);

  return (
    <div className="relative border-b border-(--line) bg-(--bg) px-3 py-2">
      <div className="flex items-center gap-2 rounded-xl bg-(--bg-soft) px-3 py-1.5">
        <Search className="h-4 w-4 text-(--ink-soft)" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาข้อความในห้องนี้" className="min-w-0 flex-1 bg-transparent text-base focus:outline-none sm:text-sm" />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-(--ink-soft)" />}
        <button type="button" onClick={onClose} className="rounded-full p-0.5 text-(--ink-soft) hover:bg-(--line)" aria-label="ปิดการค้นหา">
          <X className="h-4 w-4" />
        </button>
      </div>
      {results && (
        <div className="absolute inset-x-3 top-full z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-(--line) bg-(--bg) py-1 shadow-xl">
          {results.length === 0 && <p className="px-4 py-6 text-center text-sm text-(--ink-soft)">ไม่พบข้อความ</p>}
          {results.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                void jumpToMessage(channelId, m.id);
                onClose();
              }}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-(--bg-soft)"
            >
              <ChatAvatar name={users[m.authorId]?.name ?? "?"} src={users[m.authorId]?.avatarUrl} colorKey={m.authorId} className="h-8 w-8" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[13px] font-medium text-(--ink)">{users[m.authorId]?.name ?? "สมาชิก"}</span>
                  <span className="shrink-0 text-[11px] text-(--ink-soft)">
                    {formatDayLabel(m.createdAt)} {formatClock(m.createdAt)}
                  </span>
                </span>
                <span className="line-clamp-2 text-[12.5px] text-(--ink-soft)">{m.body}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AnnouncementBar({ channelId, canManage, channelType }: { channelId: string; canManage: boolean; channelType: string }) {
  const announcement = useChatStore((s) => s.details[channelId]?.announcement);
  const users = useChatStore((s) => s.users);
  const [expanded, setExpanded] = useState(false);
  if (!announcement) return null;
  const canUnpin = canManage || channelType === "dm";
  return (
    <div className="flex items-start gap-2.5 border-b border-(--line) bg-(--bg) px-3 py-2">
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-(--chat-accent)" />
      <button type="button" onClick={() => void jumpToMessage(channelId, announcement.id)} className="min-w-0 flex-1 text-left">
        <p className="text-[11px] font-semibold text-(--chat-accent-strong)">ประกาศ · {users[announcement.authorId]?.name ?? "สมาชิก"}</p>
        <p className={cn("text-[13px] text-(--ink)", expanded ? "whitespace-pre-wrap" : "truncate")}>
          {announcement.body || attachmentLabel(announcement.attachments[0]?.kind ?? null)}
        </p>
      </button>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="rounded-full p-1 text-(--ink-soft) hover:bg-(--bg-soft)" aria-label={expanded ? "ย่อ" : "ขยาย"}>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {canUnpin && (
        <button
          type="button"
          onClick={() => api.updateChannel(channelId, { announcementId: null }).catch(() => toast.error("เอาประกาศออกไม่สำเร็จ"))}
          className="rounded-full p-1 text-(--ink-soft) hover:bg-(--bg-soft)"
          aria-label="เอาประกาศออก"
          title="เอาประกาศออก"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function ChatRoom({ channel, initialUnread, onBack }: { channel: ChatChannelSummary; initialUnread: number; onBack: () => void }) {
  const users = useChatStore((s) => s.users);
  const onlineIds = useChatStore((s) => s.onlineIds);
  const meId = useChatStore((s) => s.meId);
  const detail = useChatStore((s) => s.details[channel.id]);
  const typing = useChatStore((s) => s.typing[channel.id]);
  const [replyTo, setReplyTo] = useState<RoomMessage | null>(null);
  const [lightbox, setLightbox] = useState<{ items: ChatAttachment[]; index: number } | null>(null);
  const [readers, setReaders] = useState<RoomMessage | null>(null);
  const [searching, setSearching] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);
  const dragDepth = useRef(0);

  const title = channelTitle(channel, meId, users);
  const otherId = channel.type === "dm" ? channel.memberIds.find((id) => id !== meId) : undefined;
  const typingCount = Object.keys(typing ?? {}).length;
  const subtitle =
    channel.type === "dm"
      ? typingCount > 0
        ? "กำลังพิมพ์…"
        : otherId && onlineIds[otherId]
          ? "ออนไลน์"
          : (users[otherId ?? ""]?.departmentName ?? "")
      : channel.type === "org"
        ? `ทุกคนในบริษัท · ${Object.keys(users).length} คน`
        : `${channel.memberIds.length} คน${channel.departmentId ? " · กลุ่มแผนก" : ""}`;

  const mentionable = useMemo(() => {
    if (channel.type === "org") return Object.values(users);
    return channel.memberIds.map((id) => users[id]).filter((u): u is NonNullable<typeof u> => Boolean(u));
  }, [channel.type, channel.memberIds, users]);

  const onOpenMedia = useCallback((items: ChatAttachment[], index: number) => setLightbox({ items, index }), []);
  const onShowReaders = useCallback((m: RoomMessage) => {
    if (channel.type !== "dm") setReaders(m);
  }, [channel.type]);

  const readerList = useMemo(() => {
    if (!readers?.seq || !detail) return { read: [], unread: [] as string[] };
    const seq = BigInt(readers.seq);
    const pool = channel.type === "org" ? Object.keys(users) : channel.memberIds;
    const read: string[] = [];
    const unread: string[] = [];
    for (const id of pool) {
      if (id === meId) continue;
      const r = detail.readSeqs[id];
      if (r && BigInt(r) >= seq) read.push(id);
      else unread.push(id);
    }
    return { read, unread };
  }, [readers, detail, channel.type, channel.memberIds, users, meId]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div
        className="relative flex min-w-0 flex-1 flex-col"
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length > 0) composerRef.current?.addFiles(files);
        }}
      >
        <header className="flex items-center gap-2 border-b border-(--line) bg-(--bg) px-2 py-2 sm:px-3">
          <button type="button" onClick={onBack} className="rounded-full p-2 text-(--ink) hover:bg-(--bg-soft) md:hidden" aria-label="กลับไปรายการแชท">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => setInfoOpen(true)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
            <ChannelAvatar channel={channel} meId={meId} users={users} online={Boolean(otherId && onlineIds[otherId])} size="h-10 w-10" />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold text-(--ink)">{title}</span>
              <span className={cn("block truncate text-[12px]", subtitle === "ออนไลน์" || subtitle === "กำลังพิมพ์…" ? "text-(--chat-accent-strong)" : "text-(--ink-soft)")}>
                {subtitle}
              </span>
            </span>
          </button>
          <button type="button" onClick={() => setSearching((v) => !v)} className="rounded-full p-2 text-(--ink-soft) hover:bg-(--bg-soft)" aria-label="ค้นหาข้อความ" title="ค้นหาข้อความ">
            <Search className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => setInfoOpen((v) => !v)} className="rounded-full p-2 text-(--ink-soft) hover:bg-(--bg-soft)" aria-label="ข้อมูลห้อง" title="ข้อมูลห้อง">
            <Info className="h-5 w-5" />
          </button>
        </header>

        {searching && <SearchBar channelId={channel.id} onClose={() => setSearching(false)} />}
        <AnnouncementBar channelId={channel.id} canManage={detail?.canManage ?? false} channelType={channel.type} />

        <MessageList
          channelId={channel.id}
          channelType={channel.type}
          canManage={detail?.canManage ?? false}
          initialUnread={initialUnread}
          onReply={setReplyTo}
          onOpenMedia={onOpenMedia}
          onShowReaders={onShowReaders}
        />

        <Composer
          ref={composerRef}
          channelId={channel.id}
          channelType={channel.type}
          mentionable={mentionable}
          meId={meId}
          users={users}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
        />

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-(--chat-accent) bg-(--chat-accent-soft)/90 text-(--chat-accent-strong)">
            <Upload className="h-8 w-8" />
            <p className="text-sm font-semibold">วางไฟล์เพื่อส่งในห้องนี้</p>
          </div>
        )}
      </div>

      {infoOpen && (
        <div className="fixed inset-0 z-50 lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:border-l lg:border-(--line)">
          <RoomInfo channel={channel} onClose={() => setInfoOpen(false)} onOpenMedia={onOpenMedia} onLeft={onBack} />
        </div>
      )}

      {lightbox && <Lightbox items={lightbox.items} index={lightbox.index} onClose={() => setLightbox(null)} />}

      {readers && (
        <ChatModal title="ผู้ที่อ่านแล้ว" onClose={() => setReaders(null)}>
          <div className="py-2">
            <p className="px-4 pb-1 pt-2 text-[12px] font-semibold text-(--ink-soft)">อ่านแล้ว {readerList.read.length}</p>
            {readerList.read.map((id) => (
              <div key={id} className="flex items-center gap-3 px-4 py-1.5">
                <ChatAvatar name={users[id]?.name ?? "?"} src={users[id]?.avatarUrl} colorKey={id} className="h-8 w-8" />
                <span className="text-sm text-(--ink)">{users[id]?.name ?? "สมาชิก"}</span>
              </div>
            ))}
            {readerList.unread.length > 0 && channel.type !== "org" && (
              <>
                <p className="px-4 pb-1 pt-3 text-[12px] font-semibold text-(--ink-soft)">ยังไม่อ่าน {readerList.unread.length}</p>
                {readerList.unread.map((id) => (
                  <div key={id} className="flex items-center gap-3 px-4 py-1.5 opacity-60">
                    <ChatAvatar name={users[id]?.name ?? "?"} src={users[id]?.avatarUrl} colorKey={id} className="h-8 w-8" />
                    <span className="text-sm text-(--ink)">{users[id]?.name ?? "สมาชิก"}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </ChatModal>
      )}
    </div>
  );
}
