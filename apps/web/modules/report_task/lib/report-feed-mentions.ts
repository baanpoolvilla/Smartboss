import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { extractMentionedIds } from "@/modules/report_task/lib/report-feed-rich-text";
import { getUser, users } from "@/modules/report_task/lib/directory";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";

/** True if `text` @mentions `userId` directly, or via the pinned "@ทุกคน"
 * marker — resolved against `topic`'s own visibility (whoever can actually
 * see *this* room), not literally every employee in the company. Without a
 * `topic` (caller doesn't have one handy), an "@ทุกคน" marker is ignored —
 * same as before this existed. */
export function textMentionsUser(text: string, userId: string, topic?: Pick<ReportTopic, "visibility">): boolean {
  if (extractMentionedIds(text, "user").includes(userId)) return true;
  // แท็กแผนก (@ฝ่ายพัฒนาระบบ) = แท็กทุกคนในแผนกนั้น
  const dept = getUser(userId)?.departmentId;
  if (dept && extractMentionedIds(text, "dept").includes(dept) && (!topic || canSeeReportTopic(topic.visibility, userId))) return true;
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

/**
 * คนที่ถูกแท็กในข้อความ — แท็กตัวบุคคลตรง ๆ + ทุกคนในแผนกที่ถูกแท็ก (@ฝ่ายพัฒนาระบบ)
 * เดิมแท็กแผนกขึ้นเป็นป้ายเฉย ๆ ไม่มีใครได้แจ้งเตือนเลย ("แท็กฝ่ายพัฒนาระบบทำไมไม่เห็น")
 * คนในแผนกที่มองห้องนี้ไม่เห็น (ส่ง `topic` มา) ไม่ได้แจ้งเตือน — กดไปก็เปิดห้องไม่ได้
 */
export function taggedUserIds(text: string, topic?: Pick<ReportTopic, "visibility">): string[] {
  const ids = new Set(extractMentionedIds(text, "user"));
  const depts = new Set(extractMentionedIds(text, "dept"));
  if (depts.size > 0) {
    for (const u of users) {
      if (u.departmentId && depts.has(u.departmentId) && (!topic || canSeeReportTopic(topic.visibility, u.id))) ids.add(u.id);
    }
  }
  return [...ids];
}
