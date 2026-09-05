"use client";

import { useEffect } from "react";
import { useDashboardLayoutStore } from "@/modules/report_task/store/dashboard-layout-store";
import { useCalendarVisibilityStore } from "@/modules/report_task/store/calendar-visibility-store";
import { useGoogleCalendarStore } from "@/modules/report_task/store/google-calendar-store";
import { useEmailNotificationSettingsStore } from "@/modules/report_task/store/email-notification-settings-store";
import { useWhatsNewStore } from "@/modules/report_task/store/whats-new-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";

import { ServerStoreSync } from "./server-store-sync";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { usePenaltySettingsStore } from "@/modules/report_task/store/penalty-settings-store";
import { useMeetingStore } from "@/modules/report_task/store/meeting-store";
import { useLeaveStore } from "@/modules/report_task/store/leave-store";
import { useTodoStore } from "@/modules/report_task/store/todo-store";
import { useHolidayStore } from "@/modules/report_task/store/holiday-store";
import { thaiHolidayEvents } from "@/modules/report_task/data/thai-holidays";
import { useLeaveTypeStore } from "@/modules/report_task/store/leave-type-store";
import { useProjectTopicStore } from "@/modules/report_task/store/project-topic-store";
import { useReportFeedStore, normalizeReportFeedSlice } from "@/modules/report_task/store/report-feed-store";
import { useReportTagStore } from "@/modules/report_task/store/report-tag-store";
import { useIssueReportStore, migrateIssueStoreSlice, extractV1RecipientDepartmentIds } from "@/modules/report_task/store/issue-report-store";
import { useIssueDeskConfigStore } from "@/modules/report_task/store/issue-desk-config-store";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { usePeopleGroupStore } from "@/modules/report_task/store/people-group-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useActivityLogStore } from "@/modules/report_task/store/activity-log-store";
import { useRoutineDayOffStore } from "@/modules/report_task/store/routine-dayoff-store";
import { useSettingsAccessStore } from "@/modules/report_task/store/settings-access-store";
import { useAttachmentSettingsStore } from "@/modules/report_task/store/attachment-settings-store";
import { useTaskReviewSettingsStore } from "@/modules/report_task/store/task-review-settings-store";
import { useReminderSettingsStore, defaultReminderSettings } from "@/modules/report_task/store/reminder-settings-store";
import { useAiInsightSettingsStore } from "@/modules/report_task/store/ai-insight-settings-store";

/**
 * Two kinds of state get hydrated here:
 *
 * - Per-user view preferences (layout, visibility toggles, email prefs, the
 *   Google/ICS connection cache) still use zustand's `persist` + localStorage
 *   with `skipHydration` — those stay per-browser on purpose, so they're
 *   rehydrated the old way below.
 * - Everything shared across teammates (tasks excluded — see TaskSync) is
 *   now server-backed via `ServerStoreSync` instead of localStorage — see
 *   README "Data model" and C4 in the production-readiness audit.
 *
 * Each `ServerStoreSync` below polls independently to pick up a teammate's
 * save without anyone refreshing — with 20+ of these mounted at once, the
 * default 4s interval on every single one adds up to real background load
 * for stores nobody actually edits concurrently. `pollMs` is tiered instead:
 *   - unset (4s default) — report-feed, notifications: people genuinely
 *     collide on these and expect to see each other's changes live
 *   - MEDIUM_POLL_MS — meetings/leaves/todos/issue-reports/activity-log:
 *     occasionally edited by more than one person, but not to the second
 *   - SLOW_POLL_MS — everything else (company config, departments,
 *     employees, ...): changes rarely, and a conflicting save still merges
 *     correctly via the 409 path in ServerStoreSync regardless of poll rate
 *     — this only controls how fast *someone else's* save shows up passively
 */
const MEDIUM_POLL_MS = 15_000;
const SLOW_POLL_MS = 60_000;

export function StoreHydrator() {
  useEffect(() => {
    useDashboardLayoutStore.persist.rehydrate();
    useCalendarVisibilityStore.persist.rehydrate();
    useGoogleCalendarStore.persist.rehydrate();
    useEmailNotificationSettingsStore.persist.rehydrate();
    useWhatsNewStore.persist.rehydrate();
    useIdentityStore.persist.rehydrate();
  }, []);

  return (
    <>
      <ServerStoreSync
        apiKey="stickers"
        pollMs={SLOW_POLL_MS}
        store={useStickerStore}
        select={(s) => s.stickers}
        apply={(s, stickers) => ({ ...s, stickers })}
      />
      <ServerStoreSync
        apiKey="penalty-settings"
        pollMs={SLOW_POLL_MS}
        store={usePenaltySettingsStore}
        select={(s) => s.defaultPoints}
        apply={(s, defaultPoints) => ({ ...s, defaultPoints })}
      />
      <ServerStoreSync
        apiKey="attachment-settings"
        pollMs={SLOW_POLL_MS}
        store={useAttachmentSettingsStore}
        select={(s) => s.settings}
        apply={(s, settings) => ({ ...s, settings })}
      />
      <ServerStoreSync
        apiKey="task-review-settings"
        pollMs={SLOW_POLL_MS}
        store={useTaskReviewSettingsStore}
        select={(s) => s.settings}
        apply={(s, settings) => ({ ...s, settings })}
      />
      <ServerStoreSync
        apiKey="ai-insight-settings"
        pollMs={SLOW_POLL_MS}
        store={useAiInsightSettingsStore}
        select={(s) => s.settings}
        apply={(s, settings) => ({ ...s, settings })}
      />
      <ServerStoreSync
        apiKey="reminder-settings"
        pollMs={SLOW_POLL_MS}
        store={useReminderSettingsStore}
        select={(s) => s.settings}
        // Merged field-by-field, not spread straight in — a row saved before
        // `todo` existed on ReminderSettings has no such key at all, and
        // DeadlineReminderSettingsPanel reads `settings.todo.enabled`
        // unconditionally. A plain `{ ...s, settings }` would hand it
        // `undefined` and crash the whole panel on render.
        apply={(s, settings) => {
          // task.leadDays (whole days) → task.leadMinutes — a row saved
          // before tasks could have a due *time* only ever had day-count
          // points; ×1440 keeps every existing company's reminder points
          // firing at the exact same moments they always did, rather than
          // silently resetting to the default on the next load.
          const rawTask = settings?.task as (Partial<import("@/modules/report_task/store/reminder-settings-store").TaskReminderSettings> & { leadDays?: number[] }) | undefined;
          const migratedLeadMinutes = rawTask?.leadMinutes ?? rawTask?.leadDays?.map((d) => d * 1440);
          return {
            ...s,
            settings: {
              task: { ...defaultReminderSettings.task, ...rawTask, ...(migratedLeadMinutes ? { leadMinutes: migratedLeadMinutes } : {}) },
              meeting: { ...defaultReminderSettings.meeting, ...settings?.meeting },
              report: { ...defaultReminderSettings.report, ...settings?.report },
              todo: { ...defaultReminderSettings.todo, ...settings?.todo },
            },
          };
        }}
      />
      <ServerStoreSync
        apiKey="meetings"
        pollMs={MEDIUM_POLL_MS}
        store={useMeetingStore}
        select={(s) => s.meetings}
        apply={(s, meetings) => ({ ...s, meetings })}
      />
      <ServerStoreSync
        apiKey="leaves"
        pollMs={MEDIUM_POLL_MS}
        store={useLeaveStore}
        select={(s) => s.leaves}
        apply={(s, leaves) => ({ ...s, leaves })}
      />
      <ServerStoreSync
        apiKey="todos"
        pollMs={MEDIUM_POLL_MS}
        store={useTodoStore}
        select={(s) => s.todos}
        apply={(s, todos) => ({ ...s, todos })}
      />
      <ServerStoreSync
        apiKey="holidays"
        pollMs={SLOW_POLL_MS}
        store={useHolidayStore}
        select={(s) => ({ holidays: s.holidays, selectedByUser: s.selectedByUser })}
        // The server row is whatever was last saved — if it predates a fixed
        // Thai holiday being added to thai-holidays.ts (e.g. the 2026 dates),
        // it silently overwrites the code's up-to-date seed with a stale,
        // narrower list and the country's holidays just stop appearing.
        // Union any built-in event missing by id back in on every load
        // instead of trusting the server row alone.
        apply={(s, slice) => {
          const existingIds = new Set(slice.holidays.map((h) => h.id));
          const missingBuiltIns = thaiHolidayEvents.filter((h) => !existingIds.has(h.id));
          return { ...s, ...slice, holidays: [...slice.holidays, ...missingBuiltIns] };
        }}
      />
      <ServerStoreSync
        apiKey="leave-types"
        pollMs={SLOW_POLL_MS}
        store={useLeaveTypeStore}
        select={(s) => s.types}
        apply={(s, types) => ({ ...s, types })}
      />
      <ServerStoreSync
        apiKey="project-topics"
        pollMs={SLOW_POLL_MS}
        store={useProjectTopicStore}
        select={(s) => s.topics}
        apply={(s, topics) => ({ ...s, topics })}
      />
      <ServerStoreSync
        apiKey="report-feed"
        store={useReportFeedStore}
        select={(s) => ({ topics: s.topics, posts: s.posts, albums: s.albums, pinnedLinks: s.pinnedLinks, submitterGroups: s.submitterGroups })}
        // Normalized, not spread straight in — a row written by something
        // other than this store (the demo seeding script, an older build) can
        // be missing an array field that every reader treats as always
        // present, and one such row crashes the whole รายงาน page during
        // render. See normalizeReportFeedSlice for the full reasoning.
        apply={(s, slice) => ({ ...s, ...normalizeReportFeedSlice(slice), loaded: true })}
      />
      <ServerStoreSync
        apiKey="report-tags"
        pollMs={SLOW_POLL_MS}
        store={useReportTagStore}
        select={(s) => s.tags}
        apply={(s, tags) => ({ ...s, tags })}
      />
      <ServerStoreSync
        apiKey="issue-reports"
        pollMs={MEDIUM_POLL_MS}
        store={useIssueReportStore}
        select={(s) => ({ schemaVersion: s.schemaVersion, tickets: s.tickets })}
        apply={(s, slice) => {
          // `slice` may still be the V1 shape (`{ reports, recipientDepartmentIds }`)
          // on a store that hasn't been touched since before this migration —
          // migrateIssueStoreSlice is a no-op once schemaVersion is current.
          const legacyDepts = extractV1RecipientDepartmentIds(slice);
          if (legacyDepts) useIssueDeskConfigStore.getState().setConfig({ recipientDepartmentIds: legacyDepts });
          return { ...s, ...migrateIssueStoreSlice(slice) };
        }}
      />
      <ServerStoreSync
        apiKey="issue-desk-config"
        pollMs={SLOW_POLL_MS}
        store={useIssueDeskConfigStore}
        select={(s) => s.config}
        apply={(s, config) => ({ ...s, config })}
      />
      <ServerStoreSync
        apiKey="departments"
        pollMs={SLOW_POLL_MS}
        store={useDepartmentStore}
        select={(s) => s.departments}
        apply={(s, departments) => ({ ...s, departments })}
      />
      <ServerStoreSync
        apiKey="employees"
        pollMs={SLOW_POLL_MS}
        store={useEmployeeStore}
        select={(s) => s.employees}
        apply={(s, employees) => ({ ...s, employees })}
      />
      <ServerStoreSync
        apiKey="people-groups"
        pollMs={SLOW_POLL_MS}
        store={usePeopleGroupStore}
        select={(s) => s.groups}
        apply={(s, groups) => ({ ...s, groups })}
      />
      <ServerStoreSync
        apiKey="notifications"
        store={useNotificationStore}
        select={(s) => s.notifications}
        apply={(s, notifications) => ({ ...s, notifications })}
      />
      <ServerStoreSync
        apiKey="activity-log"
        pollMs={MEDIUM_POLL_MS}
        store={useActivityLogStore}
        select={(s) => s.entries}
        apply={(s, entries) => ({ ...s, entries })}
      />
      <ServerStoreSync
        apiKey="routine-dayoff"
        pollMs={SLOW_POLL_MS}
        store={useRoutineDayOffStore}
        select={(s) => ({
          companyMonthlyQuota: s.companyMonthlyQuota,
          useDepartmentOverrides: s.useDepartmentOverrides,
          departmentQuotas: s.departmentQuotas,
          pickedDates: s.pickedDates,
          rules: s.rules,
          ruleExceptions: s.ruleExceptions,
        })}
        apply={(s, slice) => ({ ...s, ...slice })}
      />
      <ServerStoreSync
        apiKey="settings-access"
        pollMs={SLOW_POLL_MS}
        store={useSettingsAccessStore}
        select={(s) => s.grants}
        apply={(s, grants) => ({ ...s, grants })}
      />
    </>
  );
}
