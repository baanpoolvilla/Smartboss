"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { buildUserComplianceReports, buildDepartmentComplianceReports, trackedTopicsOf, trackedTopicIdForDepartment } from "@/modules/report_task/lib/report-feed-compliance";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import { ArrowUpRight } from "lucide-react";

const segments = [
  { key: "onTime" as const, label: "ตรงเวลา", color: chartColors.green },
  { key: "late" as const, label: "ส่งช้า", color: chartColors.amber },
  { key: "missed" as const, label: "ไม่ได้ส่ง", color: chartColors.red },
];

/** "Report Overview" — the Analytics section's right twin (Task Overview is its left-hand pair). Same large-donut + legend + summary + "ดูรายละเอียด" shape as TaskStatusPie, so the two domains read as siblings. */
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

  const { data, total, complianceRate } = useMemo(() => {
    let onTime = 0, late = 0, missed = 0;
    if (personId !== "all") {
      const row = buildUserComplianceReports(topics, posts, range, exemptions).find((r) => r.id === personId);
      onTime = row?.onTime ?? 0;
      late = row?.late ?? 0;
      missed = row?.missed ?? 0;
    } else if (departmentId !== "all") {
      const row = buildDepartmentComplianceReports(topics, posts, range, exemptions).find((r) => r.id === departmentId);
      onTime = row?.onTime ?? 0;
      late = row?.late ?? 0;
      missed = row?.missed ?? 0;
    } else {
      for (const r of buildUserComplianceReports(topics, posts, range, exemptions)) {
        onTime += r.onTime;
        late += r.late;
        missed += r.missed;
      }
    }
    const counts = { onTime, late, missed };
    const total = onTime + late + missed;
    const data = segments.map((s) => ({
      ...s,
      value: counts[s.key],
      percent: total ? Math.round((counts[s.key] / total) * 100) : 0,
    }));
    return { data, total, complianceRate: total ? Math.round(((onTime + late) / total) * 100) : 0 };
  }, [topics, posts, range, personId, departmentId, exemptions]);

  const hasTrackedRooms = trackedTopicsOf(topics).length > 0;

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
    <Card className={`${DASHBOARD_CARD} h-full`}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">ภาพรวม Report</CardTitle>
        <p className="text-[13px] text-[var(--ink-soft)]">การส่งรายงาน (เฉพาะห้องที่ตั้งรอบเวลา) · คลิกเพื่อดูรายละเอียด</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!hasTrackedRooms || total === 0 ? (
          <p className="text-sm text-[var(--ink-soft)] text-center py-16">
            {hasTrackedRooms ? "ยังไม่มีข้อมูลในช่วงเวลานี้" : "ยังไม่มีห้องที่ตั้งรอบเวลา (cutoff) — ตั้งค่าได้ที่ ตั้งค่า > ห้อง Report"}
          </p>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
              <div className="h-[180px] w-[180px] sm:h-[220px] sm:w-[220px] shrink-0 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data}
                      dataKey="value"
                      nameKey="label"
                      innerRadius={70}
                      outerRadius={102}
                      paddingAngle={2}
                      cornerRadius={5}
                      stroke="#ffffff"
                      strokeWidth={2}
                      isAnimationActive
                      animationDuration={500}
                    >
                      {data.map((d) => (
                        <Cell key={d.key} fill={d.color} cursor="pointer" onClick={goToDetail} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, _name, item) => [`${value} รายการ (${item.payload.percent}%)`, item.payload.label]}
                      wrapperStyle={{ zIndex: 50, outline: "none" }}
                      allowEscapeViewBox={{ x: true, y: true }}
                      contentStyle={{ borderRadius: 8, borderColor: "var(--line)", fontSize: 13, background: "#fff", boxShadow: "0 8px 24px -8px rgba(17,17,17,0.22)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-4xl font-semibold tabular-nums">{complianceRate}%</span>
                  <span className="text-[13px] text-[var(--ink-soft)] mt-0.5">ส่งตรงเวลา</span>
                </div>
              </div>

              <div className="flex-1 w-full space-y-1.5 min-w-0">
                {data.map((d) => (
                  <button
                    key={d.key}
                    onClick={goToDetail}
                    className="w-full flex items-center justify-between text-sm gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-[var(--bg-soft)] transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="text-[var(--ink)] whitespace-nowrap">{d.label}</span>
                    </div>
                    <span className="text-[var(--ink-soft)] tabular-nums shrink-0 whitespace-nowrap">
                      {d.value} · {d.percent}%
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-4 border-t border-[var(--line)]">
              <p className="text-[13px] text-[var(--ink-soft)]">
                ทั้งหมด <span className="font-semibold text-[var(--ink)] tabular-nums">{total}</span> รายการที่ต้องส่ง
                <span className="block text-[11px] mt-0.5">(นับรวมทุกคน × ทุกห้องที่ต้องส่ง × ทุกวันที่ถึงกำหนดแล้ว — ไม่ใช่จำนวนวัน)</span>
              </p>
              <button
                onClick={goToDetail}
                className="flex items-center gap-1 text-[13px] font-semibold text-[var(--brand-green-dark)] hover:underline"
              >
                ดูรายละเอียด <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
