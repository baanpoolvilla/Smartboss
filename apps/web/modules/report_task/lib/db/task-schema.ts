import { z } from "zod";

// Mirrors src/types/index.ts — keep in sync when the Task shape changes.
// Validates the whole-collection PUT payload so a malformed client can't
// poison the shared file for every other client on next load.

const revisionEntrySchema = z.object({
  revisionNumber: z.number(),
  previousDate: z.string(),
  newDate: z.string(),
  reason: z.string(),
  revisedBy: z.string(),
  revisedAt: z.string(),
});

const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.string(),
  type: z.string(),
  uploadedBy: z.string(),
  uploadedAt: z.string(),
  dataUrl: z.string().optional(),
  url: z.string().optional(),
});

const commentSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  message: z.string(),
  createdAt: z.string(),
  attachments: z.array(attachmentSchema).optional(),
});

const checklistItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
  ownerId: z.string().optional(),
});

const taskReactionSchema = z.object({
  id: z.string(),
  stickerId: z.string(),
  byUserId: z.string(),
  note: z.string().optional(),
  createdAt: z.string(),
});

const taskPenaltySchema = z.object({
  points: z.number(),
  byUserId: z.string(),
  appliedAt: z.string(),
  reason: z.string().optional(),
});

export const taskSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string(),
  status: z.enum(["todo", "in_progress", "done"]),
  priority: z.enum(["critical", "high", "medium", "low"]),
  taskMode: z.enum(["individual", "group"]),
  assigneeIds: z.array(z.string()),
  assignedById: z.string(),
  departmentIds: z.array(z.string()),
  startDate: z.string(),
  dueDate: z.string(),
  originalDueDate: z.string(),
  assigneeDueDates: z.record(z.string(), z.string()).optional(),
  assigneeDueDateRevisions: z
    .record(
      z.string(),
      z.object({ originalDate: z.string(), latestDate: z.string(), revisedBy: z.string(), revisedAt: z.string() })
    )
    .optional(),
  completedAt: z.string().optional(),
  missedDeadlineOnce: z.boolean().optional(),
  reopenedOnce: z.boolean().optional(),
  completedAssigneeIds: z.array(z.string()).optional(),
  attachments: z.array(attachmentSchema),
  comments: z.array(commentSchema),
  revisions: z.array(revisionEntrySchema),
  reactions: z.array(taskReactionSchema),
  penalty: taskPenaltySchema.nullable().optional(),
  penalties: z.record(z.string(), taskPenaltySchema).optional(),
  checklist: z.array(checklistItemSchema),
  showChecklistOnCard: z.boolean(),
  projectTopicId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const taskListSchema = z.array(taskSchema);
