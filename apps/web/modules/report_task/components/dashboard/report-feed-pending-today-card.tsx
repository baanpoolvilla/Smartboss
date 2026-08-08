"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD, DASHBOARD_LIST_CARD_H, DASHBOARD_LIST_SCROLL } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { cn } from "@/modules/report_task/lib/utils";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { pendingToday } from "@/modules/report_task/lib/report-feed-compliance";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { getUser } from "@/modules/report_task/data/mock";
import { FileClock } from "lucide-react";

/**
 * Replaces the old "รอส่งรายงาน" (last-3-days window, missed vs attachment
 * tabs) and "อันดับการส่งรายงาน" (leaderboard) cards — both read as
 * confusing/broken in practice (the owner showed up as "missed" in every
 * department's room, see mustReportToTopic) and the last-3-days window
 * wasn't the question anyone actually had. This is the plain question
 * instead: who, right now today, hasn't posted in a room they're expected
 * to.
 */
export function ReportFeedPendingTodayCard() {
  const topics = useVisibleReportTopics();
  const posts = useReportFeedStore((s) => s.posts);
  const exemptions = useReportComplianceExemptions();
  // Same top-bar filter every other dashboard widget reads — this card just
  // never wired it up, so switching "ทุกคน"/department up top silently did
  // nothing here while every other card narrowed down.
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);

  const entries = useMemo(() => {
    const all = pendingToday(topics, posts, exemptions);
    return all.filter((e) => {
      if (personId !== "all") return e.userId === personId;
      if (departmentId !== "all") return getUser(e.userId)?.departmentId === departmentId;
      return true;
    });
  }, [topics, posts, exemptions, personId, departmentId]);

  return (
    <Card className={cn(DASHBOARD_CARD, DASHBOARD_LIST_CARD_H)}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <FileClock className="h-4.5 w-4.5 text-[var(--chart-pink)]" />
            ยังไม่ส่งวันนี้
          </span>
          {entries.length > 0 && (
            <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
              {entries.length}
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-[var(--ink-soft)]">ใครยังไม่โพสต์ในห้องที่ต้องส่งวันนี้ — ไม่นับวันลา/วันหยุด</p>
      </CardHeader>
      <CardContent className={DASHBOARD_LIST_SCROLL}>
        {entries.length === 0 && (
          <p className="text-sm text-[var(--ink-soft)] py-8 text-center">ทุกคนส่งรายงานวันนี้ครบแล้ว 🎉</p>
        )}
        {entries.map((e) => (
          <div
            key={`${e.userId}-${e.topicId}`}
            className="flex items-start justify-between gap-2 py-2.5 border-b last:border-0 border-[var(--line)] -mx-1 px-1"
          >
            <Avatar className="h-7 w-7 shrink-0 mt-0.5">
              <AvatarFallback className="text-[10px] bg-[var(--bg-soft)] text-[var(--ink)]">{e.userAvatar}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium truncate min-w-0">{e.userName}</span>
                <span className="text-xs text-[var(--ink-soft)] shrink-0 whitespace-nowrap">{e.topicName}</span>
              </div>
              <div className="mt-1">
                <Badge variant="secondary" className="text-[10px] font-normal">
                  {e.departmentName}
                </Badge>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
