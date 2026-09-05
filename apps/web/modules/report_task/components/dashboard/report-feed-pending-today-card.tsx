"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { ShowMoreToggle } from "@/modules/report_task/components/shared/show-more-toggle";
import { useShowMore } from "@/modules/report_task/hooks/use-show-more";
import { cn } from "@/modules/report_task/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Button } from "@/modules/report_task/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/modules/report_task/components/ui/alert-dialog";
import { reportBacklogEntries, type ReportBacklogEntry } from "@/modules/report_task/lib/report-feed-compliance";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { previousPeriodRange, periodTrend } from "@/modules/report_task/lib/dashboard-trend";
import { TrendText } from "@/modules/report_task/components/shared/trend-badge";
import { localDateStr, todayIso } from "@/modules/report_task/lib/now";
import { getUser, getDepartment, canManage } from "@/modules/report_task/lib/directory";
import { Bell, FileClock } from "lucide-react";

/**
 * "รายงานที่ยังไม่ส่ง" — daily-check-in model: today's misses are still
 * actionable (nudge-able), every earlier day's miss is permanent history
 * (compliance score already docked it via the penalty sweep). Twin of
 * EscalationsPanel — same card shell, same canManage-gated action button.
 */
export function ReportFeedPendingTodayCard() {
  const router = useRouter();
  const topics = useVisibleReportTopics();
  const posts = useReportFeedStore((s) => s.posts);
  const exemptions = useReportComplianceExemptions();
  const notify = useNotificationStore((s) => s.notify);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  const range = presetRange(preset, customFrom, customTo);
  const [pendingNudge, setPendingNudge] = useState<ReportBacklogEntry | null>(null);

  // "today" only shows up as postable inside `pending` (see
  // reportBacklogEntries) when the filter's range actually reaches today —
  // a pure-past range (เมื่อวาน, เดือนที่แล้ว, ...) already comes back with
  // an empty pending bucket. Still branch on it explicitly so the header
  // itself reframes to "history only" instead of just showing an empty section.
  const rangeHasToday = !range || (todayIso() >= localDateStr(range.from) && todayIso() <= localDateStr(range.to));

  const { pending, missed } = useMemo(() => {
    const all = reportBacklogEntries(topics, posts, range, exemptions);
    const scoped = (list: ReportBacklogEntry[]) =>
      list.filter((e) => {
        if (personId !== "all") return e.userId === personId;
        if (departmentId !== "all") return getUser(e.userId)?.departmentId === departmentId;
        return true;
      });
    return { pending: scoped(all.pending), missed: scoped(all.missed) };
  }, [topics, posts, range, exemptions, personId, departmentId]);

  const missedByUser = useMemo(() => {
    const counts = new Map<
      string,
      { userId: string; userName: string; userAvatar: string; userAvatarUrl: string | null; count: number }
    >();
    for (const e of missed) {
      const row = counts.get(e.userId);
      if (row) row.count += 1;
      else
        counts.set(e.userId, {
          userId: e.userId,
          userName: e.userName,
          userAvatar: e.userAvatar,
          userAvatarUrl: e.userAvatarUrl,
          count: 1,
        });
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
  }, [missed]);

  const pendingShowMore = useShowMore(pending, 5);
  const missedShowMore = useShowMore(missedByUser, 5);

  const total = pending.length + missed.length;

  // Same previous-period comparison as EscalationsPanel's own trend — "more
  // pending/missed than last period" reads as worse, not better, so
  // higherIsGood is false. null (no comparison shown) for the unbounded
  // "ทั้งหมด" preset.
  const trend = useMemo(() => {
    const prevRange = previousPeriodRange(preset, customFrom, customTo);
    if (!prevRange) return null;
    const prevAll = reportBacklogEntries(topics, posts, prevRange, exemptions);
    const scoped = (list: ReportBacklogEntry[]) =>
      list.filter((e) => {
        if (personId !== "all") return e.userId === personId;
        if (departmentId !== "all") return getUser(e.userId)?.departmentId === departmentId;
        return true;
      });
    const prevTotal = scoped(prevAll.pending).length + scoped(prevAll.missed).length;
    return periodTrend(total, prevTotal);
  }, [topics, posts, preset, customFrom, customTo, exemptions, personId, departmentId, total]);

  // Same scope-badge pattern as EscalationsPanel ("งานที่เลยกำหนด") — a
  // colored pill in the header naming who this card is scoped to.
  const canPickScope = personId === "all";
  const scopeBadgeLabel = departmentId === "all" ? "ทั้งองค์กร" : `ทีม${getDepartment(departmentId)?.name}`;

  function confirmNudge() {
    if (!pendingNudge) return;
    notify({
      userId: pendingNudge.userId,
      byUserId: viewingAsUserId,
      message: `คุณยังไม่ส่งรายงาน "${pendingNudge.topicName}" วันนี้`,
      link: `/report-feed?topic=${pendingNudge.topicId}`,
      topicName: pendingNudge.topicName,
    });
    setPendingNudge(null);
  }

  return (
    <Card className={cn(DASHBOARD_CARD, "h-full flex flex-col", "border-[var(--chart-amber)]/20")}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <FileClock className="h-4.5 w-4.5 text-[var(--chart-amber)]" />
          {rangeHasToday ? "รายงานที่ยังไม่ส่ง" : "รายงานที่เลยกำหนด"}
          {total > 0 && (
            <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
              {total}
            </span>
          )}
        </CardTitle>
        {trend && (
          <div className="mt-1">
            <TrendText trend={trend} higherIsGood={false} />
          </div>
        )}
        {/* See EscalationsPanel's own CardAction comment — CardHeader is a
            grid, not flex; CardAction's data-slot is what actually pins
            this to the top-right corner instead of stacking as a second
            row under the title. */}
        <CardAction>
          <Badge variant="outline" className="text-[10px] bg-amber-50 text-[var(--chart-amber)] border-amber-200">
            {canPickScope ? scopeBadgeLabel : getUser(personId)?.name}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1">
        {total === 0 && (
          <p className="text-sm text-[var(--ink-soft)] py-8 text-center">ส่งรายงานครบแล้ว ✨</p>
        )}

        {rangeHasToday && pending.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between px-1 pt-1 pb-1.5">
              <p className="text-[11px] font-semibold text-[var(--chart-amber)] uppercase tracking-wide">
                {pending.length} คน ยังไม่ส่งวันนี้
              </p>
            </div>
            {pendingShowMore.visible.map((e) => {
              return (
                <PendingRow
                  // Phase 1.1: one entry per still-pending round, so a
                  // 2-round room's same user/topic/day can appear twice —
                  // the key needs roundId too, or React collapses them.
                  key={`${e.userId}-${e.topicId}-${e.day}-${e.roundId}`}
                  entry={e}
                  canNudge={canManage(viewingAsUserId)}
                  onOpen={() => router.push(`/report-feed?topic=${e.topicId}`)}
                  onNudge={() => setPendingNudge(e)}
                />
              );
            })}
            <ShowMoreToggle expanded={pendingShowMore.expanded} remaining={pendingShowMore.remaining} onToggle={pendingShowMore.toggle} />
          </div>
        )}

        {missed.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-[var(--chart-red)] uppercase tracking-wide px-1 pt-1 pb-1.5">
              {rangeHasToday ? "ประวัติเลยกำหนด" : "รายงานที่เลยกำหนด"} ({missed.length})
            </p>
            {missedShowMore.visible.map((row) => (
              <div
                key={row.userId}
                className="flex items-center gap-2 py-2 border-b last:border-0 border-[var(--line)] -mx-1 px-1"
              >
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarImage src={row.userAvatarUrl ?? undefined} alt={row.userName} />
                  <AvatarFallback className="text-[10px] bg-[var(--bg-soft)] text-[var(--ink)]">{row.userAvatar}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium truncate min-w-0 flex-1">{row.userName}</span>
                <Badge variant="outline" className="text-[10px] bg-red-50 text-[var(--chart-red)] border-red-200 shrink-0">
                  เลยกำหนด {row.count} ครั้ง
                </Badge>
              </div>
            ))}
            <ShowMoreToggle expanded={missedShowMore.expanded} remaining={missedShowMore.remaining} onToggle={missedShowMore.toggle} />
            <p className="text-[11px] text-[var(--ink-soft)] mt-2 px-1">เลยกำหนดแล้ว ถูกตัดคะแนน แต่ยังสามารถส่งได้</p>
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!pendingNudge} onOpenChange={(open) => !open && setPendingNudge(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Bell className="h-4.5 w-4.5 text-[var(--chart-amber)]" /> เตือนส่งรายงาน
            </AlertDialogTitle>
            <AlertDialogDescription>
              ส่งการแจ้งเตือนให้ <span className="font-medium text-[var(--ink)]">{pendingNudge?.userName}</span> ว่ายังไม่ส่งรายงาน &ldquo;
              {pendingNudge?.topicName}&rdquo; วันนี้?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={confirmNudge}>ส่งเตือน</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function PendingRow({
  entry: e,
  canNudge,
  onOpen,
  onNudge,
}: {
  entry: ReportBacklogEntry;
  canNudge: boolean;
  onOpen: () => void;
  onNudge: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onOpen();
        }
      }}
      className="flex items-start justify-between gap-2 py-2.5 border-b last:border-0 border-[var(--line)] cursor-pointer hover:bg-[var(--bg-soft)] transition-colors -mx-1 px-1 rounded-lg"
    >
      <Avatar className="h-7 w-7 shrink-0 mt-0.5">
        <AvatarImage src={e.userAvatarUrl ?? undefined} alt={e.userName} />
        <AvatarFallback className="text-[10px] bg-[var(--bg-soft)] text-[var(--ink)]">{e.userAvatar}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium truncate min-w-0">{e.userName}</span>
          <span className="text-xs shrink-0 whitespace-nowrap text-[var(--chart-amber)]">{e.topicName}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <Badge variant="secondary" className="text-[10px] font-normal">
            {e.departmentName}
          </Badge>
          {/* Phase 1.1: this is now specifically the round this entry is for
              (not the room's blanket last cutoff), so a 2-round room's two
              rows read distinctly instead of both saying the same time. */}
          <span className="text-[11px] text-[var(--ink-soft)]">{e.roundLabel} · ปิดรับ {e.roundTime}</span>
        </div>
      </div>
      {canNudge && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-amber-200 text-[var(--chart-amber)] hover:bg-amber-50 h-7 px-2 text-xs"
          onClick={(ev) => {
            ev.stopPropagation();
            onNudge();
          }}
        >
          <Bell className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
