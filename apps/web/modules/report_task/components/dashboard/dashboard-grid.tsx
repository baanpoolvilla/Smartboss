"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useDashboardLayoutStore,
  type WidgetConfig,
  type WidgetId,
  type WidgetSpan,
} from "@/modules/report_task/store/dashboard-layout-store";
import { widgetRegistry } from "./widget-registry";
import { cn } from "@/modules/report_task/lib/utils";
import { GripVertical, EyeOff } from "lucide-react";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canViewWidget } from "@/modules/report_task/lib/dashboard-widget-roles";

const spanClass: Record<WidgetSpan, string> = {
  1: "xl:col-span-1",
  2: "xl:col-span-2",
  3: "xl:col-span-3",
};

const spanLabel: Record<WidgetSpan, string> = {
  1: "1/3",
  2: "2/3",
  3: "เต็ม",
};

function SortableWidget({ widget, editing }: { widget: WidgetConfig; editing: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !editing,
  });
  const toggleWidget = useDashboardLayoutStore((s) => s.toggleWidget);
  const setSpan = useDashboardLayoutStore((s) => s.setSpan);
  const { Component, label } = widgetRegistry[widget.id];

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("col-span-1", spanClass[widget.span], isDragging && "opacity-50 z-10")}
    >
      {editing && (
        <div className="flex items-center gap-2 mb-1.5 rounded-lg border border-dashed border-[var(--brand-green)]/40 bg-[var(--accent)] px-2 py-1.5">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-[var(--ink-soft)] hover:text-[var(--ink)]"
            title="ลากเพื่อจัดตำแหน่ง"
            aria-label={`ลากเพื่อจัดตำแหน่งวิดเจ็ต ${label}`}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="text-xs font-medium truncate">{label}</span>

          <div className="ml-auto flex items-center gap-1">
            {([1, 2, 3] as WidgetSpan[]).map((s) => (
              <button
                key={s}
                onClick={() => setSpan(widget.id, s)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                  widget.span === s
                    ? "bg-[var(--brand-green)] text-[var(--ink)]"
                    : "bg-white text-[var(--ink-soft)] hover:text-[var(--ink)]"
                )}
                title={`ความกว้าง ${spanLabel[s]}`}
              >
                {spanLabel[s]}
              </button>
            ))}
            <button
              onClick={() => toggleWidget(widget.id)}
              className="rounded px-1 py-0.5 text-[var(--ink-soft)] hover:text-[var(--chart-red)]"
              title="ซ่อนวิดเจ็ตนี้"
              aria-label={`ซ่อนวิดเจ็ต ${label}`}
            >
              <EyeOff className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
      <div className={cn(editing && "pointer-events-none select-none")}>
        <Component />
      </div>
    </div>
  );
}

export function DashboardGrid({ editing }: { editing: boolean }) {
  const widgets = useDashboardLayoutStore((s) => s.widgets);
  const reorder = useDashboardLayoutStore((s) => s.reorder);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  // A widget removed from the registry (e.g. "trend") can still be sitting in
  // someone's already-persisted layout from before it was removed — skip it
  // rather than crash on widgetRegistry[w.id] being undefined.
  const visible = widgets.filter(
    (w) => w.visible && w.id in widgetRegistry && canViewWidget(w.id, viewingAsUserId)
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      reorder(active.id as WidgetId, over.id as WidgetId);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={visible.map((w) => w.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6 items-start">
          {visible.map((w) => (
            <SortableWidget key={w.id} widget={w} editing={editing} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
