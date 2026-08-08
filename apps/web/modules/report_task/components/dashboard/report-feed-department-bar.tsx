"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { departments, getUser } from "@/modules/report_task/data/mock";
import { buildDepartmentComplianceReports, trackedTopicsOf, trackedTopicIdForDepartment } from "@/modules/report_task/lib/report-feed-compliance";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { departmentColorOrder, chartChrome } from "@/modules/report_task/lib/chart-colors";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { MessageSquareText } from "lucide-react";

/**
 * Same chart shape as the Task DepartmentBarChart (one bar per department, %
 * on the Y axis, click a bar to drill in) but for report-feed compliance —
 * "who has good posting discipline" as a graph instead of only a table row.
 * Narrows to one department/its own bar the same way the Task chart does
 * when the Dashboard's person/department picker is set.
 */
export function ReportFeedDepartmentBar() {
  const topics = useVisibleReportTopics();
  const posts = useReportFeedStore((s) => s.posts);
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  const range = presetRange(preset, customFrom, customTo);
  const exemptions = useReportComplianceExemptions();
  const router = useRouter();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const shownDepartmentIds = useMemo(() => {
    if (departmentId !== "all") return new Set([departmentId]);
    if (personId !== "all") {
      const dept = getUser(personId)?.departmentId;
      return dept ? new Set([dept]) : new Set(departments.map((d) => d.id));
    }
    return new Set(departments.map((d) => d.id));
  }, [departmentId, personId]);

  const data = useMemo(() => {
    const reports = buildDepartmentComplianceReports(topics, posts, range, exemptions);
    return departments
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => shownDepartmentIds.has(d.id))
      .map(({ d, i }) => {
        const r = reports.find((rep) => rep.id === d.id);
        return {
          id: d.id,
          department: d.name,
          complianceRate: r?.complianceRate ?? 0,
          trackedDays: r?.trackedDays ?? 0,
          color: departmentColorOrder[i % departmentColorOrder.length],
        };
      })
      .filter((d) => d.trackedDays > 0);
  }, [topics, posts, range, shownDepartmentIds, exemptions]);

  const hasTrackedRooms = trackedTopicsOf(topics).length > 0;

  return (
    <Card className={`${DASHBOARD_CARD} h-full`}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          อัตราการส่งรายงานแยกตามแผนก
          <span className="flex items-center gap-1 text-[10px] font-medium text-[var(--chart-pink)] bg-pink-50 rounded-full px-2 py-0.5">
            <MessageSquareText className="h-3 w-3" /> Report
          </span>
        </CardTitle>
        <p className="text-xs text-[var(--ink-soft)]">% ของวันที่ต้องส่งรายงานที่แผนกนั้นส่งจริง (สูง = วินัยการส่งดี) · คลิกแท่งกราฟเพื่อดูรายละเอียด</p>
      </CardHeader>
      <CardContent>
        {!hasTrackedRooms || data.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)] text-center py-10">
            {hasTrackedRooms ? "ยังไม่มีข้อมูลในช่วงเวลานี้" : "ยังไม่มีห้องที่ตั้งรอบเวลา (cutoff) — ตั้งค่าได้ที่ ตั้งค่า > ห้อง Report"}
          </p>
        ) : (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={chartChrome.grid} />
                <XAxis
                  dataKey="department"
                  tick={{ fontSize: 11, fill: chartChrome.mutedText }}
                  axisLine={{ stroke: chartChrome.axis }}
                  tickLine={false}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: chartChrome.mutedText }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  cursor={{ fill: "var(--bg-soft)" }}
                  formatter={(value) => [`${value}%`, "อัตราการส่ง"]}
                  labelFormatter={(label) => `แผนก${label}`}
                  wrapperStyle={{ zIndex: 50, outline: "none" }}
                  contentStyle={{ borderRadius: 8, borderColor: "var(--line)", fontSize: 13, background: "#fff", boxShadow: "0 8px 24px -8px rgba(17,17,17,0.22)" }}
                />
                <Bar dataKey="complianceRate" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  <LabelList
                    dataKey="complianceRate"
                    position="top"
                    formatter={(v) => `${v}%`}
                    style={{ fontSize: 11, fill: chartChrome.mutedText, fontWeight: 600 }}
                  />
                  {data.map((d) => (
                    <Cell
                      key={d.department}
                      fill={d.color}
                      cursor="pointer"
                      opacity={hoveredId && hoveredId !== d.id ? 0.35 : 1}
                      style={{ transition: "opacity 0.12s ease" }}
                      onMouseEnter={() => setHoveredId(d.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onClick={() => {
                        const topicId = trackedTopicIdForDepartment(topics, d.id);
                        router.push(topicId ? `/report-feed?topic=${topicId}&tab=stats` : "/report-feed");
                      }}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
