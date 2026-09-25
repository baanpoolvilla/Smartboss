"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";

import { useChatStore, type RoomMessage } from "../store/chat-store";
import type { ChatAttachment } from "../types";
import { backToLatest, discardFailed, jumpToMessage, loadOlder, reactToMessage, retrySend, unsendMessage } from "../lib/chat-actions";
import { formatDayLabel, sameDay } from "../lib/format";
import { updateChannel } from "../lib/api";
import { MessageBubble } from "./message-bubble";
import { toast } from "sonner";

const GROUP_GAP_MS = 5 * 60 * 1000;
const EMPTY: RoomMessage[] = [];
const NEAR_BOTTOM_PX = 120;

/** นับจำนวน seq ที่ ≥ target ในอาร์เรย์ที่เรียงแล้ว (binary search) */
function countAtLeast(sorted: bigint[], target: bigint): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return sorted.length - lo;
}

export function MessageList({
  channelId,
  channelType,
  canManage,
  initialUnread,
  onReply,
  onOpenMedia,
  onShowReaders,
}: {
  channelId: string;
  channelType: string;
  canManage: boolean;
  /** จำนวนที่ยังไม่อ่านตอนเปิดห้อง — ใช้วางเส้น "ยังไม่ได้อ่าน" และเลื่อนไปตรงนั้น */
  initialUnread: number;
  onReply: (m: RoomMessage) => void;
  onOpenMedia: (items: ChatAttachment[], index: number) => void;
  onShowReaders: (m: RoomMessage) => void;
}) {
  const room = useChatStore((s) => s.rooms[channelId]);
  const detail = useChatStore((s) => s.details[channelId]);
  const users = useChatStore((s) => s.users);
  const meId = useChatStore((s) => s.meId);
  const highlight = useChatStore((s) => s.highlight);
  const typing = useChatStore((s) => s.typing[channelId]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const prevRef = useRef<{ first?: string; last?: string; height: number; top: number }>({ height: 0, top: 0 });
  const initialScrollDone = useRef(false);
  const [newCount, setNewCount] = useState(0);
  const [showJump, setShowJump] = useState(false);

  const items = room?.items ?? EMPTY;
  const roomLoaded = room !== undefined;

  // เส้น "ยังไม่ได้อ่าน" — วางไว้ก่อนข้อความของคนอื่นที่ยังไม่อ่านอันแรก (คำนวณครั้งเดียวตอนเปิดห้อง)
  const unreadMarkerId = useMemo(() => {
    if (initialUnread <= 0) return null;
    let remaining = initialUnread;
    for (let i = items.length - 1; i >= 0; i--) {
      const m = items[i]!;
      if (m.authorId !== meId && m.kind === "text" && !m.deleted) {
        remaining--;
        if (remaining === 0) return m.id;
      }
    }
    return items.find((m) => m.seq)?.id ?? null;
    // คำนวณครั้งเดียวตอนห้องโหลดเสร็จ — ข้อความที่เข้ามาทีหลังไม่ควรย้ายเส้นนี้
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, initialUnread, roomLoaded]);

  // "อ่านแล้ว N" — seq ที่คนอื่นอ่านถึง เรียงไว้ให้นับเร็ว
  const readSorted = useMemo(() => {
    const seqs = Object.entries(detail?.readSeqs ?? {})
      .filter(([userId]) => userId !== meId)
      .map(([, seq]) => BigInt(seq));
    return seqs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }, [detail?.readSeqs, meId]);

  const readLabelFor = useCallback(
    (m: RoomMessage): string | null => {
      if (m.authorId !== meId || !m.seq || channelType === "org") return null;
      const n = countAtLeast(readSorted, BigInt(m.seq));
      if (n === 0) return null;
      return channelType === "dm" ? "อ่านแล้ว" : `อ่านแล้ว ${n}`;
    },
    [meId, readSorted, channelType]
  );

  // โหลดข้อความเก่าเมื่อเลื่อนขึ้นถึงบนสุด
  useEffect(() => {
    const el = topRef.current;
    const root = scrollRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && initialScrollDone.current) void loadOlder(channelId);
      },
      { root, rootMargin: "400px 0px 0px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [channelId]);

  // จัดตำแหน่งเลื่อนหลังข้อความเปลี่ยน — ก่อนจอวาด (useLayoutEffect) จะได้ไม่กระตุก
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || items.length === 0) return;
    const first = items[0]?.id;
    const last = items[items.length - 1]?.id;
    const prev = prevRef.current;

    if (!initialScrollDone.current) {
      const marker = unreadMarkerId ? el.querySelector<HTMLElement>(`[data-unread-marker]`) : null;
      if (marker) el.scrollTop = Math.max(0, marker.offsetTop - 60);
      else el.scrollTop = el.scrollHeight;
      initialScrollDone.current = true;
    } else if (prev.first && first !== prev.first && last === prev.last) {
      // เติมข้อความเก่าด้านบน — คงตำแหน่งที่กำลังอ่านไว้ ไม่ให้จอกระโดด
      el.scrollTop = prev.top + (el.scrollHeight - prev.height);
    } else if (last !== prev.last) {
      const lastMsg = items[items.length - 1]!;
      if (atBottomRef.current || lastMsg.authorId === meId) {
        el.scrollTo({ top: el.scrollHeight, behavior: prev.last ? "smooth" : "auto" });
        setNewCount(0);
      } else if (lastMsg.authorId !== meId && lastMsg.kind === "text") {
        // ตัวเลข "ข้อความใหม่" ขึ้นกับตำแหน่งเลื่อนจริงบนจอ (วัดได้หลังวาดเท่านั้น) จึงต้องตั้งในนี้
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setNewCount((n) => n + 1);
      }
    }
    prevRef.current = { first, last, height: el.scrollHeight, top: el.scrollTop };
  }, [items, meId, unreadMarkerId]);

  // พิมพ์โต้ตอบหรือรูปโหลดเสร็จแล้วสูงขึ้น — ถ้าอยู่ล่างสุดอยู่แล้วให้ติดล่างต่อ
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    const inner = el.firstElementChild;
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [channelId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = distance < NEAR_BOTTOM_PX;
    if (atBottomRef.current) setNewCount(0);
    setShowJump(distance > 600);
    prevRef.current = { ...prevRef.current, height: el.scrollHeight, top: el.scrollTop };
  };

  const scrollToBottom = () => {
    if (room?.detached) {
      void backToLatest(channelId).then(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
      return;
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    setNewCount(0);
  };

  const onReact = useCallback((m: RoomMessage, emoji: string) => void reactToMessage(channelId, m.id, emoji), [channelId]);
  const onUnsend = useCallback((m: RoomMessage) => void unsendMessage(channelId, m.id), [channelId]);
  const onPin = useCallback(
    (m: RoomMessage) =>
      void updateChannel(channelId, { announcementId: m.id }).then(
        () => toast.success("ปักเป็นประกาศแล้ว"),
        (err) => toast.error(err instanceof Error ? err.message : "ปักประกาศไม่สำเร็จ")
      ),
    [channelId]
  );
  const onJump = useCallback((id: string) => void jumpToMessage(channelId, id), [channelId]);
  const onRetry = useCallback((clientId: string) => retrySend(clientId), []);
  const onDiscard = useCallback((clientId: string) => discardFailed(channelId, clientId), [channelId]);

  const typingNames = Object.keys(typing ?? {})
    .map((id) => users[id]?.name?.split(" ")[0])
    .filter(Boolean);

  if (!room) {
    return (
      <div className="chat-room-surface flex flex-1 items-center justify-center bg-(--chat-room-bg)">
        <Loader2 className="h-6 w-6 animate-spin text-(--chat-meta)" />
      </div>
    );
  }

  const canPin = channelType === "dm" || canManage;

  return (
    <div className="chat-room-surface relative min-h-0 flex-1 bg-(--chat-room-bg)">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain" style={{ overflowAnchor: "none" }}>
        <div className="pb-3">
          <div ref={topRef} className="h-1" />
          {room.hasMore ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-(--chat-meta)" />
            </div>
          ) : (
            <p className="py-4 text-center text-[11.5px] text-(--chat-meta)">— เริ่มต้นการสนทนา —</p>
          )}

          {items.map((m, i) => {
            const prev = items[i - 1];
            const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
            const firstInGroup =
              newDay ||
              !prev ||
              prev.authorId !== m.authorId ||
              prev.kind !== "text" ||
              prev.deleted ||
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS ||
              m.id === unreadMarkerId;
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <div className="flex justify-center py-2">
                    <span className="rounded-full bg-black/10 px-3 py-0.5 text-[11px] font-medium text-(--ink-soft)">{formatDayLabel(m.createdAt)}</span>
                  </div>
                )}
                {m.id === unreadMarkerId && (
                  <div data-unread-marker className="my-2 flex items-center gap-2 px-4">
                    <span className="h-px flex-1 bg-(--chat-accent)/40" />
                    <span className="text-[11px] font-medium text-(--chat-accent-strong)">ยังไม่ได้อ่าน</span>
                    <span className="h-px flex-1 bg-(--chat-accent)/40" />
                  </div>
                )}
                <div className={i >= items.length - 3 ? "chat-enter" : undefined}>
                  <MessageBubble
                    message={m}
                    meId={meId}
                    users={users}
                    firstInGroup={firstInGroup}
                    readLabel={readLabelFor(m)}
                    canManage={canManage}
                    canPin={canPin}
                    highlighted={highlight?.channelId === channelId && highlight.messageId === m.id}
                    onReply={onReply}
                    onReact={onReact}
                    onUnsend={onUnsend}
                    onPin={onPin}
                    onOpenMedia={onOpenMedia}
                    onJump={onJump}
                    onRetry={onRetry}
                    onDiscard={onDiscard}
                    onShowReaders={onShowReaders}
                  />
                </div>
              </Fragment>
            );
          })}

          <div className="h-6 px-14 pt-1 text-[12px] text-(--chat-meta)" aria-live="polite">
            {typingNames.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-(--chat-meta) [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-(--chat-meta) [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-(--chat-meta)" />
                </span>
                {typingNames.slice(0, 2).join(", ")}
                {typingNames.length > 2 ? ` และอีก ${typingNames.length - 2} คน` : ""} กำลังพิมพ์…
              </span>
            )}
          </div>
        </div>
      </div>

      {(newCount > 0 || showJump || room.detached) && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-(--bg) px-3.5 py-1.5 text-[12.5px] font-medium text-(--ink) shadow-lg ring-1 ring-black/5 hover:bg-(--bg-soft)"
        >
          <ArrowDown className="h-4 w-4 text-(--chat-accent)" />
          {newCount > 0 ? `ข้อความใหม่ ${newCount}` : "ไปข้อความล่าสุด"}
        </button>
      )}
    </div>
  );
}
