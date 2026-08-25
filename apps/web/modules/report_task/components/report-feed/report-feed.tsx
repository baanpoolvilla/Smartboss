"use client";

import { useEffect, useRef, useState } from "react";
import { ReportCard } from "@/modules/report_task/components/report-feed/report-card";
import { DaySeparator } from "@/modules/report_task/components/report-feed/report-day-separator";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { groupByDay } from "@/modules/report_task/lib/format";
import { ArrowDown, MessageSquareText } from "lucide-react";

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
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto bg-white scroll-pt-4">
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
            <div key={group.key}>
              <DaySeparator label={group.label} />
              {group.items.map((p) => (
                <ReportCard key={p.id} post={p} topic={topic} highlighted={p.id === highlightPostId} highlightReplyId={highlightReplyId} onOpenTask={onOpenTask} />
              ))}
            </div>
          ))
        ) : (
          // Thread mode used to yumup every post but the one just clicked
          // into a one-line forum row (ThreadRow), one at a time — a real
          // Teams screenshot compared against ours made clear that's not
          // what "Thread" is actually supposed to look like: every post
          // stays a full card, same as stream, just recent-activity-first
          // instead of chronological, with its own "ตอบกลับในเธรด" toggle
          // per card (see ReportCard) instead of a whole-post collapse/
          // expand. ThreadRow itself is now unused (kept below for whatever
          // still imports its exported pieces, if anything does).
          [...topicPosts]
            .sort((a, b) => lastActivityOf(b).localeCompare(lastActivityOf(a)))
            .map((p) => (
              <ReportCard key={p.id} post={p} topic={topic} highlighted={p.id === highlightPostId} highlightReplyId={highlightReplyId} onOpenTask={onOpenTask} />
            ))
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
