"use client";

import { Button } from "@/modules/report_task/components/ui/button";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { useDashboardLayoutStore } from "@/modules/report_task/store/dashboard-layout-store";
import { widgetRegistry } from "./widget-registry";
import { cn } from "@/modules/report_task/lib/utils";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canViewWidget } from "@/modules/report_task/lib/dashboard-widget-roles";
import { Check, RotateCcw, Eye } from "lucide-react";

interface DashboardCustomizeBarProps {
  /** Called when the viewer is done customizing — exits edit mode. */
  onDone: () => void;
}

/** Shown while the dashboard is in customize mode — re-add hidden widgets, reset layout, finish editing. */
export function DashboardCustomizeBar({ onDone }: DashboardCustomizeBarProps) {
  const widgets = useDashboardLayoutStore((s) => s.widgets);
  const toggleWidget = useDashboardLayoutStore((s) => s.toggleWidget);
  const reset = useDashboardLayoutStore((s) => s.reset);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  // Same stale-persisted-layout guard as dashboard-grid.tsx — a widget id no
  // longer in the registry (e.g. "trend", removed) shouldn't show up as a
  // pickable toggle or crash on widgetRegistry[w.id].
  const pickable = widgets.filter((w) => w.id in widgetRegistry && canViewWidget(w.id, viewingAsUserId));
  const hidden = pickable.filter((w) => !w.visible);

  return (
    <div className="rounded-xl border border-dashed border-[var(--brand-green)]/50 bg-[var(--accent)]/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="bg-white text-[var(--brand-green-dark)] border-[var(--brand-green)]/40">
          โหมดปรับแต่ง
        </Badge>
        <span className="text-xs text-[var(--ink-soft)]">
          ลากที่ <span className="font-medium text-[var(--ink)]">⠿</span> เพื่อสลับตำแหน่ง · กด 1/3 · 2/3 · เต็ม เพื่อปรับความกว้าง · กดรูปตาปิดเพื่อซ่อน
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" /> จัดเรียงใหม่
          </Button>
          <Button
            data-tour="dashboard-customize-done"
            size="sm"
            className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
            onClick={onDone}
          >
            <Check className="h-3.5 w-3.5" /> เสร็จสิ้น
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-[var(--ink-soft)] flex items-center gap-1">
          <Eye className="h-3.5 w-3.5" /> วิดเจ็ต:
        </span>
        {pickable.map((w) => (
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
              {widgetRegistry[w.id].label}
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
