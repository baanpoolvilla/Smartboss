"use client";

import { Button } from "@/modules/report_task/components/ui/button";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { useReportLayoutStore } from "@/modules/report_task/store/report-layout-store";
import { reportWidgetRegistry } from "./report-widget-registry";
import { cn } from "@/modules/report_task/lib/utils";
import { Check, RotateCcw, Eye } from "lucide-react";

/** Shown while the report page is in customize mode — re-add hidden widgets, reset layout. */
export function ReportCustomizeBar() {
  const widgets = useReportLayoutStore((s) => s.widgets);
  const toggleWidget = useReportLayoutStore((s) => s.toggleWidget);
  const reset = useReportLayoutStore((s) => s.reset);
  const hidden = widgets.filter((w) => !w.visible);

  return (
    <div className="rounded-xl border border-dashed border-[var(--brand-green)]/50 bg-[var(--accent)]/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="bg-white text-[var(--brand-green-dark)] border-[var(--brand-green)]/40">
          โหมดปรับแต่ง
        </Badge>
        <span className="text-xs text-[var(--ink-soft)]">
          ลากที่ <span className="font-medium text-[var(--ink)]">⠿</span> เพื่อสลับตำแหน่ง · กด 1/3 · 2/3 · เต็ม เพื่อปรับความกว้าง · กดรูปตาปิดเพื่อซ่อน
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" /> คืนค่าเริ่มต้น
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-[var(--ink-soft)] flex items-center gap-1">
          <Eye className="h-3.5 w-3.5" /> วิดเจ็ต:
        </span>
        {widgets.map((w) => (
          <button key={w.id} onClick={() => toggleWidget(w.id)}>
            <Badge
              variant="outline"
              className={cn(
                "gap-1 cursor-pointer select-none",
                w.visible
                  ? "bg-white border-[var(--brand-green)]/40 text-[var(--ink)]"
                  : "bg-transparent text-[var(--ink-soft)] opacity-60"
              )}
            >
              {w.visible && <Check className="h-3 w-3 text-[var(--brand-green)]" />}
              {reportWidgetRegistry[w.id].label}
            </Badge>
          </button>
        ))}
        {hidden.length > 0 && (
          <span className="text-[10px] text-[var(--ink-soft)] ml-1">ซ่อนอยู่ {hidden.length} รายการ</span>
        )}
      </div>
    </div>
  );
}
