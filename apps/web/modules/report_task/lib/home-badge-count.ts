import { isAwaitingReview } from "@/modules/report_task/lib/personal-task";
import { canReviewTaskRecord, canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { aboutMeCountInPost } from "@/modules/report_task/lib/report-feed-activity";
import { unreadTaskAssignmentCounts, unreadTaskAttachmentCounts, unreadTaskCommentCounts } from "@/modules/report_task/lib/task-comment-activity";
import type { AppNotification } from "@/modules/report_task/store/notification-store";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { TaskReviewSettings } from "@/modules/report_task/store/task-review-settings-store";
import type { Task } from "@/modules/report_task/types";

/**
 * Badge counts on the home tiles. The browser fallback (app-tile-review-badge.tsx) and the server
 * (app/api/report-task/home-badge) use this same formula, so the server's number is exactly what the browser used to compute.
 * Reads permissions through directory.ts: the server wraps the call in withDirectory(...) to pass that company's employees and departments.
 */

/** "Projects and tasks" tile: tasks awaiting my review + unread comments/attachments/assignments on tasks */
export function countTaskTileBadge(
  tasks: Task[],
  notifications: AppNotification[],
  viewingAsUserId: string,
  reviewSettings: TaskReviewSettings | null
): number {
  const reviewCount = tasks.filter(
    (t) => isAwaitingReview(t) && canReviewTaskRecord(t, viewingAsUserId, reviewSettings ?? undefined)
  ).length;

  let unreadActivityCount = 0;
  for (const n of unreadTaskCommentCounts(notifications, viewingAsUserId).values()) unreadActivityCount += n;
  for (const n of unreadTaskAttachmentCounts(notifications, viewingAsUserId).values()) unreadActivityCount += n;
  for (const n of unreadTaskAssignmentCounts(notifications, viewingAsUserId).values()) unreadActivityCount += n;
  return reviewCount + unreadActivityCount;
}

/** Chat & Report tile: unread report activity about me (@mentions / replies on my posts) in rooms I can see that are not muted */
export function countReportTileBadge(
  reportFeed: { topics?: ReportTopic[]; posts?: ReportPost[] } | null,
  viewingAsUserId: string
): number {
  const topics = reportFeed?.topics ?? [];
  const posts = reportFeed?.posts ?? [];
  const topicById = new Map(topics.map((t) => [t.id, t]));
  const activeTopics = new Map<string, boolean>(
    topics.map((t) => [
      t.id,
      canSeeReportTopic(t.visibility, viewingAsUserId) && (t.notifyPreference?.[viewingAsUserId] ?? "all") !== "off",
    ])
  );
  return posts.reduce(
    (sum, post) => (activeTopics.get(post.topicId) ? sum + aboutMeCountInPost(post, viewingAsUserId, topicById.get(post.topicId)) : sum),
    0
  );
}
