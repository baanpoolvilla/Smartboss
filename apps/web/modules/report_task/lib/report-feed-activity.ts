import { extractMentionedIds } from "@/modules/report_task/lib/report-feed-rich-text";
import type { ReportPost } from "@/modules/report_task/store/report-feed-store";

/**
 * How many unread items in this post are "about" `me` — the single shared
 * source for both the "รายงาน" nav badge (ReportActivityNavBadge) and the
 * per-room red pill in the topic sidebar, so the two never disagree. Counts,
 * each unread item at most once:
 *
 *   1. the post itself @mentions me and isn't my own post (mention read from
 *      `sections.bullets` — the exact text the store seeds `unreadFor` from);
 *   2. a reply someone else left on my own post (a comment on my report);
 *   3. a reply that @mentions me.
 *
 * A plain new post in a room I'm merely a member of is NOT "about me" — that
 * is ordinary unread, already carried by the sidebar's green notch + bold
 * label. Counting it here would make the red pill/badge never go quiet.
 */
export function aboutMeCountInPost(post: ReportPost, me: string): number {
  let n = 0;
  const mine = post.authorId === me;

  // (1) post that @mentions me, still unread, not my own
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

  return n;
}
