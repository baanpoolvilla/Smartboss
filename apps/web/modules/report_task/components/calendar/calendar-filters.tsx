"use client";

import { Badge } from "@/modules/report_task/components/ui/badge";
import { eventTypeLabels } from "@/modules/report_task/lib/calendar-colors";
import { useEventColorStore } from "@/modules/report_task/store/event-color-store";
import { cn } from "@/modules/report_task/lib/utils";
import type { CalendarEventType } from "@/modules/report_task/types";

/** Plain on/off filters for the schedule calendar (leaves are colored by type
 *  in their own legend, so no per-type color picker here). */
export function CalendarFilters({
  types,
  active,
  onToggle,
}: {
  types: CalendarEventType[];
  active: Set<CalendarEventType>;
  onToggle: (type: CalendarEventType) => void;
}) {
  const colors = useEventColorStore((s) => s.colors);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--ink-soft)] mr-0.5">แสดง:</span>
      {types.map((t) => {
        const isActive = active.has(t);
        const color = t === "leave" ? "var(--ink-soft)" : colors[t];
        return (
          <button key={t} onClick={() => onToggle(t)} title={isActive ? "คลิกเพื่อซ่อน" : "คลิกเพื่อแสดง"}>
            <Badge
              variant="outline"
              className={cn("gap-1.5 cursor-pointer select-none transition-opacity h-6", !isActive && "opacity-40")}
              style={{ borderColor: color, color }}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              {eventTypeLabels[t]}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}
