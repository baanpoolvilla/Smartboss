"use client";

import { useEffect, useRef, useState } from "react";
import { ReportCard } from "@/modules/report_task/components/report-feed/report-card";
import { DaySeparator } from "@/modules/report_task/components/report-feed/report-day-separator";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { groupByDay, relativeTime } from "@/modules/report_task/lib/format";
import { getUser } from "@/modules/report_task/lib/directory";
import { ArrowDown, ChevronDown, ImageIcon, MessageCircle, MessageSquareText } from "lucide-react";

const NEAR_BOTTOM_PX = 120;

/** Latest thing that happened on a post — itself or its newest reply — used
 * to sort "threads" mode by recent activity instead of by when the thread
 * was first opened (a week-old post with a reply five minutes ago belongs
 * near the top, same as a forum's "recently active" ordering). */
function lastActivityOf(post: ReportPost): string {
  let latest = post.createdAt;
  for (const r of post.replies) if (r.createdAt > latest) latest = r.createdAt;
  return latest;
}

/** A one-line preview of what a post actually says — first non-empty
 * bullet across its sections, falling back to "แนบรูป N รูป" for an
 * image-only check-in with no text at all. */
function snippetOf(post: ReportPost): string {
  for (const section of post.sections) {
    const bullet = section.bullets.find((b) => b.trim().length > 0);
    if (bullet) return bullet;
  }
  if (post.images.length > 0) return `แนบรูป ${post.images.length} รูป`;
  return "";
}

/** One collapsed row in "threads" mode — a forum thread-list line (title,
 * author, snippet, reply count, last-activity time) rather than the full
 * card, so scanning a busy room means reading a list of topics instead of
 * scrolling past every message body. Clicking it expands into the real
 * `ReportCard` (post + all replies) in place. */
function ThreadRow({ post, onToggle }: { post: ReportPost; onToggle: () => void }) {
  const author = getUser(post.authorId);
  const replyCount = post.replies.length;
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-4 py-3 text-left transition-colors hover:border-[var(--brand-green)]/30 hover:bg-[var(--bg-soft)]/60"
    >
      <span className="h-8 w-8 rounded-full bg-[var(--accent)] text-[var(--brand-green-dark)] text-[10px] font-semibold flex items-center justify-center shrink-0">
        {author?.avatar ?? "?"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate">{post.title}</span>
          {post.pinned && <span className="shrink-0 text-[10px] font-medium text-[var(--brand-green-dark)] bg-[var(--accent)] rounded-full px-1.5 py-0.5">ปักหมุด</span>}
        </span>
        <span className="block text-xs text-[var(--ink-soft)] truncate mt-0.5">
          {author?.name ?? "ไม่ทราบชื่อ"}{snippetOf(post) && ` — ${snippetOf(post)}`}
        </span>
      </span>
      <span className="shrink-0 flex flex-col items-end gap-1 text-[11px] text-[var(--ink-faint)]">
        <span>{relativeTime(lastActivityOf(post))}</span>
        {replyCount > 0 ? (
          <span className="flex items-center gap-1 text-[var(--ink-soft)] font-medium">
            <MessageCircle className="h-3 w-3" /> {replyCount}
          </span>
        ) : post.images.length > 0 ? (
          <span className="flex items-center gap-1">
            <ImageIcon className="h-3 w-3" /> {post.images.length}
          </span>
        ) : null}
      </span>
      <ChevronDown className="h-4 w-4 text-[var(--ink-faint)] shrink-0 mt-0.5" />
    </button>
  );
}

/** Scrollable post timeline for the active topic — Teams-style: jumps to the newest post on topic switch or when already at the bottom, otherwise surfaces a "jump to latest" affordance instead of yanking scroll position around. */
export function ReportFeed({
  topic,
  topicPosts,
  highlightPostId,
  highlightReplyId,
  viewMode = "stream",
  onOpenTask,
}: {
  topic: ReportTopic;
  topicPosts: ReportPost[];
  highlightPostId: string | null;
  highlightReplyId?: string | null;
  /** "stream" (default) = chat-log order, oldest→newest, day-grouped, auto-
   *  scrolls to the newest post. "threads" = forum order, most-recently-
   *  active post first, no day grouping/auto-scroll — for scanning a busy
   *  room by what's currently being discussed rather than by clock time. */
  viewMode?: "stream" | "threads";
  onOpenTask?: (taskId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const isStream = viewMode === "stream";
  // "threads" mode's collapsed-row expand state — one thread open at a
  // time, cleared on topic switch so a different room never opens already
  // showing yesterday's expanded thread.
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  // Adjusted during render (React's own guidance for resetting state on a
  // prop change) rather than in an effect — same pattern as add-todo-dialog.tsx.
  const [lastTopicId, setLastTopicId] = useState(topic.id);
  if (topic.id !== lastTopicId) {
    setLastTopicId(topic.id);
    setExpandedThreadId(null);
  }
  // A "copy link"/highlight deep-link into a specific post should open it
  // even when the room happens to be in "threads" mode — otherwise the link
  // would silently land on a collapsed row instead of the post it pointed at.
  // Keyed on both inputs (not just highlightPostId) so switching into
  // "threads" mode with an already-set highlight still expands it.
  const highlightKey = `${isStream}:${highlightPostId}`;
  const [lastHighlightKey, setLastHighlightKey] = useState(highlightKey);
  if (highlightKey !== lastHighlightKey) {
    setLastHighlightKey(highlightKey);
    if (!isStream && highlightPostId) setExpandedThreadId(highlightPostId);
  }

  useEffect(() => {
    if (!isStream) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [topic.id, isStream]);

  const prevCount = useRef(topicPosts.length);
  useEffect(() => {
    if (!isStream) return;
    const el = scrollRef.current;
    if (!el) return;
    const grew = topicPosts.length > prevCount.current;
    prevCount.current = topicPosts.length;
    if (!grew) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    } else {
      setShowJumpToLatest(true);
    }
  }, [topicPosts.length, isStream]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom) setShowJumpToLatest(false);
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setShowJumpToLatest(false);
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto bg-[var(--bg-soft)]/40 px-5 py-5 space-y-5 scroll-pt-4">
        {topicPosts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <div
              className="h-14 w-14 rounded-full flex items-center justify-center"
              style={{ backgroundColor: `color-mix(in srgb, ${topic.color} 14%, white)` }}
            >
              <MessageSquareText className="h-6 w-6" style={{ color: topic.color }} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">ยังไม่มีรีพอตในหัวข้อนี้</p>
              <p className="text-xs text-[var(--ink-soft)]">เริ่มการสนทนาแรกได้เลยจากช่องด้านล่าง</p>
            </div>
          </div>
        ) : isStream ? (
          groupByDay(topicPosts, (p) => p.createdAt).map((group) => (
            <div key={group.key} className="space-y-5">
              <DaySeparator label={group.label} />
              {group.items.map((p) => (
                <ReportCard key={p.id} post={p} topic={topic} highlighted={p.id === highlightPostId} highlightReplyId={highlightReplyId} onOpenTask={onOpenTask} />
              ))}
            </div>
          ))
        ) : (
          [...topicPosts]
            .sort((a, b) => lastActivityOf(b).localeCompare(lastActivityOf(a)))
            .map((p) =>
              p.id === expandedThreadId ? (
                <div key={p.id} className="space-y-1.5">
                  <ReportCard post={p} topic={topic} highlighted={p.id === highlightPostId} highlightReplyId={highlightReplyId} onOpenTask={onOpenTask} />
                  <button
                    onClick={() => setExpandedThreadId(null)}
                    className="text-xs text-[var(--ink-soft)] hover:text-[var(--ink)] px-1"
                  >
                    ↑ ย่อกลับเป็นหัวข้อ
                  </button>
                </div>
              ) : (
                <ThreadRow key={p.id} post={p} onToggle={() => setExpandedThreadId(p.id)} />
              )
            )
        )}
      </div>

      {isStream && showJumpToLatest && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-[var(--ink)] text-white text-xs font-medium px-3 py-1.5 shadow-lg hover:opacity-90"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          โพสต์ใหม่
        </button>
      )}
    </div>
  );
}
