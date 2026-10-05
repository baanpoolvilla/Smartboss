"use client";

import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Clock, Copy, CornerUpLeft, Download, FileText, Hourglass, ImageOff, Megaphone, MicOff, MoreHorizontal, Pause, Play, RotateCw, SmilePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";
import { ReactionPicker } from "@/components/emoji-picker";

import { sortReactionEmojis, useChatStore, type RoomMessage } from "../store/chat-store";
import { CHAT_REACTION_EMOJIS, type ChatAttachment, type ChatUser } from "../types";
import { attachmentLabel, firstName, formatClock, formatDuration, formatFileSize } from "../lib/format";
import { ChatAvatar } from "./chat-avatar";
import { downloadUrl } from "./lightbox";
import { daysUntilExpiry } from "../lib/retention";
import { NoteCard } from "./notes";
import { MessageText } from "./message-text";
import { useBackToClose, useBackToCloseOnTouch } from "@/lib/back-to-close";

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

/** ช่องแทนรูป/วิดีโอที่หมดอายุแล้ว (ไฟล์ถูกลบ) — แบบ LINE */
function ExpiredTile({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span className={cn("flex flex-col items-center justify-center gap-1 bg-black/5 text-(--ink-soft)", className)} style={style}>
      <ImageOff className="h-5 w-5" />
      <span className="text-[11px]">หมดอายุแล้ว</span>
    </span>
  );
}

/** ป้ายเตือนก่อนหมดอายุ — ขึ้นเมื่อเหลือไม่เกิน 7 วัน ให้ทันบันทึกลงอัลบั้ม */
function ExpiryBadge({ items }: { items: ChatAttachment[] }) {
  const at = items.find((a) => a.expiresAt && !a.expired)?.expiresAt;
  if (!at) return null;
  const days = daysUntilExpiry(at);
  if (days > 7) return null;
  return (
    <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] text-white">
      <Hourglass className="h-3 w-3" />
      {days === 0 ? "หมดอายุวันนี้" : `หมดอายุใน ${days} วัน`}
    </span>
  );
}

/**
 * ข้อความที่มีแต่อิโมจิ 1–3 ตัว (ไม่มีตัวอักษรอื่น) — แสดงตัวใหญ่ ไม่มีกรอบข้อความ แบบแอปแชททั่วไป
 * นับเป็น "ตัว" ตามที่ตาเห็น (👨‍👩‍👧 หรือ 👍🏽 = 1 ตัว) เบราว์เซอร์ที่ไม่มี Intl.Segmenter = แสดงแบบปกติ
 */
const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[‍️])+$/u;
function isJumboEmoji(body: string): boolean {
  const text = body.replace(/\s+/g, "");
  if (!text || text.length > 40 || !EMOJI_ONLY_RE.test(text)) return false;
  if (typeof Intl === "undefined" || !("Segmenter" in Intl)) return false;
  let count = 0;
  for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) if (++count > 3) return false;
  return true;
}

function MediaGrid({ items, onOpen }: { items: ChatAttachment[]; onOpen: (index: number) => void }) {
  if (items.length === 1) {
    const a = items[0]!;
    if (a.expired) return <ExpiredTile className="h-28 w-44 rounded-2xl" />;
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
        <ExpiryBadge items={items} />
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
    <div className="relative grid w-[260px] max-w-full grid-cols-2 gap-0.5 overflow-hidden rounded-2xl">
      <ExpiryBadge items={items} />
      {shown.map((a, i) =>
        a.expired ? (
          <ExpiredTile key={`x-${i}`} className={cn("aspect-square", shown.length === 3 && i === 0 && "col-span-2 aspect-[2/1]")} />
        ) : (
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
        )
      )}
    </div>
  );
}

function VoicePlayer({ a, mine }: { a: ChatAttachment; mine: boolean }) {
  if (a.expired) {
    return (
      <span className={cn("flex items-center gap-1.5 rounded-2xl px-3 py-2 text-[13px]", mine ? "bg-(--chat-bubble-me) text-(--chat-bubble-me-ink) opacity-70" : "bg-(--chat-bubble-other) text-(--ink-soft)")}>
        <MicOff className="h-4 w-4" /> ข้อความเสียงหมดอายุแล้ว
      </span>
    );
  }
  return <LiveVoicePlayer a={a} mine={mine} />;
}

function LiveVoicePlayer({ a, mine }: { a: ChatAttachment; mine: boolean }) {
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
  useBackToClose(true, onClose);
  // อีโมจิที่ฉันกดบ่อย/ล่าสุดขึ้นก่อน (นับจากเซิร์ฟเวอร์ — ข้ามเครื่อง/ออกเข้าใหม่ก็จำ)
  const reactionUsage = useChatStore((s) => s.reactionUsage);
  const reactionEmojis = sortReactionEmojis(CHAT_REACTION_EMOJIS, reactionUsage);
  const item = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-(--ink) hover:bg-(--bg-soft)";
  const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
  // คอม: วางใต้ฟอง ถ้าที่ข้างล่างไม่พอก็วางเหนือฟองแทน
  const style: React.CSSProperties | undefined =
    desktop && anchor
      ? {
          position: "fixed",
          ...(window.innerHeight - anchor.bottom > 440 ? { top: anchor.bottom + 4 } : { bottom: window.innerHeight - anchor.top + 4 }),
          ...(mine ? { right: Math.max(8, window.innerWidth - anchor.right) } : { left: Math.max(8, anchor.left) }),
        }
      : undefined;
  return createPortal(
    <div className="chat-ui">
      <div className="fixed inset-0 z-[60] bg-black/25 sm:bg-transparent" onClick={onClose} />
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-[61] rounded-t-2xl bg-(--bg) p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl",
          "sm:inset-x-auto sm:bottom-auto sm:w-[320px] sm:rounded-xl sm:border sm:border-(--line) sm:p-1.5"
        )}
        style={style}
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 border-b border-(--line) px-1 pb-2">
          <ReactionPicker
            quick={reactionEmojis}
            onPick={(e) => {
              onReact(e);
              onClose();
            }}
            className="justify-between gap-0"
            buttonClassName="h-9 w-9 rounded-full sm:h-8 sm:w-8 sm:text-[21px]"
          />
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
          message.kind !== "note" &&
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
  /** คนที่อ่านล่าสุดถึงข้อความนี้ — โชว์เป็นรูปจิ๋วใต้ข้อความ (ไม่ใส่ = ไม่มีใคร) */
  seenBy?: string[];
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

/**
 * ปุ่มอีโมจิใต้ข้อความ + กล่องเล็ก "ใครกดบ้าง"
 * คอม: ชี้ค้าง = เห็นรายชื่อ, คลิก = กด/ยกเลิกอีโมจิของเรา (เหมือนเดิม)
 * มือถือ (ไม่มี hover): แตะ = เปิดรายชื่อ ในกล่องมีปุ่มกด/ยกเลิกของเรา แตะที่อื่นปิด
 */
function ReactionChip({
  emoji,
  userIds,
  meId,
  users,
  alignEnd,
  onToggle,
}: {
  emoji: string;
  userIds: string[];
  meId: string;
  users: Record<string, ChatUser>;
  alignEnd: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  useBackToCloseOnTouch(open, () => setOpen(false)); // มือถือ: ปุ่มย้อนกลับปิดรายชื่อคนกดอิโมจิก่อน
  const lastPointer = useRef<string>("mouse");
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const mineReact = userIds.includes(meId);
  // เราขึ้นก่อน แล้วคนอื่นตามลำดับที่กด
  const people = [...userIds].sort((a, b) => (a === meId ? -1 : b === meId ? 1 : 0));

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  return (
    <div
      ref={boxRef}
      className="relative"
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setOpen(true), 250);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setOpen(false), 120);
      }}
    >
      <button
        type="button"
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType;
        }}
        onClick={() => {
          if (lastPointer.current === "mouse") onToggle();
          else setOpen((v) => !v);
        }}
        aria-label={`${emoji} ${userIds.length} คน — ดูว่าใครกด`}
        aria-expanded={open}
        className={cn(
          // ป้ายเล็กลอยเกาะมุมบับเบิล แบบ LINE/Messenger — ไม่มีกรอบแข็ง ใช้เงานุ่ม ๆ แทน
          "flex h-8 items-center gap-1 rounded-full px-2 text-[13px] font-semibold shadow-[0_1px_4px_rgba(0,0,0,0.15)] ring-2 ring-(--bg) transition-transform active:scale-95",
          mineReact ? "bg-(--chat-accent-soft) text-(--chat-accent-strong)" : "bg-(--bg) text-(--ink-soft)"
        )}
      >
        <span className="text-[20px] leading-none">{emoji}</span>
        {userIds.length > 1 && <span className="tabular-nums">{userIds.length}</span>}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`คนที่กด ${emoji}`}
          className={cn(
            "absolute bottom-full z-30 mb-1.5 w-max min-w-36 max-w-56 rounded-xl border border-(--line) bg-(--bg) py-1.5 shadow-lg",
            alignEnd ? "right-0" : "left-0"
          )}
        >
          <p className="px-3 pb-1 text-[11px] text-(--ink-soft)">
            <span className="text-sm">{emoji}</span> · {userIds.length} คน
          </p>
          <ul className="max-h-48 overflow-y-auto">
            {people.map((id) => {
              const u = users[id];
              const name = id === meId ? "คุณ" : (u?.name ?? "สมาชิก");
              return (
                <li key={id} className="flex items-center gap-2 px-3 py-1">
                  <ChatAvatar name={u?.name ?? name} src={u?.avatarUrl} colorKey={id} className="h-5 w-5 text-[9px]" />
                  <span className="truncate text-[12.5px] text-(--ink)">{name}</span>
                </li>
              );
            })}
          </ul>
          {lastPointer.current !== "mouse" && (
            <button
              type="button"
              onClick={() => {
                onToggle();
                setOpen(false);
              }}
              className="mx-1.5 mt-1 w-[calc(100%-0.75rem)] rounded-lg px-2 py-1.5 text-left text-[12px] text-(--chat-accent-strong) hover:bg-(--bg-soft)"
            >
              {mineReact ? `ยกเลิก ${emoji} ของฉัน` : `กด ${emoji} ด้วย`}
            </button>
          )}
        </div>
      )}
    </div>
  );
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

        {/* min-w-0 max-w-full: ไม่งั้นแถวนี้ยืดตามข้อความยาวติดกันไม่มีเว้นวรรค (ttttt…)
            จนกรอบข้อความล้นออกนอกจอ ทั้งที่คอลัมน์ข้างนอกจำกัดไว้ 65–78% */}
        <div className={cn("flex min-w-0 max-w-full items-end gap-1.5", mine && "flex-row-reverse")}>
          <div
            ref={bubbleRef}
            // ของตัวเอง = ทุกชิ้นชิดขวา — ไม่ใส่แล้วรูปที่แคบกว่ากรอบข้อความข้างบนไปเกาะขอบซ้ายของกรอบ
            // ดูเหมือนรูปลอยไม่ติดขอบ (ข้อความ + รูปในข้อความเดียวกัน)
            className={cn("relative flex min-w-0 flex-col gap-1", mine && "items-end")}
            onContextMenu={(e) => {
              if (local) return;
              e.preventDefault();
              setMenuOpen(true);
            }}
            onTouchStart={startPress}
            onTouchEnd={cancelPress}
            onTouchMove={cancelPress}
          >
            {m.kind === "note" ? (
              <NoteCard message={m} mine={mine} />
            ) : m.body && !m.replyTo && isJumboEmoji(m.body) ? (
              <p className="px-1 text-[44px] leading-tight">{m.body.trim()}</p>
            ) : (m.body || m.replyTo) && (
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
                  <p
                    // anywhere อย่างเดียว — ใส่ break-words ซ้อนแล้วตัวนั้นชนะ ตัดสตริงยาวไม่มีเว้นวรรคไม่ได้
                    className="whitespace-pre-wrap [overflow-wrap:anywhere]"
                  >
                    <MessageText body={m.body} mentions={m.mentions} users={users} meId={meId} />
                  </p>
                )}
              </div>
            )}
            {media.length > 0 && (
              <MediaGrid
                items={media}
                onOpen={(i) => {
                  // หน้าดูรูปเต็มจอได้เฉพาะรูปที่ยังไม่หมดอายุ + id ข้อความไว้ "บันทึกลงอัลบั้ม"
                  const live = media.filter((a) => !a.expired).map((a) => ({ ...a, messageId: m.id }));
                  const idx = live.findIndex((a) => a.url === media[i]?.url);
                  if (idx >= 0) props.onOpenMedia(live, idx);
                }}
              />
            )}
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
          <div className={cn("relative z-10 -mt-2 flex flex-wrap gap-1.5", mine ? "justify-end pr-2" : "pl-2")}>
            {m.reactions.map((r) => (
              <ReactionChip
                key={r.emoji}
                emoji={r.emoji}
                userIds={r.userIds}
                meId={meId}
                users={users}
                alignEnd={mine}
                onToggle={() => props.onReact(m, r.emoji)}
              />
            ))}
          </div>
        )}

        {props.seenBy && props.seenBy.length > 0 && (
          <button
            type="button"
            onClick={() => props.onShowReaders(m)}
            title={`อ่านถึงตรงนี้: ${props.seenBy.map((id) => users[id]?.name ?? "สมาชิก").join(", ")}`}
            aria-label={`อ่านถึงตรงนี้ ${props.seenBy.length} คน`}
            className={cn("mt-1 flex items-center", mine ? "self-end" : "self-start")}
          >
            <span className="flex -space-x-1">
              {props.seenBy.slice(0, 5).map((id) => (
                <ChatAvatar
                  key={id}
                  name={users[id]?.name ?? "?"}
                  src={users[id]?.avatarUrl}
                  colorKey={id}
                  className="h-4 w-4 text-[7px] ring-[1.5px] ring-white"
                />
              ))}
            </span>
            {props.seenBy.length > 5 && <span className="ml-1 text-[10px] text-(--chat-meta)">+{props.seenBy.length - 5}</span>}
          </button>
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
