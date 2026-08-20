"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canManage, isOwner } from "@/modules/report_task/lib/directory";
import { canAccessCompanySection } from "@/modules/report_task/lib/permissions";
import { useSettingsAccessStore, type GrantableSection } from "@/modules/report_task/store/settings-access-store";
import { StickerManagerPanel } from "@/modules/report_task/components/shared/sticker-manager-dialog";
import { AttachmentSettingsPanel } from "@/modules/report_task/components/shared/attachment-settings-panel";
import { ProjectTopicSettingsPanel } from "@/modules/report_task/components/shared/project-topic-settings-panel";
import { LeaveTypeSettingsPanel } from "@/modules/report_task/components/calendar/leave-type-settings-dialog";
import { RoutineDayOffSettingsPanel } from "@/modules/report_task/components/calendar/routine-dayoff-settings-dialog";
import { LeaveSummaryPanel } from "@/modules/report_task/components/calendar/leave-summary-panel";
import { SettingsAccessPanel } from "@/modules/report_task/components/shared/settings-access-panel";
import { PermissionGuidePanel } from "@/modules/report_task/components/shared/permission-guide-panel";
import { DepartmentSettingsPanel, EmployeeSettingsPanel } from "@/modules/report_task/components/shared/org-settings-panel";
import { EmailNotificationSettingsPanel } from "@/modules/report_task/components/shared/email-notification-settings-dialog";
import { DeadlineReminderSettingsPanel } from "@/modules/report_task/components/shared/deadline-reminder-settings-panel";
import { HolidaysPane, GoogleCalendarPane } from "@/modules/report_task/components/calendar/add-calendar-dialog";
import { PageHeader } from "@/modules/report_task/components/shared/page-header";
import { IssueDeskConfigPanel } from "@/modules/report_task/components/issue-report/issue-desk-config-panel";
import { useIssueDeskConfigStore } from "@/modules/report_task/store/issue-desk-config-store";
import { canManageIssueDeskSettings } from "@/modules/report_task/lib/permissions";
import { cn } from "@/modules/report_task/lib/utils";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import {
  Bell,
  Bug,
  Building2,
  CalendarCheck2,
  CalendarDays,
  CalendarOff,
  ChevronRight,
  Globe,
  KanbanSquare,
  MessageSquareText,
  Paperclip,
  ShieldCheck,
  Smile,
  Tag,
  Ticket,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

type SettingsTab = "task" | "calendar" | "report" | "issueDesk" | "permissions" | "reminders" | "profile";

// Each top-level tab is one real page's admin settings — same page names as
// the sidebar nav (nav-config.ts) — so "which page does this control?" is
// never a guess. "สิทธิ์การเข้าถึง" is the one exception: access grants aren't
// about any single page, so they get their own tab instead of being buried
// under whichever page happened to have them first.
// Tinted with its own color instead of one flat brand-green fill — matches
// the "quiet tinted pill" pattern used for priority/department chips
// elsewhere, so the active tab reads at a glance.
const tabs: { key: SettingsTab; label: string; icon: LucideIcon; color: string }[] = [
  { key: "task", label: "งาน", icon: KanbanSquare, color: chartColors.blue },
  { key: "calendar", label: "ปฏิทิน", icon: CalendarDays, color: chartColors.green },
  { key: "report", label: "ห้อง Report", icon: MessageSquareText, color: chartColors.violet },
  { key: "issueDesk", label: "แจ้งปัญหา", icon: Bug, color: chartColors.teal },
  { key: "permissions", label: "สิทธิ์การเข้าถึง", icon: ShieldCheck, color: chartColors.red },
  { key: "reminders", label: "แจ้งเตือนใกล้ถึงกำหนด", icon: Bell, color: chartColors.orange },
  { key: "profile", label: "โปรไฟล์ของฉัน", icon: User, color: chartColors.amber },
];

interface Section {
  key: string;
  label: string;
  icon: LucideIcon;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const manager = canManage(viewingAsUserId);
  const owner = isOwner(viewingAsUserId);
  const settingsGrants = useSettingsAccessStore((s) => s.grants);
  const issueDeskConfig = useIssueDeskConfigStore((s) => s.config);
  const setIssueDeskConfig = useIssueDeskConfigStore((s) => s.setConfig);
  // Owner always sees every page's tab; a delegate (see settings-access-store)
  // sees only the page tab(s) they hold at least one granted section on.
  const hasTaskAccess = owner || canAccessCompanySection("stickers", viewingAsUserId, settingsGrants);
  const hasCalendarAccess =
    owner ||
    canAccessCompanySection("leaveTypes", viewingAsUserId, settingsGrants) ||
    canAccessCompanySection("routineDayoff", viewingAsUserId, settingsGrants);
  const hasIssueDeskAccess = canManageIssueDeskSettings(viewingAsUserId, settingsGrants);
  const accessByTab: Record<SettingsTab, boolean> = {
    task: hasTaskAccess,
    calendar: hasCalendarAccess,
    report: manager,
    issueDesk: hasIssueDeskAccess,
    permissions: owner,
    reminders: owner,
    profile: true,
  };

  const initialTab = (searchParams.get("tab") as SettingsTab | null) ?? "profile";
  const [tab, setTab] = useState<SettingsTab>(accessByTab[initialTab] ? initialTab : "profile");

  // `viewingAsUserId` now hydrates from localStorage a tick after mount (see
  // identity-store.ts's `persist`), so the very first render here still sees
  // the pre-hydration default identity — `owner` reads false on that render
  // even for someone who'll turn out to be the owner, silently bumping a
  // `?tab=issueDesk` link back to "profile" before hydration lands. Once
  // access to the requested tab actually shows up, jump to it — but only
  // once, so this doesn't fight a manual tab click made in the meantime.
  const syncedInitialTabRef = useRef(false);
  useEffect(() => {
    if (!syncedInitialTabRef.current && accessByTab[initialTab]) {
      syncedInitialTabRef.current = true;
      setTab(initialTab);
    }
  });

  const visibleTabs = tabs.filter((t) => accessByTab[t.key]);

  // Each tab is broken into single-topic sections — only one renders at a
  // time in the content area, instead of every section stacked and forcing
  // a long scroll to reach the one you actually came for. The grantable
  // sections on the task/calendar tabs are further filtered per-viewer: the
  // owner sees all of them (plus the owner-only leave summary), a delegate
  // only sees the specific section(s) they were granted.
  const taskGrantableSections: { key: GrantableSection; label: string; icon: LucideIcon }[] = [
    { key: "stickers", label: "สติกเกอร์ & คะแนน", icon: Smile },
    { key: "attachments", label: "ไฟล์แนบ", icon: Paperclip },
    { key: "projectTopics", label: "หัวข้อโปรเจค", icon: Tag },
  ];
  const calendarGrantableSections: { key: GrantableSection; label: string; icon: LucideIcon }[] = [
    { key: "leaveTypes", label: "ประเภทการลา", icon: Ticket },
    { key: "routineDayoff", label: "วันหยุดประจำ", icon: CalendarOff },
  ];
  const sectionsByTab: Record<SettingsTab, Section[]> = {
    task: taskGrantableSections.filter((s) => canAccessCompanySection(s.key, viewingAsUserId, settingsGrants)),
    calendar: [
      ...calendarGrantableSections.filter((s) => canAccessCompanySection(s.key, viewingAsUserId, settingsGrants)),
      ...(owner ? [{ key: "leaveSummary", label: "สรุปวันลาพนักงาน", icon: CalendarDays }] : []),
    ],
    report: [{ key: "reportRoom", label: "ตั้งค่าห้อง", icon: MessageSquareText }],
    issueDesk: [{ key: "issueDeskConfig", label: "ตั้งค่าแจ้งปัญหา", icon: Bug }],
    permissions: owner
      ? [
          { key: "guide", label: "ใครเห็น/ทำอะไรได้บ้าง", icon: ShieldCheck },
          { key: "accessControl", label: "สิทธิ์การตั้งค่า", icon: ShieldCheck },
          { key: "departments", label: "จัดการแผนก", icon: Building2 },
          { key: "employees", label: "จัดการพนักงาน", icon: Users },
        ]
      : [],
    reminders: owner ? [{ key: "deadlineReminders", label: "แจ้งเตือนใกล้ถึงกำหนด", icon: Bell }] : [],
    profile: [
      { key: "email", label: "แจ้งเตือนอีเมล", icon: Bell },
      { key: "holidays", label: "วันหยุดตามประเทศ", icon: Globe },
      { key: "externalCalendar", label: "ปฏิทินภายนอก", icon: CalendarCheck2 },
    ],
  };

  const currentSections = sectionsByTab[tab];
  // A deep link (e.g. "เพิ่มวันหยุดตามประเทศ" from the calendar) can name the
  // exact section it wants opened via ?section= — falls back to the tab's
  // first section when absent or when it doesn't belong to this tab.
  const initialSection = searchParams.get("section");
  const [sectionKey, setSectionKey] = useState<string>(
    initialSection && currentSections.some((s) => s.key === initialSection) ? initialSection : currentSections[0]?.key ?? ""
  );

  // Switching top-level tab lands on that tab's first section — adjusted
  // during render (not an effect) per React's guidance for resetting state
  // on a prop/derived-value change. The active section can also disappear
  // without a tab switch — e.g. the "กำลังดูในนามของ" identity switcher (this
  // demo's stand-in for real auth) changes which company sections a viewer
  // is granted (see settings-access-store) — so also fall back to the first
  // still-available section whenever the current one no longer exists for
  // this viewer, instead of leaving the content pane blank.
  const [lastTab, setLastTab] = useState(tab);
  if (tab !== lastTab) {
    setLastTab(tab);
    setSectionKey(currentSections[0]?.key ?? "");
  } else if (currentSections.length > 0 && !currentSections.some((s) => s.key === sectionKey)) {
    setSectionKey(currentSections[0]!.key);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="ตั้งค่า" subtitle="การตั้งค่าทั้งหมดของระบบ รวมไว้ที่เดียว" />

      <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
        <div className="w-full lg:w-64 lg:shrink-0 flex flex-col gap-1">
          {visibleTabs.map((t) => {
            const active = tab === t.key;
            const sections = sectionsByTab[t.key];
            return (
              <div key={t.key}>
                <button
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-left font-medium transition-colors",
                    !active && "text-[var(--ink)] hover:bg-[var(--bg-soft)]"
                  )}
                  style={
                    active
                      ? { backgroundColor: `color-mix(in srgb, ${t.color} 14%, white)`, color: t.color }
                      : undefined
                  }
                >
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-md shrink-0"
                    style={{
                      backgroundColor: active ? `color-mix(in srgb, ${t.color} 22%, white)` : `color-mix(in srgb, ${t.color} 12%, white)`,
                      color: t.color,
                    }}
                  >
                    <t.icon className="h-4 w-4" />
                  </span>
                  {t.label}
                </button>

                {active && sections.length > 1 && (
                  <div className="mt-0.5 ml-3.5 pl-3.5 border-l border-[var(--line)] flex flex-col gap-0.5">
                    {sections.map((s) => {
                      const sectionActive = sectionKey === s.key;
                      return (
                        <button
                          key={s.key}
                          onClick={() => setSectionKey(s.key)}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-left transition-colors",
                            sectionActive
                              ? "font-medium text-[var(--ink)] bg-[var(--bg-soft)]"
                              : "text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)]/60"
                          )}
                        >
                          <s.icon className="h-3.5 w-3.5 shrink-0" />
                          {s.label}
                          {sectionActive && <ChevronRight className="h-3 w-3 ml-auto shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex-1 min-w-0">
          {tab === "task" && hasTaskAccess && (
            <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
              {sectionKey === "stickers" && <StickerManagerPanel />}
              {sectionKey === "attachments" && <AttachmentSettingsPanel />}
              {sectionKey === "projectTopics" && <ProjectTopicSettingsPanel />}
            </section>
          )}

          {tab === "calendar" && hasCalendarAccess && (
            <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
              {sectionKey === "leaveTypes" && <LeaveTypeSettingsPanel />}
              {sectionKey === "routineDayoff" && <RoutineDayOffSettingsPanel />}
              {sectionKey === "leaveSummary" && owner && <LeaveSummaryPanel />}
            </section>
          )}

          {tab === "permissions" && owner && (
            <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
              {sectionKey === "guide" && <PermissionGuidePanel />}
              {sectionKey === "accessControl" && <SettingsAccessPanel />}
              {sectionKey === "departments" && <DepartmentSettingsPanel />}
              {sectionKey === "employees" && <EmployeeSettingsPanel />}
            </section>
          )}

          {tab === "report" && manager && (
            <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
              {/* Each room's settings live in that room now (⚙ icon, top
                  right of the room header) instead of duplicated here behind
                  a room picker — one place per room to edit, not two that
                  can drift out of sync with each other. */}
              <p className="text-sm text-[var(--ink)]">ตั้งค่าห้อง Report แต่ละห้องได้จากไอคอน ⚙ ในห้องนั้นๆ โดยตรง</p>
              <p className="text-xs text-[var(--ink-soft)] mt-1">เข้าห้องที่ต้องการ แล้วกดไอคอนรูปเฟืองมุมขวาบนของห้อง</p>
              <Link
                href="/report-task/report-feed"
                className="inline-flex items-center gap-1.5 mt-3 rounded-lg bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white text-sm font-medium px-3.5 py-2 transition-colors"
              >
                ไปที่หน้า Report
              </Link>
            </section>
          )}

          {tab === "issueDesk" && hasIssueDeskAccess && (
            <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
              <IssueDeskConfigPanel config={issueDeskConfig} setConfig={setIssueDeskConfig} />
            </section>
          )}

          {tab === "reminders" && owner && (
            <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
              {sectionKey === "deadlineReminders" && <DeadlineReminderSettingsPanel />}
            </section>
          )}

          {tab === "profile" && (
            <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
              {sectionKey === "email" && <EmailNotificationSettingsPanel />}
              {sectionKey === "holidays" && <HolidaysPane />}
              {sectionKey === "externalCalendar" && <GoogleCalendarPane />}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
