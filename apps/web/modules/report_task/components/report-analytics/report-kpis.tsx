"use client";

import { Card, CardContent } from "@/modules/report_task/components/ui/card";
import { overallDetailedKpis } from "@/modules/report_task/lib/reports";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { useReportTasks } from "@/modules/report_task/lib/report-filter";
import { CheckCircle2, Clock3, History, Smile } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

export function ReportKpis() {
  const stickers = useStickerStore((s) => s.stickers);
  const tasks = useReportTasks();
  const k = overallDetailedKpis(tasks, stickers);

  const cards = [
    { label: "อัตราความสำเร็จของงาน", value: `${k.completionRate}%`, icon: CheckCircle2, iconClass: "bg-green-50 text-[var(--brand-green)]" },
    { label: "งานล่าช้า", value: `${k.latePercent}%`, icon: Clock3, iconClass: "bg-red-50 text-[var(--chart-red)]" },
    { label: "จำนวนแก้ไขกำหนดส่ง", value: k.revisionCount, icon: History, iconClass: "bg-amber-50 text-[var(--chart-amber)]" },
    {
      label: "คะแนนสติกเกอร์รวม",
      value: k.stickerAdjustment > 0 ? `+${k.stickerAdjustment}` : k.stickerAdjustment,
      icon: Smile,
      iconClass: k.stickerAdjustment < 0 ? "bg-red-50 text-[var(--chart-red)]" : "bg-green-50 text-[var(--brand-green)]",
    },
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
