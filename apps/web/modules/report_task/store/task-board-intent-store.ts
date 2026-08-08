import { create } from "zustand";
import type { TaskStatus } from "@/modules/report_task/types";

/**
 * One-shot navigation intent set by a dashboard chart click (e.g. "show me
 * this department's tasks") and consumed once by the Task Board on mount.
 */
interface TaskBoardIntentStore {
  departmentId: string | null;
  scrollToStatus: TaskStatus | null;
  openTaskId: string | null;
  setDepartment: (id: string) => void;
  setScrollToStatus: (status: TaskStatus) => void;
  setOpenTask: (id: string) => void;
  clear: () => void;
}

export const useTaskBoardIntentStore = create<TaskBoardIntentStore>((set) => ({
  departmentId: null,
  scrollToStatus: null,
  openTaskId: null,
  setDepartment: (id) => set({ departmentId: id }),
  setScrollToStatus: (status) => set({ scrollToStatus: status }),
  setOpenTask: (id) => set({ openTaskId: id }),
  clear: () => set({ departmentId: null, scrollToStatus: null, openTaskId: null }),
}));
