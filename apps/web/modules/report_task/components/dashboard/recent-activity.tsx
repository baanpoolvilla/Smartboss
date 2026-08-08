"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD, DASHBOARD_LIST_CARD_H, DASHBOARD_LIST_SCROLL } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { getUser } from "@/modules/report_task/data/mock";
import { relativeTime } from "@/modules/report_task/lib/format";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { useActivityLogStore } from "@/modules/report_task/store/activity-log-store";
import { cn } from "@/modules/report_task/lib/utils";

export function RecentActivity() {
  const personId = useDashboardFilterStore((s) => s.personId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  // The real, server-synced audit trail (also shown in full on /activity-log)
  // — not data/mock.ts's `activity`, which is static demo data generated
  // once against a hardcoded "today" and drifts further into the past every
  // day the app stays deployed, so it stops being "recent" at all.
  const entries = useActivityLogStore((s) => s.entries);

  const items = useMemo(() => {
    const range = presetRange(preset, customFrom, customTo);
    return entries
      .filter((a) => {
        if (personId !== "all" && a.userId !== personId) return false;
        if (range) {
          const at = new Date(a.createdAt).getTime();
          if (at < range.from.getTime() || at > range.to.getTime()) return false;
        }
        return true;
      })
      .slice(0, 8);
  }, [entries, personId, preset, customFrom, customTo]);

  return (
    <Card className={cn(DASHBOARD_CARD, DASHBOARD_LIST_CARD_H)}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
          กิจกรรมล่าสุด
          {items.length > 0 && (
            <Badge variant="outline" className="border-transparent text-[var(--ink-soft)] bg-[var(--bg-soft)] font-normal">
              {items.length}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-[var(--ink-soft)]">8 รายการล่าสุดตามตัวกรองด้านบน</p>
      </CardHeader>
      <CardContent className={DASHBOARD_LIST_SCROLL}>
        {items.length === 0 && (
          <p className="text-sm text-[var(--ink-soft)] py-6 text-center">ไม่มีกิจกรรมในช่วงนี้</p>
        )}
        <ol className="relative space-y-4 before:absolute before:left-[15px] before:top-1 before:bottom-1 before:w-px before:bg-[var(--line)]">
          {items.map((a) => {
            const user = getUser(a.userId);
            return (
              <li key={a.id} className="relative flex gap-3 pl-0">
                <Avatar className="h-8 w-8 shrink-0 ring-4 ring-white z-10">
                  <AvatarFallback className="text-[10px] bg-[var(--bg-soft)] text-[var(--ink)]">
                    {user?.avatar}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 pt-1">
                  <p className="text-sm">
                    <span className="font-medium">{user?.name}</span>{" "}
                    <span className="text-[var(--ink-soft)]">{a.action}</span>{" "}
                    <span className="font-medium">{a.target}</span>
                  </p>
                  <p className="text-xs text-[var(--ink-soft)] mt-0.5">{relativeTime(a.createdAt)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
