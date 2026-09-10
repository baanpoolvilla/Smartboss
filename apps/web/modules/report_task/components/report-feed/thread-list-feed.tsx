"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { ReportCard } from "@/modules/report_task/components/report-feed/report-card";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { getUser } from "@/modules/report_task/lib/directory";
import { mentionMarkersToPlainText } from "@/modules/report_task/lib/report-feed-rich-text";
import { TimeAgo } from "@/modules/report_task/components/shared/time-ago";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { cn } from "@/modules/report_task/lib/utils";
import { MessageCircle, MessageSquareText, Pin } from "lucide-react";

/** Forum-style "Thread" view for a room (Room Settings → รูปแบบห้อง →
 * "Thread") — a left rail of collapsed thread headers, newest-activity-first,
 * next to a detail pane showing the selected post fully expanded. The
 * chronological ReportFeed/OpenchatFeed pair both read as "everything
 * scrolls by in order"; this one reads as "pick a topic, see its whole
 * conversation" — same underlying ReportPost/ReportPostReply data either
 * way, just a different way to land on one post's thread. */
export function ThreadListFeed({
  topic,
  topicPosts,
  highlightPostId,
  highlightReplyId,
  onOpenTask,
}: {
  topic: ReportTopic;
  topicPosts: ReportPost[];
  highlightPostId: string | null;
  highlightReplyId?: string | null;
  onOpenTask?: (taskId: string) => void;
}) {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [selectedId, setSelectedId] = useState<string | null>(highlightPostId ?? null);

  const rows = useMemo(() => {
    return topicPosts
      .map((p) => {
        const lastReply = p.replies[p.replies.length - 1];
        const lastActivityAt = lastReply && lastReply.createdAt > p.createdAt ? lastReply.createdAt : p.createdAt;
        const isUnread = p.unreadFor.includes(viewingAsUserId) || p.replies.some((r) => r.unreadFor?.includes(viewingAsUserId));
        return { post: p, lastActivityAt, isUnread };
      })
      .sort((a, b) => {
        if (a.post.pinned !== b.post.pinned) return a.post.pinned ? -1 : 1;
        return b.lastActivityAt.localeCompare(a.lastActivityAt);
      });
  }, [topicPosts, viewingAsUserId]);

  // A deep link (?post=) or a switch to a room with no selection yet should
  // land on a real thread, not an empty detail pane — but never yanks the
  // user away from whatever they've already clicked into on their own.
  useEffect(() => {
    if (highlightPostId) {
      setSelectedId(highlightPostId);
      return;
    }
    setSelectedId((cur) => (cur && topicPosts.some((p) => p.id === cur) ? cur : rows[0]?.post.id ?? null));
  }, [topic.id, highlightPostId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = selectedId ? topicPosts.find((p) => p.id === selectedId) ?? null : null;

  return (
    <div className="flex-1 flex min-h-0">
      <div className="w-[280px] sm:w-[320px] shrink-0 border-r border-[var(--line)] bg-[var(--bg)] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-4">
            <MessageSquareText className="h-6 w-6 text-[var(--ink-soft)]" />
            <p className="text-xs text-[var(--ink-soft)]">ยังไม่มีหัวข้อในห้องนี้</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {rows.map(({ post, isUnread }) => {
              const author = getUser(post.authorId);
              const preview = mentionMarkersToPlainText(post.sections[0]?.bullets[0] ?? "");
              return (
                <button
                  key={post.id}
                  onClick={() => setSelectedId(post.id)}
                  className={cn(
                    "w-full text-left px-3 py-3 flex items-start gap-2.5 hover:bg-[var(--bg-soft)] transition-colors",
                    selected?.id === post.id && "bg-[var(--accent)] hover:bg-[var(--accent)]"
                  )}
                >
                  <Avatar className="h-8 w-8 shrink-0 rounded-xl after:rounded-xl">
                    <AvatarImage src={author?.avatarUrl ?? undefined} alt={author?.name} />
                    <AvatarFallback className="rounded-xl text-xs font-semibold bg-[var(--accent)] text-[var(--brand-green-dark)]">
                      {author?.avatar}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      {post.pinned && <Pin className="h-3 w-3 shrink-0 text-[var(--brand-green-dark)]" />}
                      <p className="text-xs font-semibold truncate">{author?.name}</p>
                      {isUnread && <span className="h-1.5 w-1.5 rounded-full bg-[var(--chart-blue)] shrink-0" aria-label="ยังไม่อ่าน" />}
                    </div>
                    <p className={cn("text-sm mt-0.5 line-clamp-2 break-words", isUnread ? "font-semibold" : "font-medium")}>
                      {mentionMarkersToPlainText(post.title) || preview}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-[var(--ink-soft)]">
                      <TimeAgo date={post.createdAt} />
                      {post.replies.length > 0 && (
                        <span className="flex items-center gap-0.5">
                          <MessageCircle className="h-3 w-3" />
                          {post.replies.length}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto bg-[var(--bg-soft)] py-3">
        {selected ? (
          <div className="px-2 sm:px-3">
            <ReportCard
              key={selected.id}
              post={selected}
              topic={topic}
              highlighted={selected.id === highlightPostId}
              highlightReplyId={highlightReplyId}
              onOpenTask={onOpenTask}
              forceOpen
            />
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
            <MessageSquareText className="h-8 w-8 text-[var(--ink-soft)]" />
            <p className="text-sm text-[var(--ink-soft)]">เลือกหัวข้อทางซ้ายเพื่อดูรายละเอียด</p>
          </div>
        )}
      </div>
    </div>
  );
}
