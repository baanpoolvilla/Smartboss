import { CornerUpLeft, Link2, Reply as ReplyIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { getUser } from "@/modules/report_task/lib/directory";
import type { ReportPostImage, ReportPostReply } from "@/modules/report_task/store/report-feed-store";
import { relativeTime } from "@/modules/report_task/lib/format";
import { renderRichBulletText } from "@/modules/report_task/lib/report-feed-rich-text";
import { cn } from "@/modules/report_task/lib/utils";

/** Trims a quoted reply's body down to one short line for the reference shown above a reply that answers it. */
function quotePreview(body: string): string {
  const firstLine = body.split("\n")[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

/** One reply row inside a report card — plain, no background box, just a light top divider between replies (added by the parent list) so a thread reads as part of the same card, not a stack of nested cards. */
export function ReportReply({
  reply,
  allReplies,
  postQuote,
  flashed,
  onOpenLightbox,
  onReplyTo,
  onJumpToQuote,
  onCopyLink,
}: {
  reply: ReportPostReply;
  /** Full reply list for this post — used to resolve/show the quoted reply when `reply.replyToId` is set. */
  allReplies: ReportPostReply[];
  /** The post itself, reply-shaped — `reply.replyToId` can also point at the post (quoting the original post, not just another reply). */
  postQuote: { id: string; authorId: string; body: string };
  /** True for a brief moment right after someone jumps here via a quote click — drives the highlight flash. */
  flashed?: boolean;
  onOpenLightbox: (images: ReportPostImage[], index: number) => void;
  onReplyTo: (reply: ReportPostReply) => void;
  /** Scrolls to and flashes whatever `id` (a reply id, or the post id) this reply is quoting. */
  onJumpToQuote: (id: string) => void;
  /** Copies a deep link to this specific reply (?reply=), same idea as "copy link" on the post but pointed at one comment. */
  onCopyLink: () => void;
}) {
  const author = getUser(reply.authorId);
  const quoted = reply.replyToId
    ? reply.replyToId === postQuote.id
      ? postQuote
      : allReplies.find((r) => r.id === reply.replyToId)
    : undefined;
  const quotedAuthor = quoted ? getUser(quoted.authorId) : undefined;

  return (
    <div
      id={`report-reply-${reply.id}`}
      className={cn(
        "group/reply flex items-start gap-2.5 py-3 rounded-lg transition-colors duration-500",
        flashed && "bg-[var(--accent)]"
      )}
      style={reply.highlightColor ? { borderLeft: `3px solid ${reply.highlightColor}`, paddingLeft: "9px" } : undefined}
    >
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="text-[10px] bg-[var(--bg-soft)]">{author?.avatar}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium">
            {author?.name} <span className="font-normal text-[var(--ink-soft)]">· {relativeTime(reply.createdAt)}</span>
          </p>
          <span className="shrink-0 flex items-center gap-2 opacity-0 group-hover/reply:opacity-100 focus-within:opacity-100 transition-opacity">
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
        {reply.body && <p className="text-sm mt-0.5">{renderRichBulletText(reply.body)}</p>}
        {!!reply.images?.length && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {reply.images.map((img, i) => (
              <button
                key={img.id}
                onClick={() => onOpenLightbox(reply.images!, i)}
                className="rounded-md border border-[var(--line)] overflow-hidden hover:opacity-90 transition-opacity"
                aria-label={`ดูรูป ${img.name} เต็มจอ`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url ?? img.dataUrl} alt={img.name} className="h-16 w-16 object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
