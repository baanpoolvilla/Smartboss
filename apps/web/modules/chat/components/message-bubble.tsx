"use client";

import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Clock, Copy, CornerUpLeft, Download, FileText, Megaphone, MoreHorizontal, Pause, Play, RotateCw, SmilePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import type { RoomMessage } from "../store/chat-store";
import { CHAT_REACTION_EMOJIS, type ChatAttachment, type ChatUser } from "../types";
import { attachmentLabel, firstName, formatClock, formatDuration, formatFileSize } from "../lib/format";
import { ChatAvatar } from "./chat-avatar";
import { downloadUrl } from "./lightbox";
import { MessageText } from "./message-text";

// ─── ไฟล์แนบ ───────────────────────────────────────────────────────────────

/** รูปที่โหลดพลาด (เน็ตสะดุด) ลองใหม่เองสูงสุด 2 ครั้ง ไม่ปล่อยให้เป็นรูปแตกค้าง */
function RetryImage({ src, alt, className, style }: { src: string; alt: string; className?: string; style?: React.CSSProperties }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const url = attempt === 0 ? src : `${src}${src.includes("?") ? "&" : "?"}r=${attempt}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (attempt < 2) setTimeout(() => setAttempt((a) => a + 1), 1500 * (attempt + 1));
      }}
      className={cn("transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0", className)}
      style={style}
    />
  );
}

function MediaGrid({ items, onOpen }: { items: ChatAttachment[]; onOpen: (index: number) => void }) {
  if (items.length === 1) {
    const a = items[0]!;
    const ratio = a.width && a.height ? a.width / a.height : 4 / 3;
    // จองพื้นที่ตามสัดส่วนจริงก่อนรูปโหลด — ข้อความไม่กระโดดตอนรูปมา
    const w = Math.min(260, ratio >= 1 ? 260 : 260 * Math.max(ratio, 0.6));
    const h = Math.min(320, w / ratio);
    return (
      <button
        type="button"
        onClick={() => onOpen(0)}
        className="relative block overflow-hidden rounded-2xl bg-black/5"
        style={{ width: w, height: h, maxWidth: "100%" }}
        aria-label={a.kind === "video" ? "เปิดวิดีโอ" : "ดูรูปเต็ม"}
      >
        {a.kind === "video" ? (
          <>
            <video src={`${a.url}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white">
                <Play className="h-5 w-5 translate-x-px" fill="currentColor" />
              </span>
            </span>
          </>
        ) : (
          <RetryImage src={a.thumbUrl ?? a.url} alt={a.name} className="h-full w-full object-cover" />
        )}
      </button>
    );
  }

  const shown = items.slice(0, 4);
  const extra = items.length - shown.length;
  return (
    <div className="grid w-[260px] max-w-full grid-cols-2 gap-0.5 overflow-hidden rounded-2xl">
      {shown.map((a, i) => (
        <button
          key={a.url}
          type="button"
          onClick={() => onOpen(i)}
          className={cn("relative aspect-square bg-black/5", shown.length === 3 && i === 0 && "col-span-2 aspect-[2/1]")}
          aria-label="ดูรูปเต็ม"
        >
          {a.kind === "video" ? (
            <>
              <video src={`${a.url}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
              <Play className="absolute inset-0 m-auto h-6 w-6 text-white drop-shadow" fill="currentColor" />
            </>
          ) : (
            <RetryImage src={a.thumbUrl ?? a.url} alt={a.name} className="h-full w-full object-cover" />
          )}
          {i === 3 && extra > 0 && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-lg font-semibold text-white">+{extra}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function VoicePlayer({ a, mine }: { a: ChatAttachment; mine: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState((a.durationMs ?? 0) / 1000);

  return (
    <div
      className={cn(
        "flex w-56 max-w-full items-center gap-2.5 rounded-2xl px-3 py-2",
        mine ? "bg-(--chat-bubble-me) text-(--chat-bubble-me-ink)" : "bg-(--chat-bubble-other) text-(--ink)"
      )}
    >
      <button
        type="button"
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          if (el.paused) void el.play();
          else el.pause();
        }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--chat-accent) text-white"
        aria-label={playing ? "หยุด" : "เล่นข้อความเสียง"}
      >
        {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4 translate-x-px" fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
          <div className="h-full rounded-full bg-(--chat-accent)" style={{ width: `${dur > 0 ? Math.min(100, (pos / dur) * 100) : 0}%` }} />
        </div>
        <span className="mt-1 block text-[11px] tabular-nums opacity-70">{formatDuration((playing || pos > 0 ? pos : dur) * 1000)}</span>
      </div>
      <audio
        ref={ref}
        src={a.url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
        }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
        }}
      />
    </div>
  );
}

const FILE_COLORS: Record<string, string> = {
  pdf: "#e5484d",
  doc: "#2b6cd9",
  docx: "#2b6cd9",
  xls: "#1f9d55",
  xlsx: "#1f9d55",
  csv: "#1f9d55",
  ppt: "#e5793c",
  pptx: "#e5793c",
  zip: "#7c6bd6",
  txt: "#64748b",
};

function FileCard({ a }: { a: ChatAttachment }) {
  const ext = a.name.split(".").pop()?.toLowerCase() ?? "";
  const color = FILE_COLORS[ext] ?? "#64748b";
  return (
    <div className="flex w-64 max-w-full items-center gap-1 rounded-2xl border border-(--line) bg-(--bg) py-1.5 pl-1.5 pr-2 hover:bg-(--bg-soft)">
      <a
        href={a.url}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1.5 py-1"
        title="เปิดไฟล์"
      >
        <span className="flex h-10 w-9 shrink-0 flex-col items-center justify-center rounded-md text-white" style={{ backgroundColor: color }}>
          <FileText className="h-4 w-4" />
          <span className="text-[8px] font-bold uppercase leading-none">{ext.slice(0, 4)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-(--ink)">{a.name}</span>
          <span className="text-[11px] text-(--ink-soft)">{formatFileSize(a.size)}</span>
        </span>
      </a>
      <a
        href={downloadUrl(a)}
        onClick={(e) => e.stopPropagation()}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-(--ink-soft) hover:bg-(--bg-soft)"
        aria-label="ดาวน์โหลด"
        title="ดาวน์โหลด"
      >
        <Download className="h-4 w-4" />
      </a>
    </div>
  );
}

// ─── เมนูของข้อความ ─────────────────────────────────────────────────────────

function ActionMenu({
  message,
  mine,
  anchor,
  canManage,
  canPin,
  onClose,
  onReact,
  onReply,
  onUnsend,
  onPin,
}: {
  message: RoomMessage;
  mine: boolean;
  /** ตำแหน่งฟองข้อความ — เมนูบนคอมวางใต้ฟอง (มือถือเป็นแผ่นล่างจอ) */
  anchor: DOMRect | null;
  canManage: boolean;
  canPin: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onUnsend: () => void;
  onPin: () => void;
}) {
  const [confirmUnsend, setConfirmUnsend] = useState(false);
  const item = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-(--ink) hover:bg-(--bg-soft)";
  const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
  // คอม: วางใต้ฟอง ถ้าที่ข้างล่างไม่พอก็วางเหนือฟองแทน
  const style: React.CSSProperties | undefined =
    desktop && anchor
      ? {
          position: "fixed",
          ...(window.innerHeight - anchor.bottom > 320 ? { top: anchor.bottom + 4 } : { bottom: window.innerHeight - anchor.top + 4 }),
          ...(mine ? { right: Math.max(8, window.innerWidth - anchor.right) } : { left: Math.max(8, anchor.left) }),
        }
      : undefined;
  return createPortal(
    <div className="chat-ui">
      <div className="fixed inset-0 z-[60] bg-black/25 sm:bg-transparent" onClick={onClose} />
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-[61] rounded-t-2xl bg-(--bg) p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl",
          "sm:inset-x-auto sm:bottom-auto sm:w-64 sm:rounded-xl sm:border sm:border-(--line) sm:p-1.5"
        )}
        style={style}
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex justify-between gap-1 border-b border-(--line) px-1 pb-2">
          {CHAT_REACTION_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onReact(e);
                onClose();
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-xl transition-transform hover:scale-125 hover:bg-(--bg-soft) sm:h-7 sm:w-7 sm:text-base"
              aria-label={`กด ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
        <button type="button" className={item} onClick={() => { onReply(); onClose(); }}>
          <CornerUpLeft className="h-4 w-4 text-(--ink-soft)" /> ตอบกลับ
        </button>
        {message.body && (
          <button
            type="button"
            className={item}
            onClick={() => {
              navigator.clipboard?.writeText(message.body ?? "").then(
                () => toast.success("คัดลอกแล้ว"),
                () => toast.error("คัดลอกไม่สำเร็จ")
              );
              onClose();
            }}
          >
            <Copy className="h-4 w-4 text-(--ink-soft)" /> คัดลอก
          </button>
        )}
        {canPin && (
          <button type="button" className={item} onClick={() => { onPin(); onClose(); }}>
            <Megaphone className="h-4 w-4 text-(--ink-soft)" /> ปักเป็นประกาศ
          </button>
        )}
        {(mine || canManage) &&
          (confirmUnsend ? (
            <button type="button" className={cn(item, "font-medium text-(--danger)")} onClick={() => { onUnsend(); onClose(); }}>
              <Trash2 className="h-4 w-4" /> กดอีกครั้งเพื่อยืนยันยกเลิกข้อความ
            </button>
          ) : (
            <button type="button" className={cn(item, "text-(--danger)")} onClick={() => setConfirmUnsend(true)}>
              <Trash2 className="h-4 w-4" /> {mine ? "ยกเลิกข้อความ" : "ลบข้อความนี้ (แอดมิน)"}
            </button>
          ))}
        <button type="button" className={cn(item, "justify-center sm:hidden")} onClick={onClose}>
          <X className="h-4 w-4 text-(--ink-soft)" /> ปิด
        </button>
      </div>
    </div>,
    document.body
  );
}

// ─── ฟองข้อความ ─────────────────────────────────────────────────────────────

export interface MessageBubbleProps {
  message: RoomMessage;
  meId: string;
  users: Record<string, ChatUser>;
  /** ข้อความแรกของชุดที่คนเดียวกันส่งติดกัน — แสดงชื่อ+รูป */
  firstInGroup: boolean;
  /** "อ่านแล้ว" / "อ่านแล้ว 3" ใต้ข้อความของเรา (null = ยังไม่มีใครอ่าน) */
  readLabel: string | null;
  canManage: boolean;
  canPin: boolean;
  highlighted: boolean;
  onReply: (m: RoomMessage) => void;
  onReact: (m: RoomMessage, emoji: string) => void;
  onUnsend: (m: RoomMessage) => void;
  onPin: (m: RoomMessage) => void;
  onOpenMedia: (items: ChatAttachment[], index: number) => void;
  onJump: (messageId: string) => void;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
  onShowReaders: (m: RoomMessage) => void;
}

export const MessageBubble = memo(function MessageBubble(props: MessageBubbleProps) {
  const { message: m, meId, users, firstInGroup, readLabel, highlighted } = props;
  const [menuOpen, setMenuOpenState] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const setMenuOpen = (open: boolean) => {
    if (open) setAnchor(bubbleRef.current?.getBoundingClientRect() ?? null);
    setMenuOpenState(open);
  };
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const mine = m.authorId === meId;
  const author = users[m.authorId];

  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  if (m.kind === "system") {
    return (
      <div className="chat-row flex justify-center px-4 py-1">
        <span className="max-w-[85%] rounded-full bg-black/8 px-3 py-1 text-center text-[11.5px] text-(--ink-soft)">{m.body}</span>
      </div>
    );
  }

  if (m.deleted) {
    return (
      <div className="chat-row flex justify-center px-4 py-1">
        <span className="text-[11.5px] text-(--chat-meta)">{mine ? "คุณ" : firstName(author?.name) || "สมาชิก"} ยกเลิกข้อความ</span>
      </div>
    );
  }

  const media = m.attachments.filter((a) => a.kind === "image" || a.kind === "video");
  const audios = m.attachments.filter((a) => a.kind === "audio");
  const files = m.attachments.filter((a) => a.kind === "file");
  const local = Boolean(m.status);
  const clientId = m.clientId ?? "";

  const startPress = () => {
    if (local) return;
    pressTimer.current = setTimeout(() => {
      navigator.vibrate?.(15);
      setMenuOpen(true);
    }, 450);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const meta = (
    <div className={cn("flex shrink-0 flex-col justify-end pb-0.5 text-[10.5px] leading-tight text-(--chat-meta)", mine ? "items-end" : "items-start")}>
      {m.status === "sending" && <Clock className="mb-0.5 h-3 w-3" aria-label="กำลังส่ง" />}
      {!local && readLabel && (
        <button type="button" onClick={() => props.onShowReaders(m)} className="hover:underline">
          {readLabel}
        </button>
      )}
      {!local && <span>{formatClock(m.createdAt)}</span>}
    </div>
  );

  return (
    <div
      ref={rowRef}
      className={cn("chat-row group flex gap-2 px-3", firstInGroup ? "pt-2.5" : "pt-0.5", mine && "flex-row-reverse", highlighted && "chat-flash")}
    >
      {!mine && (
        <div className="w-9 shrink-0">
          {firstInGroup && <ChatAvatar name={author?.name ?? "?"} src={author?.avatarUrl} colorKey={m.authorId} className="h-9 w-9" />}
        </div>
      )}

      <div className={cn("flex min-w-0 max-w-[78%] flex-col sm:max-w-[65%]", mine && "items-end")}>
        {!mine && firstInGroup && <span className="mb-0.5 px-1 text-[11.5px] text-(--ink-soft)">{author?.name ?? "สมาชิก"}</span>}

        <div className={cn("flex items-end gap-1.5", mine && "flex-row-reverse")}>
          <div
            ref={bubbleRef}
            className="relative flex min-w-0 flex-col gap-1"
            onContextMenu={(e) => {
              if (local) return;
              e.preventDefault();
              setMenuOpen(true);
            }}
            onTouchStart={startPress}
            onTouchEnd={cancelPress}
            onTouchMove={cancelPress}
          >
            {(m.body || m.replyTo) && (
              <div
                className={cn(
                  "min-w-0 rounded-2xl px-3 py-2 text-[length:var(--chat-text-size,14.5px)] leading-relaxed shadow-[0_1px_1px_rgba(0,0,0,0.06)]",
                  mine ? "rounded-tr-md bg-(--chat-bubble-me) text-(--chat-bubble-me-ink)" : "rounded-tl-md bg-(--chat-bubble-other) text-(--ink)",
                  !firstInGroup && (mine ? "rounded-tr-2xl" : "rounded-tl-2xl")
                )}
              >
                {m.replyTo && (
                  <button
                    type="button"
                    onClick={() => m.replyTo && !m.replyTo.deleted && props.onJump(m.replyTo.id)}
                    className="mb-1.5 block w-full rounded-lg border-l-[3px] border-(--chat-accent) bg-black/5 px-2 py-1 text-left text-[12px]"
                  >
                    <span className="block font-semibold text-(--chat-accent-strong)">
                      {m.replyTo.authorId === meId ? "คุณ" : (users[m.replyTo.authorId]?.name ?? "สมาชิก")}
                    </span>
                    <span className="line-clamp-2 opacity-75">
                      {m.replyTo.deleted ? "ข้อความถูกยกเลิกแล้ว" : m.replyTo.body || attachmentLabel(m.replyTo.attachmentKind)}
                    </span>
                  </button>
                )}
                {m.body && (
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    <MessageText body={m.body} mentions={m.mentions} users={users} meId={meId} />
                  </p>
                )}
              </div>
            )}
            {media.length > 0 && <MediaGrid items={media} onOpen={(i) => props.onOpenMedia(media, i)} />}
            {audios.map((a) => (
              <VoicePlayer key={a.url} a={a} mine={mine} />
            ))}
            {files.map((a) => (
              <FileCard key={a.url} a={a} />
            ))}

            {menuOpen && (
              <ActionMenu
                message={m}
                mine={mine}
                anchor={anchor}
                canManage={props.canManage}
                canPin={props.canPin}
                onClose={() => setMenuOpen(false)}
                onReact={(e) => props.onReact(m, e)}
                onReply={() => props.onReply(m)}
                onUnsend={() => props.onUnsend(m)}
                onPin={() => props.onPin(m)}
              />
            )}
          </div>

          {meta}

          {/* ปุ่มลัดตอนชี้เมาส์ (คอม) — มือถือใช้กดค้างแทน */}
          {!local && (
            <div className="mb-1 hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
              <button type="button" onClick={() => props.onReply(m)} className="flex h-7 w-7 items-center justify-center rounded-full text-(--ink-soft) hover:bg-black/5" aria-label="ตอบกลับ" title="ตอบกลับ">
                <CornerUpLeft className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setMenuOpen(true)} className="flex h-7 w-7 items-center justify-center rounded-full text-(--ink-soft) hover:bg-black/5" aria-label="กดอีโมจิ" title="กดอีโมจิ">
                <SmilePlus className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setMenuOpen(true)} className="flex h-7 w-7 items-center justify-center rounded-full text-(--ink-soft) hover:bg-black/5" aria-label="เพิ่มเติม" title="เพิ่มเติม">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {m.reactions.length > 0 && (
          <div className={cn("mt-1 flex flex-wrap gap-1", mine && "justify-end")}>
            {m.reactions.map((r) => {
              const mineReact = r.userIds.includes(meId);
              const names = r.userIds.map((id) => (id === meId ? "คุณ" : (users[id]?.name ?? "สมาชิก"))).join(", ");
              return (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => props.onReact(m, r.emoji)}
                  title={names}
                  className={cn(
                    "flex h-6 items-center gap-1 rounded-full border px-2 text-[12px] shadow-sm transition-colors",
                    mineReact ? "border-(--chat-accent) bg-(--chat-accent-soft) text-(--chat-accent-strong)" : "border-(--line) bg-(--bg) text-(--ink-soft)"
                  )}
                >
                  <span>{r.emoji}</span>
                  <span className="tabular-nums">{r.userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}

        {m.status === "failed" && (
          <div className="mt-1 flex items-center gap-2 text-[11.5px] text-(--danger)">
            <AlertCircle className="h-3.5 w-3.5" /> ส่งไม่สำเร็จ
            <button type="button" onClick={() => props.onRetry(clientId)} className="flex items-center gap-1 font-medium underline-offset-2 hover:underline">
              <RotateCw className="h-3 w-3" /> ส่งใหม่
            </button>
            <button type="button" onClick={() => props.onDiscard(clientId)} className="text-(--ink-soft) hover:underline">
              ลบทิ้ง
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
