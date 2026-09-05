"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { relativeTime } from "@/modules/report_task/lib/format";
import { ReportNotificationSync } from "@/modules/report_task/components/shared/report-notification-sync";

/**
 * report_task's own notifications (@mentions, replies on your posts, task
 * reviews, issue tickets, ...) rendered on the shared /notifications page —
 * that page otherwise only ever showed the maintenance module's notify
 * table, so anything from report_task silently never appeared here even
 * though the bell counted it (see report-notification-sync.tsx).
 */
export function ReportTaskNotificationsSection() {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const notifications = useNotificationStore((s) => s.notifications);
  const markAllRead = useNotificationStore((s) => s.markAllRead);

  const mine = notifications
    .filter((n) => n.userId === viewingAsUserId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (mine.length === 0) return <ReportNotificationSync />;

  const hasUnread = mine.some((n) => !n.read);

  return (
    <div className="mb-6">
      <ReportNotificationSync />
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-(--ink-soft)">รายงานและงาน</h2>
        {hasUnread && (
          <button
            type="button"
            onClick={() => markAllRead(viewingAsUserId)}
            className="text-xs font-medium text-(--brand-green-dark) hover:underline"
          >
            อ่านทั้งหมดแล้ว
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {mine.map((n) => {
          const row = (
            <div
              className="flex items-start gap-3 rounded-lg border border-(--line) bg-(--bg) p-4"
              style={!n.read ? { backgroundColor: "color-mix(in srgb, var(--brand-green) 6%, transparent)" } : undefined}
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: !n.read ? "var(--accent)" : "#E5E7EB" }}
              >
                <MessageSquare className="h-5 w-5" style={{ color: !n.read ? "var(--brand-green-dark)" : "#9CA3AF" }} />
              </span>
              <div className="min-w-0 flex-1">
                {n.topicName && (
                  <span className="mb-1 inline-block rounded-full bg-(--bg-soft) px-2 py-0.5 text-[11px] font-medium text-(--ink-soft)">
                    {n.topicName}
                  </span>
                )}
                <p className="text-sm text-(--ink)" style={!n.read ? { fontWeight: 700 } : undefined}>
                  {n.message}
                </p>
                <p className="mt-1 text-[11px] text-(--ink-soft)">{relativeTime(n.createdAt)}</p>
              </div>
              {!n.read && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-(--danger)" />}
            </div>
          );
          return n.link ? (
            <Link key={n.id} href={n.link} className="block">
              {row}
            </Link>
          ) : (
            <div key={n.id}>{row}</div>
          );
        })}
      </div>
    </div>
  );
}
