"use client";

import { useMemo } from "react";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { aboutMeCountInPost } from "@/modules/report_task/lib/report-feed-activity";

/**
 * Discord-style red pill for the "รายงาน" (report-feed) rail item (see
 * manifest.ts's `ModuleMenuItem.badge` and shell.tsx's RailItem /
 * BottomNavItem). Counts unread activity *about the viewer* — @mentions plus
 * comments on their own posts — summed across every room they can see and
 * haven't muted. The per-item rule lives in aboutMeCountInPost, shared with
 * the topic sidebar's own red pill so the two never disagree.
 *
 * A muted room (notifyPreference "off") contributes nothing, exactly like the
 * sidebar. Renders nothing at zero. The report-feed store is hydrated at
 * module level (report-task-scaffold.tsx's StoreHydrator), so this is
 * accurate on every page of the module, not just the report page itself.
 */
export function ReportActivityNavBadge() {
  const posts = useReportFeedStore((s) => s.posts);
  const topics = useReportFeedStore((s) => s.topics);
  const me = useIdentityStore((s) => s.viewingAsUserId);

  const count = useMemo(() => {
    if (!me) return 0;
    // A room counts only if the viewer can see it AND hasn't muted it — the
    // same two gates the sidebar applies before showing a room's red pill.
    const active = new Map<string, boolean>(
      topics.map((t) => [
        t.id,
        canSeeReportTopic(t.visibility, me) && (t.notifyPreference?.[me] ?? "all") !== "off",
      ])
    );

    let n = 0;
    for (const post of posts) {
      if (!(active.get(post.topicId) ?? false)) continue;
      n += aboutMeCountInPost(post, me);
    }
    return n;
  }, [posts, topics, me]);

  if (count === 0) return null;
  return (
    <span
      className="ml-auto flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white"
      aria-label={`มีความเคลื่อนไหวเกี่ยวกับคุณ ${count} รายการ`}
      title={`มีความเคลื่อนไหวเกี่ยวกับคุณ ${count} รายการ`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
