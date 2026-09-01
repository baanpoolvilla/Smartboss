"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ReportCard } from "@/modules/report_task/components/report-feed/report-card";
import { DaySeparator } from "@/modules/report_task/components/report-feed/report-day-separator";
import { NewMessagesDivider } from "@/modules/report_task/components/report-feed/report-new-divider";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { reportDayLabel } from "@/modules/report_task/components/report-feed/report-day-label";
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
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);

  // "ข้อความใหม่" divider position, frozen per room. Opening a room marks it
  // read (page.tsx effect) which clears unreadFor almost immediately, so we
  // capture the id of the first still-unread post on the very first render for
  // this room — refs update during render, before that read-clearing effect
  // runs — and keep the line there until the room changes. null = nothing was
  // unread when you arrived, so no line shows.
  const dividerRef = useRef<{ topicId: string; beforeId: string | null }>({ topicId: "", beforeId: null });
  if (dividerRef.current.topicId !== topic.id) {
    const firstUnread = topicPosts.find((p) => p.unreadFor.includes(viewingAsUserId) && p.authorId !== viewingAsUserId);
    dividerRef.current = { topicId: topic.id, beforeId: firstUnread ? firstUnread.id : null };
  }
  const newDividerBeforeId = dividerRef.current.beforeId;

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
      {/* Round 3: back to a tinted ground behind white post cards — asked for
          explicitly ("กรอบของใครของมันแยกให้ชัดเจน...แบบ thread") after the
          flat single-surface pass (see git history) still read as one
          undifferentiated column. A bordered card needs something to
          contrast against, which flattening this to plain white specifically
          removed. */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto bg-[var(--bg-soft)] py-3 scroll-pt-4">
        {topicPosts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <div
              className="h-14 w-14 rounded-full flex items-center justify-center"
              style={{ backgroundColor: `color-mix(in srgb, ${topic.color} 14%, white)` }}
            >
              <MessageSquareText className="h-6 w-6" style={{ color: topic.color }} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">ยังไม่มีโพสต์ในหัวข้อนี้</p>
              <p className="text-xs text-[var(--ink-soft)]">เริ่มต้นด้วยการเขียนโพสต์แรกของคุณจากช่องด้านล่าง</p>
            </div>
          </div>
        ) : (
          // Not capped in here — the reading-width constraint now lives one
          // level up, in page.tsx, wrapping the whole room column (header +
          // tabs + this feed + the composer) as a single centered unit
          // instead of just this post list on its own. That's the fix for
          // why a max-width tried at this level specifically got reverted
          // twice before: capping only the feed left the header still
          // full-width above it, plus no mx-auto meant the leftover space
          // sat one-sided instead of split evenly ("แสดงให้เต็มกรอบสิ").
          // space-y-6 between day groups, space-y-3 between the cards inside
          // one — each post is now its own bordered card (see ReportCard),
          // so the gap between them has to be real whitespace, not just a
          // border each card leans on.
          <div className="space-y-6 px-2 sm:px-3">
            {groupByDay(topicPosts, (p) => p.createdAt).map((group) => (
              <div key={group.key} className="space-y-3">
                <DaySeparator label={reportDayLabel(group.label)} />
                {group.items.map((p) => (
                  <Fragment key={p.id}>
                    {p.id === newDividerBeforeId && <NewMessagesDivider />}
                    <ReportCard post={p} topic={topic} highlighted={p.id === highlightPostId} highlightReplyId={highlightReplyId} onOpenTask={onOpenTask} />
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
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
