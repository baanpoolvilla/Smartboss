"use client";

import { useEffect, useRef, useState } from "react";
import { ReportCard } from "@/modules/report_task/components/report-feed/report-card";
import { DaySeparator } from "@/modules/report_task/components/report-feed/report-day-separator";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { groupByDay } from "@/modules/report_task/lib/format";
import { ArrowDown, MessageSquareText } from "lucide-react";

const NEAR_BOTTOM_PX = 120;

/** Scrollable post timeline for the active topic — Teams-style: chronological,
 * oldest at the top and new posts pushed in at the bottom (never reordered by
 * reply activity — a post you're actively replying to must stay put, not jump
 * to the top and yank everyone's scroll position around). Jumps to the newest
 * post on topic switch or when already at the bottom, otherwise surfaces a
 * "jump to latest" affordance instead of forcing the scroll position. */
export function ReportFeed({
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [topic.id]);

  const prevCount = useRef(topicPosts.length);
  useEffect(() => {
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
  }, [topicPosts.length]);

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
      {/* Tinted background, not white — it's what makes each post's white card
          read as a separate object instead of a rectangle drawn on the same
          sheet it sits on. The card treatment and this tint only work as a
          pair; whitening this again brings back the "มองยาก" problem even with
          the borders still on the cards. */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto bg-[var(--bg-soft)]/50 px-4 py-4 space-y-4 scroll-pt-4">
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
        ) : (
          // space-y-4 between day groups, space-y-3 between the cards inside
          // one — same idea as the card itself: the bigger gap is the bigger
          // division, so a day boundary never reads the same as a post boundary.
          groupByDay(topicPosts, (p) => p.createdAt).map((group) => (
            // Capped and centred, not full-bleed. A room panel is ~1100px
            // wide on a desktop, and a post is usually a title and two or
            // three lines — stretched across the whole panel that reads as a
            // few words stranded in a big empty box, and the eye has to travel
            // the full width to find the next line. ~860px is the usual
            // comfortable measure for reading, and it makes the empty space
            // land as deliberate margin instead of as an unfinished layout.
            <div key={group.key} className="mx-auto w-full max-w-[860px] space-y-3">
              <DaySeparator label={group.label} />
              {group.items.map((p) => (
                <ReportCard key={p.id} post={p} topic={topic} highlighted={p.id === highlightPostId} highlightReplyId={highlightReplyId} onOpenTask={onOpenTask} />
              ))}
            </div>
          ))
        )}
      </div>

      {showJumpToLatest && (
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
