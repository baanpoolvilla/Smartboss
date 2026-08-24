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
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
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
import { useReminderSettingsStore } from "@/modules/report_task/store/reminder-settings-store";
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
 */
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
        store={useStickerStore}
        select={(s) => s.stickers}
        apply={(s, stickers) => ({ ...s, stickers })}
      />
      <ServerStoreSync
        apiKey="penalty-settings"
        store={usePenaltySettingsStore}
        select={(s) => s.defaultPoints}
        apply={(s, defaultPoints) => ({ ...s, defaultPoints })}
      />
      <ServerStoreSync
        apiKey="attachment-settings"
        store={useAttachmentSettingsStore}
        select={(s) => s.settings}
        apply={(s, settings) => ({ ...s, settings })}
      />
      <ServerStoreSync
        apiKey="ai-insight-settings"
        store={useAiInsightSettingsStore}
        select={(s) => s.settings}
        apply={(s, settings) => ({ ...s, settings })}
      />
      <ServerStoreSync
        apiKey="reminder-settings"
        store={useReminderSettingsStore}
        select={(s) => s.settings}
        apply={(s, settings) => ({ ...s, settings })}
      />
      <ServerStoreSync
        apiKey="meetings"
        store={useMeetingStore}
        select={(s) => s.meetings}
        apply={(s, meetings) => ({ ...s, meetings })}
      />
      <ServerStoreSync
        apiKey="leaves"
        store={useLeaveStore}
        select={(s) => s.leaves}
        apply={(s, leaves) => ({ ...s, leaves })}
      />
      <ServerStoreSync
        apiKey="todos"
        store={useTodoStore}
        select={(s) => s.todos}
        apply={(s, todos) => ({ ...s, todos })}
      />
      <ServerStoreSync
        apiKey="holidays"
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
        store={useLeaveTypeStore}
        select={(s) => s.types}
        apply={(s, types) => ({ ...s, types })}
      />
      <ServerStoreSync
        apiKey="project-topics"
        store={useProjectTopicStore}
        select={(s) => s.topics}
        apply={(s, topics) => ({ ...s, topics })}
      />
      <ServerStoreSync
        apiKey="report-feed"
        store={useReportFeedStore}
        select={(s) => ({ topics: s.topics, posts: s.posts, albums: s.albums })}
        apply={(s, slice) => ({ ...s, ...slice, loaded: true })}
      />
      <ServerStoreSync
        apiKey="report-tags"
        store={useReportTagStore}
        select={(s) => s.tags}
        apply={(s, tags) => ({ ...s, tags })}
      />
      <ServerStoreSync
        apiKey="issue-reports"
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
        store={useIssueDeskConfigStore}
        select={(s) => s.config}
        apply={(s, config) => ({ ...s, config })}
      />
      <ServerStoreSync
        apiKey="departments"
        store={useDepartmentStore}
        select={(s) => s.departments}
        apply={(s, departments) => ({ ...s, departments })}
      />
      <ServerStoreSync
        apiKey="employees"
        store={useEmployeeStore}
        select={(s) => s.employees}
        apply={(s, employees) => ({ ...s, employees })}
      />
      <ServerStoreSync
        apiKey="people-groups"
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
        store={useActivityLogStore}
        select={(s) => s.entries}
        apply={(s, entries) => ({ ...s, entries })}
      />
      <ServerStoreSync
        apiKey="routine-dayoff"
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
        store={useSettingsAccessStore}
        select={(s) => s.grants}
        apply={(s, grants) => ({ ...s, grants })}
      />
    </>
  );
}
