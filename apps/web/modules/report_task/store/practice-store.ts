import { create } from "zustand";
import { users } from "@/modules/report_task/lib/directory";
import type { TaskPriority, TaskStatus } from "@/modules/report_task/types";
import { uuid } from "@/modules/report_task/lib/uuid";

export interface PracticeComment {
  id: string;
  authorId: string;
  message: string;
  createdAt: string;
}

export interface PracticeTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeIds: string[];
  comments: PracticeComment[];
  createdAt: string;
}

function seedTasks(): PracticeTask[] {
  const now = new Date().toISOString();
  return [
    {
      id: "practice-seed-1",
      title: "ออกแบบหน้า Landing Page ใหม่",
      status: "todo",
      priority: "high",
      assigneeIds: ["usr-05"],
      comments: [],
      createdAt: now,
    },
    {
      id: "practice-seed-2",
      title: "รีวิวโค้ด Pull Request #128",
      status: "in_progress",
      priority: "medium",
      assigneeIds: ["usr-02", "usr-03"],
      comments: [{ id: "practice-seed-2-c1", authorId: "usr-01", message: "เช็ค edge case ตอน network หลุดด้วยนะ", createdAt: now }],
      createdAt: now,
    },
    {
      id: "practice-seed-3",
      title: "สรุปยอดขายไตรมาสนี้",
      status: "done",
      priority: "low",
      assigneeIds: ["usr-08"],
      comments: [],
      createdAt: now,
    },
  ];
}

interface PracticeStore {
  tasks: PracticeTask[];
  selectedTaskId: string | null;
  selectTask: (id: string | null) => void;
  addTask: (data: { title: string; priority: TaskPriority; assigneeIds: string[] }) => string;
  moveTask: (taskId: string, status: TaskStatus) => void;
  setAssignees: (taskId: string, assigneeIds: string[]) => void;
  addComment: (taskId: string, authorId: string, message: string) => void;
  reset: () => void;
}

/**
 * A completely separate, in-memory-only store — never wired to
 * ServerStoreSync, never persisted. Practice Mode (src/app/practice) reads
 * and writes only here, so nothing a learner does can touch the real
 * useTaskStore that's actually shared with every other simulated teammate.
 * Seeded with a couple of already-populated cards (using the same demo
 * people from src/data/mock.ts — this whole app already runs on a fake
 * company, so there's no separate "fake fake" roster to invent) so the
 * board doesn't look like an empty template.
 */
export const usePracticeStore = create<PracticeStore>((set) => ({
  tasks: seedTasks(),
  selectedTaskId: null,
  selectTask: (id) => set({ selectedTaskId: id }),
  addTask: ({ title, priority, assigneeIds }) => {
    const id = `practice-${uuid()}`;
    set((s) => ({
      tasks: [
        { id, title, status: "todo", priority, assigneeIds, comments: [], createdAt: new Date().toISOString() },
        ...s.tasks,
      ],
    }));
    return id;
  },
  moveTask: (taskId, status) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)) })),
  setAssignees: (taskId, assigneeIds) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, assigneeIds } : t)) })),
  addComment: (taskId, authorId, message) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id !== taskId
          ? t
          : { ...t, comments: [...t.comments, { id: `${taskId}-c-${uuid()}`, authorId, message, createdAt: new Date().toISOString() }] }
      ),
    })),
  reset: () => set({ tasks: seedTasks(), selectedTaskId: null }),
}));

/** Practice mode's own assignable roster — same demo people as the real app, since they're already fictional. */
export const practiceUsers = users;
