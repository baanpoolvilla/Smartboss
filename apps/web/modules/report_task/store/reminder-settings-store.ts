import { create } from "zustand";

export interface TaskReminderSettings {
  enabled: boolean;
  /** Days before `dueDate` to notify — e.g. [3, 1] fires once 3 days out, once more 1 day out. Empty = never, even if enabled. */
  leadDays: number[];
  notifyAssignee: boolean;
  notifyAssigner: boolean;
  notifyDeptHead: boolean;
}

export interface MeetingReminderSettings {
  enabled: boolean;
  /** Minutes before `start` to notify attendees. */
  leadMinutes: number[];
  notifyAttendees: boolean;
}

export interface ReportReminderSettings {
  enabled: boolean;
  /** Company-wide default minutes-before-last-cutoff — a room's own
   * `ReportTopic.remindBeforeCutoffMinutes` (room-settings-sheet.tsx) wins
   * over this when set, same "room override, company default" relationship
   * as `filesRetentionDays`. */
  leadMinutes: number[];
  notifyPending: boolean;
  /** One daily digest to whoever's responsible for a room, on top of (not
   * instead of) nudging the people who still haven't posted. */
  notifyManagerSummary: boolean;
}

export interface TodoReminderSettings {
  enabled: boolean;
  /** A to-do is personal (only its own owner ever sees it), so there's no
   * "notify who" question the way task/meeting/report have — and it only
   * ever fires once, not a swept list of lead points. This is just what
   * AddTodoDialog pre-selects for a *new* to-do's own `reminderMinutes`;
   * each one still keeps its own value and can be changed or turned off
   * right there, same as always. */
  defaultLeadMinutes: number;
}

export interface ReminderSettings {
  task: TaskReminderSettings;
  meeting: MeetingReminderSettings;
  report: ReportReminderSettings;
  todo: TodoReminderSettings;
}

export const defaultReminderSettings: ReminderSettings = {
  task: { enabled: true, leadDays: [3, 1], notifyAssignee: true, notifyAssigner: false, notifyDeptHead: false },
  meeting: { enabled: true, leadMinutes: [15], notifyAttendees: true },
  report: { enabled: true, leadMinutes: [30], notifyPending: true, notifyManagerSummary: false },
  todo: { enabled: true, defaultLeadMinutes: 0 },
};

interface ReminderSettingsStore {
  settings: ReminderSettings;
  setTaskSettings: (patch: Partial<TaskReminderSettings>) => void;
  setMeetingSettings: (patch: Partial<MeetingReminderSettings>) => void;
  setReportSettings: (patch: Partial<ReportReminderSettings>) => void;
  setTodoSettings: (patch: Partial<TodoReminderSettings>) => void;
}

// Server-synced via ServerStoreSync (apiKey "reminder-settings") in
// store-hydrator.tsx — company-wide (owner-configured), not per-browser.
export const useReminderSettingsStore = create<ReminderSettingsStore>()((set) => ({
  settings: defaultReminderSettings,
  setTaskSettings: (patch) => set((s) => ({ settings: { ...s.settings, task: { ...s.settings.task, ...patch } } })),
  setMeetingSettings: (patch) => set((s) => ({ settings: { ...s.settings, meeting: { ...s.settings.meeting, ...patch } } })),
  setReportSettings: (patch) => set((s) => ({ settings: { ...s.settings, report: { ...s.settings.report, ...patch } } })),
  setTodoSettings: (patch) => set((s) => ({ settings: { ...s.settings, todo: { ...s.settings.todo, ...patch } } })),
}));
