"use client";

import { useEffect, useRef, useState } from "react";
import { ReportCard } from "@/modules/report_task/components/report-feed/report-card";
import { DaySeparator } from "@/modules/report_task/components/report-feed/report-day-separator";
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
      {/* Round 2, explicit instruction: single flat surface (white), not the
          tinted background a stack of white cards needed for contrast —
          there's nothing to contrast against anymore (see ReportCard's own
          comment on why that's a real trade-off, not a free change). */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto bg-white py-2 scroll-pt-4">
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
          // Reading width capped (explicit override — a centred ~860-960px
          // measure was tried and dropped once before per real feedback
          // wanting the sides used fully, see git history
          // "ใช้พื้นที่ข้างๆให้เต็มได้ไหม" — this round asks for the cap
          // back anyway). space-y-6 between day groups only now; individual
          // posts inside one lean on their own border-b + padding for
          // rhythm instead of an extra gap on top of that, so density goes
          // up the way §15/16 ask for.
          <div className="max-w-[960px] mx-auto space-y-6">
            {groupByDay(topicPosts, (p) => p.createdAt).map((group) => (
              <div key={group.key}>
                <DaySeparator label={reportDayLabel(group.label)} />
                {group.items.map((p) => (
                  <ReportCard key={p.id} post={p} topic={topic} highlighted={p.id === highlightPostId} highlightReplyId={highlightReplyId} onOpenTask={onOpenTask} />
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
