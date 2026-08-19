"use client";

import { reportKpiBuckets } from "@/modules/report_task/lib/kpi-buckets";
import {
  trackedTopicsOf,
  reportStatusCountsByUser,
  scopedUserIds,
} from "@/modules/report_task/lib/report-feed-compliance";
import { displayName } from "@/modules/report_task/lib/directory";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { previousPeriodRange } from "@/modules/report_task/lib/dashboard-trend";
import { rankedPeople } from "@/modules/report_task/lib/ranked-people";
import { MessageSquareText } from "lucide-react";
import { StatusOverviewDonut } from "./status-overview-donut";

type UserCounts = { onTime: number; lateDone: number; pending: number; missed: number; exempt: number };

/** `byUser[id][field]` for everyone in `ids`, as the personId->count map
 * `topPeopleOf`/`rankedPeople` both expect. */
function countsFor(byUser: Map<string, UserCounts>, ids: Set<string>, field: keyof UserCounts): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) {
    const n = byUser.get(id)?.[field] ?? 0;
    if (n > 0) m.set(id, n);
  }
  return m;
}

/** Everyone tied for the most reports in the given bucket among the users
 * in scope — named, for "ตัวปัญหาหลัก" to point at whoever's actually behind
 * the bucket instead of just a total. Usually one person; more than one
 * only when they're genuinely tied. */
function topPeopleOf(byUser: Map<string, UserCounts>, ids: Set<string>, field: "missed" | "pending"): { name: string; count: number }[] {
  const ranked = [...ids].map((id) => ({ id, count: byUser.get(id)?.[field] ?? 0 })).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  const topCount = ranked[0]?.count;
  return ranked.filter((r) => r.count === topCount).map((r) => ({ name: displayName(r.id), count: r.count }));
}

/** "ภาพรวมรายงาน (Report)" — the Analytics section's right twin of Task
 * Overview (§2.6, same StatusOverviewDonut shape, same 5-group buckets). */
export function ReportFeedStatusPie() {
  const topics = useVisibleReportTopics();
  const posts = useReportFeedStore((s) => s.posts);
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  const range = presetRange(preset, customFrom, customTo);
  const exemptions = useReportComplianceExemptions();

  const buckets = reportKpiBuckets(topics, posts, range, { personId, departmentId }, exemptions);
  const hasTrackedRooms = trackedTopicsOf(topics).length > 0;
  const byUser = reportStatusCountsByUser(topics, posts, range, exemptions);
  const inScope = scopedUserIds({ personId, departmentId });

  // Same previous-period comparison as the KPI card's own successRate trend
  // — null (no comparison shown) for the unbounded "ทั้งหมด" preset.
  const prevRange = previousPeriodRange(preset, customFrom, customTo);
  const prevSuccessRate = prevRange ? reportKpiBuckets(topics, posts, prevRange, { personId, departmentId }, exemptions).successRate : null;

  return (
    <StatusOverviewDonut
      title="ภาพรวมรายงาน (Report)"
      subtitle="การส่งรายงาน · คลิกที่วงกลมเพื่อดูอันดับรายคน"
      icon={<MessageSquareText className="h-4.5 w-4.5 text-[var(--ink-soft)]" />}
      domain="report"
      buckets={buckets}
      labels={{
        onTime: "ส่งแล้ว ตรงเวลา",
        lateDone: "ส่งช้าแต่เลยกำหนด",
        pending: "ยังไม่ส่ง ในกำหนด",
        overdue: "ยังไม่ส่ง เลยกำหนด",
        exempt: "ยกเว้น (ลา/หยุด)",
      }}
      unitLabel="ครั้ง"
      centerLabel="สำเร็จ"
      totalLabel={`${buckets.total} ครั้งที่ต้องส่ง`}
      emptyMessage={hasTrackedRooms ? "ยังไม่มีข้อมูลในช่วงเวลานี้" : "ยังไม่มีห้องที่ตั้งรอบเวลา (cutoff) — ตั้งค่าได้ที่ ตั้งค่า > ห้อง Report"}
      topPersonByBucket={{
        overdue: topPeopleOf(byUser, inScope, "missed"),
        pending: topPeopleOf(byUser, inScope, "pending"),
      }}
      prevSuccessRate={prevSuccessRate}
      peopleByBucket={{
        onTime: rankedPeople(countsFor(byUser, inScope, "onTime")),
        lateDone: rankedPeople(countsFor(byUser, inScope, "lateDone")),
        pending: rankedPeople(countsFor(byUser, inScope, "pending")),
        overdue: rankedPeople(countsFor(byUser, inScope, "missed")),
      }}
    />
  );
}
