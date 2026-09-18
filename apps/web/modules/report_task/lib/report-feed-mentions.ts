import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { extractMentionedIds } from "@/modules/report_task/lib/report-feed-rich-text";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";

/** True if `text` @mentions `userId` directly, or via the pinned "@ทุกคน"
 * marker — resolved against `topic`'s own visibility (whoever can actually
 * see *this* room), not literally every employee in the company. Without a
 * `topic` (caller doesn't have one handy), an "@ทุกคน" marker is ignored —
 * same as before this existed. */
export function textMentionsUser(text: string, userId: string, topic?: Pick<ReportTopic, "visibility">): boolean {
  if (extractMentionedIds(text, "user").includes(userId)) return true;
  if (!topic) return false;
  return extractMentionedIds(text, "everyone").length > 0 && canSeeReportTopic(topic.visibility, userId);
}

/** True if `userId` is @mentioned anywhere in this post — its own body, or
 * any reply underneath it (Teams' "you were mentioned in this thread" scope,
 * not just the root message). */
export function postMentionsUser(post: ReportPost, userId: string, topic?: Pick<ReportTopic, "visibility">): boolean {
  const bodyTexts = post.sections.flatMap((s) => s.bullets);
  if (bodyTexts.some((t) => textMentionsUser(t, userId, topic))) return true;
  return post.replies.some((r) => textMentionsUser(r.body, userId, topic));
}
