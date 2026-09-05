"use client";

import { useMemo } from "react";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { extractMentionedIds } from "@/modules/report_task/lib/report-feed-rich-text";

/**
 * Discord-style unread pill for the "รายงาน" (report-feed) rail item (see
 * manifest.ts's `ModuleMenuItem.badge` and shell.tsx's RailItem /
 * BottomNavItem) — counts unread activity that is *about the viewer*, not
 * every unread post. Three things count, each unread item at most once:
 *
 *   1. a post that @mentions the viewer (mention taken from the exact same
 *      source the store seeds `unreadFor` from — `sections.bullets`, not the
 *      title — so this never drifts from the sidebar's own dot/bold state),
 *      and isn't the viewer's own post;
 *   2. a reply someone else left on the viewer's own post;
 *   3. a reply that @mentions the viewer (from its `body`).
 *
 * A plain new post in a room the viewer belongs to is deliberately NOT
 * counted: the store seeds every room member's id into `post.unreadFor`, so
 * counting that would make this badge a duplicate of the topic sidebar's
 * unread state and it would never be quiet. The topic-visibility guard
 * matters because the store seeds mentioned ids into `unreadFor` WITHOUT a
 * visibility check — an @mention in a room the viewer can't open would
 * otherwise be a phantom count that can never be cleared.
 *
 * Renders nothing at zero. The report-feed store is hydrated at module level
 * (see report-task-scaffold.tsx's StoreHydrator), so this is accurate on
 * every page of the module, not just the report page itself.
 */
export function ReportActivityNavBadge() {
  const posts = useReportFeedStore((s) => s.posts);
  const topics = useReportFeedStore((s) => s.topics);
  const me = useIdentityStore((s) => s.viewingAsUserId);

  const count = useMemo(() => {
    if (!me) return 0;
    const canSee = new Map<string, boolean>(
      topics.map((t) => [t.id, canSeeReportTopic(t.visibility, me)])
    );

    let n = 0;
    for (const post of posts) {
      if (!(canSee.get(post.topicId) ?? false)) continue;
      const mine = post.authorId === me;

      // (1) post that @mentions me, still unread, not my own post
      if (!mine && post.unreadFor.includes(me)) {
        const text = post.sections.flatMap((s) => s.bullets).join("\n");
        if (extractMentionedIds(text, "user").includes(me)) n++;
      }

      // (2)+(3) replies: on my own post, or a reply that @mentions me —
      // each unread reply counted once even when both are true
      for (const r of post.replies) {
        if (r.authorId === me) continue;
        if (!r.unreadFor?.includes(me)) continue;
        if (mine || extractMentionedIds(r.body, "user").includes(me)) n++;
      }
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
