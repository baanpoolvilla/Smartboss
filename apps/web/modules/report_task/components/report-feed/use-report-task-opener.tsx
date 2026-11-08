"use client";

import { useState } from "react";

import { NewTaskDialog } from "@/modules/report_task/components/kanban/new-task-dialog";
import { getUser } from "@/modules/report_task/lib/directory";
import { buildReportTaskPrefill, fetchReportImageFiles, type ReportTaskPrefill } from "@/modules/report_task/lib/report-task-prefill";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useReportFeedStore, type ReportPost, type ReportPostReply, type ReportTopic } from "@/modules/report_task/store/report-feed-store";

/**
 * "เปิดเป็นงาน" จากโพสต์/ความคิดเห็นในรีพอต (ผู้ใช้ 2/11/2569 — เดิมดึงมาแค่หัวเรื่อง และเปิดจากความคิดเห็นไม่ได้)
 * ใช้หน้าสร้างงานตัวเดียวกับบอร์ด · เปิดแล้วเชื่อมไว้ กดอีกครั้งไปงานเดิม ไม่สร้างซ้ำ
 */
export function useReportTaskOpener(topic: ReportTopic, onOpenTask?: (taskId: string) => void) {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const setPostLinkedTask = useReportFeedStore((s) => s.setPostLinkedTask);
  const setReplyLinkedTask = useReportFeedStore((s) => s.setReplyLinkedTask);
  const addTaskCardReply = useReportFeedStore((s) => s.addTaskCardReply);
  const [target, setTarget] = useState<{ key: number; postId: string; replyId?: string; prefill: ReportTaskPrefill; files: File[] } | null>(null);

  async function openAsTask(post: ReportPost, reply?: ReportPostReply) {
    const linked = reply ? reply.linkedTaskId : post.linkedTaskId;
    if (linked) {
      onOpenTask?.(linked);
      return;
    }
    const prefill = buildReportTaskPrefill({
      topic,
      post,
      reply,
      meId: viewingAsUserId,
      nameOf: (id) => getUser(id)?.name,
      isKnownUser: (id) => !!getUser(id),
    });
    const files = await fetchReportImageFiles(reply ? (reply.images ?? []) : post.images);
    setTarget({ key: Date.now(), postId: post.id, replyId: reply?.id, prefill, files });
  }

  const dialog = target && (
    <NewTaskDialog
      key={target.key}
      open
      onOpenChange={(v) => !v && setTarget(null)}
      defaultType="task"
      allowedTypes={["task"]}
      defaultTitle={target.prefill.title}
      defaultDescription={target.prefill.description}
      defaultAssigneeIds={target.prefill.assigneeIds}
      defaultFiles={target.files}
      source={target.prefill.source}
      onCreated={(taskId, title) => {
        if (target.replyId) setReplyLinkedTask(target.postId, target.replyId, taskId);
        else setPostLinkedTask(target.postId, taskId);
        // การ์ดงานขึ้นในเธรดของโพสต์นี้ (แบบ Planner ใน Teams) — เปิดจากความคิดเห็นก็ตอบกลับความคิดเห็นนั้น
        if (viewingAsUserId) addTaskCardReply(target.postId, viewingAsUserId, { id: taskId, title: title ?? target.prefill.title }, target.replyId);
        setTarget(null);
        onOpenTask?.(taskId);
      }}
    />
  );

  return { openAsTask, dialog };
}
