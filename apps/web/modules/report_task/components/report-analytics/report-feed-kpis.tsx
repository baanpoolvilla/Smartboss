"use client";

import { Card, CardContent } from "@/modules/report_task/components/ui/card";
import { overallComplianceKpis } from "@/modules/report_task/lib/report-feed-compliance";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { useReportFeedFilterStore } from "@/modules/report_task/store/report-feed-filter-store";
import { CheckCircle2, Clock3, AlertTriangle, MessageSquareText } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

/** The 4 cards, driven by whatever range the caller passes — split out so the Overview tab can drive it with the Task tab's own range instead of report-feed's own filter store. */
export function ReportFeedKpisForRange({ range }: { range: { from: Date; to: Date } | null }) {
  const topics = useVisibleReportTopics();
  const posts = useReportFeedStore((s) => s.posts);
  const exemptions = useReportComplianceExemptions();
  const k = overallComplianceKpis(topics, posts, range, exemptions);

  const cards = [
    { label: "อัตราการส่งรายงาน", value: `${k.complianceRate}%`, icon: CheckCircle2, iconClass: "bg-green-50 text-[var(--brand-green)]" },
    { label: "ส่งช้า", value: `${k.latePercent}%`, icon: Clock3, iconClass: "bg-amber-50 text-[var(--chart-amber)]" },
    { label: "ไม่ได้ส่งรายงาน (รวมทุกคน/ห้อง)", value: k.missedCount, icon: AlertTriangle, iconClass: "bg-red-50 text-[var(--chart-red)]" },
    { label: "โพสต์ทั้งหมด", value: k.totalPosts, icon: MessageSquareText, iconClass: "bg-blue-50 text-[var(--chart-blue)]" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map((c) => (
        <Card key={c.label} className="border-[var(--line)] shadow-none">
          <CardContent className="flex items-center gap-3 px-5 py-1">
            <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", c.iconClass)}>
              <c.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-[var(--ink-soft)]">{c.label}</p>
              <p className="text-xl font-semibold tabular-nums">{c.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Report tab's own KPI row — reads its own independent date filter (useReportFeedFilterStore). */
export function ReportFeedKpis() {
  const preset = useReportFeedFilterStore((s) => s.preset);
  const customFrom = useReportFeedFilterStore((s) => s.customFrom);
  const customTo = useReportFeedFilterStore((s) => s.customTo);
  const range = presetRange(preset, customFrom, customTo);
  return <ReportFeedKpisForRange range={range} />;
}
