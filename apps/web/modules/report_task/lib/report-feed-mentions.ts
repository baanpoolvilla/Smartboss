import { extractMentionedIds } from "@/modules/report_task/lib/report-feed-rich-text";
import type { ReportPost } from "@/modules/report_task/store/report-feed-store";

function textMentionsUser(text: string, userId: string): boolean {
  return extractMentionedIds(text, "user").includes(userId);
}

/** True if `userId` is @mentioned anywhere in this post — its own body, or
 * any reply underneath it (Teams' "you were mentioned in this thread" scope,
 * not just the root message). */
export function postMentionsUser(post: ReportPost, userId: string): boolean {
  const bodyTexts = post.sections.flatMap((s) => s.bullets);
  if (bodyTexts.some((t) => textMentionsUser(t, userId))) return true;
  return post.replies.some((r) => textMentionsUser(r.body, userId));
}
