"use client";

import { useRouter } from "next/navigation";
import { reportKpiBuckets } from "@/modules/report_task/lib/kpi-buckets";
import {
  trackedTopicsOf,
  trackedTopicIdForDepartment,
  reportStatusCountsByUser,
  scopedUserIds,
} from "@/modules/report_task/lib/report-feed-compliance";
import { getUser } from "@/modules/report_task/lib/directory";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { MessageSquareText } from "lucide-react";
import { StatusOverviewDonut } from "./status-overview-donut";

/** Whoever has the most reports in the given bucket among the users in
 * scope — named, for "ตัวปัญหาหลัก" to point at a specific person instead of
 * just a bucket total. */
function topPersonOf(
  byUser: Map<string, { onTime: number; lateDone: number; pending: number; missed: number; exempt: number }>,
  ids: Set<string>,
  field: "missed" | "pending"
): { name: string; count: number } | undefined {
  const top = [...ids]
    .map((id) => ({ id, count: byUser.get(id)?.[field] ?? 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)[0];
  if (!top) return undefined;
  return { name: getUser(top.id)?.name ?? top.id, count: top.count };
}

/** "ภาพรวมรายงาน (Report)" — the Analytics section's right twin of Task
 * Overview (§2.6, same StatusOverviewDonut shape, same 5-group buckets). */
export function ReportFeedStatusPie() {
  const router = useRouter();
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

  // Only a department scope maps to a single room's stats tab unambiguously
  // — a person can belong to several tracked rooms, so personId scope (and
  // "all") stay a plain link into report-feed instead of guessing one.
  function goToDetail() {
    if (personId === "all" && departmentId !== "all") {
      const topicId = trackedTopicIdForDepartment(topics, departmentId);
      if (topicId) {
        router.push(`/report-feed?topic=${topicId}&tab=stats`);
        return;
      }
    }
    router.push("/report-feed");
  }

  return (
    <StatusOverviewDonut
      title="ภาพรวมรายงาน (Report)"
      subtitle="การส่งรายงาน · คลิกเพื่อดูรายละเอียด"
      icon={<MessageSquareText className="h-4.5 w-4.5 text-[var(--ink-soft)]" />}
      buckets={buckets}
      labels={{
        onTime: "ส่งแล้ว ตรงเวลา",
        lateDone: "ส่งช้า",
        pending: "ยังไม่ส่ง ในกำหนด",
        overdue: "ขาดส่ง",
        exempt: "ยกเว้น (ลา/หยุด)",
      }}
      unitLabel="ครั้ง"
      centerLabel="สำเร็จ"
      totalLabel={`${buckets.total} ครั้งที่ต้องส่ง`}
      emptyMessage={hasTrackedRooms ? "ยังไม่มีข้อมูลในช่วงเวลานี้" : "ยังไม่มีห้องที่ตั้งรอบเวลา (cutoff) — ตั้งค่าได้ที่ ตั้งค่า > ห้อง Report"}
      onSegmentClick={goToDetail}
      onDetail={goToDetail}
      topPersonByBucket={{
        overdue: topPersonOf(byUser, inScope, "missed"),
        pending: topPersonOf(byUser, inScope, "pending"),
      }}
    />
  );
}
