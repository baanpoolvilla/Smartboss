import { useState } from "react";
import { Check, CornerUpLeft, Link2, MoreHorizontal, Pencil, Reply as ReplyIcon, SmilePlus, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { Button } from "@/modules/report_task/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { getUser } from "@/modules/report_task/lib/directory";
import type { ReportPostImage, ReportPostReply } from "@/modules/report_task/store/report-feed-store";
import { renderRichBulletText } from "@/modules/report_task/lib/report-feed-rich-text";
import { cn } from "@/modules/report_task/lib/utils";
import { TimeAgo } from "@/modules/report_task/components/shared/time-ago";
import { ReportMediaThumb } from "@/modules/report_task/components/report-feed/report-media-thumb";

const reactionEmojis = ["👍", "❤️", "🎉", "😂", "😮", "😢"];

/** Trims a quoted reply's body down to one short line for the reference shown above a reply that answers it. */
function quotePreview(body: string): string {
  const firstLine = body.split("\n")[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

/** One reply row inside a report card. Used to be fully transparent (no
 * background at all, just spacing between rows) — against the post's own
 * plain white/zebra surface that left a comment thread reading as a run-on
 * paragraph of names with no visual unit of its own ("คอมเม้นต์ยังไม่สวย").
 * Each reply now sits in its own soft bubble — own replies tinted with the
 * brand accent (mirrors the composer's own accent border), everyone else's
 * a neutral gray — the same "your bubble vs. their bubble" convention every
 * chat app uses, so a thread reads as a conversation rather than a list. */
export function ReportReply({
  reply,
  allReplies,
  postQuote,
  flashed,
  isOwn,
  onOpenLightbox,
  onReplyTo,
  onJumpToQuote,
  onCopyLink,
  onToggleReaction,
  onEdit,
  onDelete,
}: {
  reply: ReportPostReply;
  /** Full reply list for this post — used to resolve/show the quoted reply when `reply.replyToId` is set. */
  allReplies: ReportPostReply[];
  /** The post itself, reply-shaped — `reply.replyToId` can also point at the post (quoting the original post, not just another reply). */
  postQuote: { id: string; authorId: string; body: string };
  /** True for a brief moment right after someone jumps here via a quote click — drives the highlight flash. */
  flashed?: boolean;
  /** Only the reply's own author gets edit/delete — same "yours only" gate the post itself already applies. */
  isOwn?: boolean;
  onOpenLightbox: (images: ReportPostImage[], index: number) => void;
  onReplyTo: (reply: ReportPostReply) => void;
  /** Scrolls to and flashes whatever `id` (a reply id, or the post id) this reply is quoting. */
  onJumpToQuote: (id: string) => void;
  /** Copies a deep link to this specific reply (?reply=), same idea as "copy link" on the post but pointed at one comment. */
  onCopyLink: () => void;
  /** Reacting to one specific comment, same as the post's own reaction row — Teams lets you do this per-message, not just per-post. */
  onToggleReaction: (emoji: string) => void;
  onEdit: (body: string) => void;
  onDelete: () => void;
}) {
  const author = getUser(reply.authorId);
  const quoted = reply.replyToId
    ? reply.replyToId === postQuote.id
      ? postQuote
      : allReplies.find((r) => r.id === reply.replyToId)
    : undefined;
  const quotedAuthor = quoted ? getUser(quoted.authorId) : undefined;

  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [touchMenuOpen, setTouchMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(reply.body);
  const activeReactions = reactionEmojis
    .map((emoji) => ({ emoji, users: reply.reactions?.[emoji] ?? [] }))
    .filter((r) => r.users.length > 0);

  function saveEdit() {
    const trimmed = editBody.trim();
    if (!trimmed) return;
    onEdit(trimmed);
    setEditing(false);
  }

  return (
    <div
      id={`report-reply-${reply.id}`}
      className="group/reply flex items-start gap-1.5 sm:gap-2"
    >
      <Avatar className="h-5 w-5 sm:h-6 sm:w-6 shrink-0 mt-0.5">
        <AvatarImage src={author?.avatarUrl ?? undefined} alt={author?.name} />
        <AvatarFallback className="text-[9px] sm:text-[10px] bg-[var(--bg-soft)]">{author?.avatar}</AvatarFallback>
      </Avatar>
      <div
        className={cn(
          // Smaller padding/radius on a narrow phone — the desktop bubble
          // size applied everywhere meant a two-word reply ("test" / "11111")
          // still rendered as a tall, wide card ("ใหญ่มากกินไปแทบครึ่งหน้า").
          "min-w-0 flex-1 rounded-lg sm:rounded-xl px-2 py-1.5 sm:px-2.5 sm:py-2 border transition-colors duration-500",
          flashed
            ? "bg-[var(--accent)] border-[var(--brand-green)]/40"
            : isOwn
              ? "bg-[color-mix(in_srgb,var(--accent)_45%,white)] border-[var(--brand-green)]/15"
              : "bg-[var(--bg-soft)] border-transparent"
        )}
        style={reply.highlightColor ? { borderLeft: `3px solid ${reply.highlightColor}`, paddingLeft: "9px" } : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] sm:text-xs font-medium">
            {author?.name} <span className="font-normal text-[var(--ink-soft)]">· <TimeAgo date={reply.createdAt} /></span>
            {reply.editedAt && <span className="font-normal text-[var(--ink-soft)]"> · แก้ไขแล้ว</span>}
          </p>
          {/* Mouse/hover only now — on touch this row had no
              [@media(hover:none)] fallback at all, so it stayed opacity-0
              *and unreachable* forever, while still reserving its own
              layout width (opacity doesn't remove an element from flow).
              That's what squeezed the name column into wrapping onto two
              lines and reading as oversized ("ใหญ่มากเด่นมาก") — the row
              wasn't actually bigger, the name just had nowhere to go.
              hidden (not opacity-0) on touch removes it from layout
              entirely; the single "⋯" below replaces it there. */}
          <span className="hidden shrink-0 items-center gap-2 opacity-0 transition-opacity [@media(hover:hover)]:flex [@media(hover:hover)]:group-hover/reply:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
            <Popover open={reactionPickerOpen} onOpenChange={setReactionPickerOpen}>
              <PopoverTrigger
                render={
                  <button
                    className="flex items-center gap-1 text-[11px] font-medium text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)]"
                    aria-label={`ทำเครื่องหมายความคิดเห็นของ ${author?.name ?? "ผู้ใช้"}`}
                    title="ทำเครื่องหมาย"
                  >
                    <SmilePlus className="h-3 w-3" />
                  </button>
                }
              />
              {/* flex-row explicitly — PopoverContent's base classes default to
                  flex-col, and twMerge only drops a class when the override
                  names its replacement, so without this the emoji row rendered
                  as an unclickable-looking vertical stack. */}
              <PopoverContent className="w-auto p-1 flex flex-row gap-0.5" align="end">
                {reactionEmojis.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      onToggleReaction(emoji);
                      setReactionPickerOpen(false);
                    }}
                    className={cn(
                      "h-7 w-7 flex items-center justify-center rounded-md text-sm hover:bg-[var(--bg-soft)] transition-transform hover:scale-110",
                      (reply.reactions?.[emoji] ?? []).length > 0 && "bg-[var(--accent)]"
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <button
              onClick={onCopyLink}
              className="flex items-center gap-1 text-[11px] font-medium text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)]"
              aria-label={`คัดลอกลิงก์ความคิดเห็นของ ${author?.name ?? "ผู้ใช้"}`}
              title="คัดลอกลิงก์"
            >
              <Link2 className="h-3 w-3" />
            </button>
            <button
              onClick={() => onReplyTo(reply)}
              className="flex items-center gap-1 text-[11px] font-medium text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)]"
              aria-label={`ตอบกลับ ${author?.name ?? "ความคิดเห็นนี้"}`}
            >
              <ReplyIcon className="h-3 w-3" />
              ตอบกลับ
            </button>
            {isOwn && (
              <>
                <button
                  onClick={() => {
                    setEditBody(reply.body);
                    setEditing(true);
                  }}
                  className="flex items-center gap-1 text-[11px] font-medium text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)]"
                  aria-label="แก้ไขความคิดเห็น"
                  title="แก้ไข"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={onDelete}
                  className="flex items-center gap-1 text-[11px] font-medium text-[var(--ink-soft)] hover:text-[var(--chart-red)]"
                  aria-label="ลบความคิดเห็น"
                  title="ลบ"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
          </span>

          {/* Touch's single quiet "⋯" — same fix as the post-level toolbar
              and Openchat's per-message row already got, and the only thing
              that actually makes reacting/replying/editing a comment
              reachable on a touch device at all (the hover row above has no
              touch fallback on purpose now — see its own comment). */}
          <span className="hidden shrink-0 [@media(hover:none)]:block">
            <Popover open={touchMenuOpen} onOpenChange={setTouchMenuOpen}>
              <PopoverTrigger
                render={
                  <button className="h-6 w-6 flex items-center justify-center rounded text-[var(--ink-faint)]" aria-label="ตัวเลือกความคิดเห็น">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                }
              />
              <PopoverContent className="w-auto p-1 flex flex-col min-w-40" align="end">
                <div className="flex flex-row gap-0.5 p-0.5">
                  {reactionEmojis.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        onToggleReaction(emoji);
                        setTouchMenuOpen(false);
                      }}
                      className={cn(
                        "h-8 w-8 flex items-center justify-center rounded-md text-base hover:bg-[var(--bg-soft)]",
                        (reply.reactions?.[emoji] ?? []).length > 0 && "bg-[var(--accent)]"
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <div className="h-px bg-[var(--line)] mx-1 my-0.5" />
                <button
                  onClick={() => {
                    setTouchMenuOpen(false);
                    onReplyTo(reply);
                  }}
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left hover:bg-[var(--bg-soft)]"
                >
                  <ReplyIcon className="h-3.5 w-3.5 text-[var(--ink-soft)]" />
                  ตอบกลับ
                </button>
                <button
                  onClick={() => {
                    setTouchMenuOpen(false);
                    onCopyLink();
                  }}
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left hover:bg-[var(--bg-soft)]"
                >
                  <Link2 className="h-3.5 w-3.5 text-[var(--ink-soft)]" />
                  คัดลอกลิงก์
                </button>
                {isOwn && (
                  <>
                    <button
                      onClick={() => {
                        setTouchMenuOpen(false);
                        setEditBody(reply.body);
                        setEditing(true);
                      }}
                      className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left hover:bg-[var(--bg-soft)]"
                    >
                      <Pencil className="h-3.5 w-3.5 text-[var(--ink-soft)]" />
                      แก้ไข
                    </button>
                    <button
                      onClick={() => {
                        setTouchMenuOpen(false);
                        onDelete();
                      }}
                      className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left text-[var(--chart-red)] hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      ลบ
                    </button>
                  </>
                )}
              </PopoverContent>
            </Popover>
          </span>
        </div>
        {quoted && (
          <button
            onClick={() => onJumpToQuote(quoted.id)}
            className="mt-1 mb-1.5 flex items-center gap-1.5 max-w-full rounded-md bg-[var(--bg-soft)] hover:bg-[var(--accent)] border-l-[3px] border-[var(--brand-green)]/50 pl-2 pr-2.5 py-1.5 text-xs text-left transition-colors"
            aria-label={`ไปดูข้อความที่ ${quotedAuthor?.name ?? "ผู้ใช้"} ${quoted.id === postQuote.id ? "โพสต์" : "แสดงความคิดเห็น"} ไว้`}
          >
            <CornerUpLeft className="h-3 w-3 shrink-0 text-[var(--ink-soft)]" />
            <span className="min-w-0 truncate">
              <span className="font-semibold text-[var(--ink)]">{quotedAuthor?.name ?? "ความคิดเห็นที่ถูกลบ"}</span>
              {quoted.body && <span className="text-[var(--ink-soft)]">: {quotePreview(quoted.body)}</span>}
            </span>
          </button>
        )}
        {editing ? (
          <div className="mt-1 space-y-1.5">
            <textarea
              autoFocus
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-sm outline-none focus:border-[var(--brand-green)]/50"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
            />
            <div className="flex items-center gap-1.5">
              <Button size="sm" className="h-6 text-xs px-2" disabled={!editBody.trim()} onClick={saveEdit}>
                <Check className="h-3 w-3" />
                บันทึก
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setEditing(false)}>
                ยกเลิก
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* whitespace-pre-wrap — reply.body is one flat string with real "\n"s
                (Shift+Enter in the reply box), but renderRichBulletText only
                turns *inline* markers into nodes, it never splits on newlines.
                Without this the browser's default white-space:normal collapsed
                every line break into a space, so a two-line comment always
                rendered as one line ("พิม test shift+enter 111 แต่แสดงแถวเดียวกัน"). */}
            {reply.body && <p className="text-[13px] sm:text-sm mt-0.5 whitespace-pre-wrap">{renderRichBulletText(reply.body)}</p>}
            {!!reply.images?.length && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {reply.images.map((img, i) => (
                  <button
                    key={img.id}
                    onClick={() => onOpenLightbox(reply.images!, i)}
                    className="rounded-md border border-[var(--line)] overflow-hidden hover:opacity-90 transition-opacity"
                    aria-label={`ดูรูป ${img.name} เต็มจอ`}
                  >
                    <ReportMediaThumb media={img} className="h-16 w-16 object-cover" />
                  </button>
                ))}
              </div>
            )}
            {activeReactions.length > 0 && (
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {activeReactions.map(({ emoji, users }) => (
                  <button
                    key={emoji}
                    onClick={() => onToggleReaction(emoji)}
                    className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] border border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] transition-colors"
                  >
                    <span>{emoji}</span>
                    <span className="tabular-nums">{users.length}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
