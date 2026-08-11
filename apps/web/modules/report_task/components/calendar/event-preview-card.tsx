"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Button } from "@/modules/report_task/components/ui/button";
import { getUser, getDepartment } from "@/modules/report_task/lib/directory";
import { formatDate, formatDateTime } from "@/modules/report_task/lib/format";
import { eventTypeLabels } from "@/modules/report_task/lib/calendar-colors";
import { Calendar, MapPin, ArrowUpRight, Users as UsersIcon } from "lucide-react";
import type { CalendarEvent } from "@/modules/report_task/types";

/**
 * Google-Calendar-style quick look: a small floating card near the clicked
 * event with just enough to glance at, without opening the full task sheet /
 * event dialog for every single click.
 */
export function EventPreviewCard({
  event,
  anchorRect,
  color,
  onClose,
  onOpenFull,
}: {
  event: CalendarEvent;
  anchorRect: DOMRect;
  color: string;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  // No SSR-mount guard needed: this only ever renders in response to a
  // client-side click on the calendar grid, never during the initial render.
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const CARD_WIDTH = 300;
  const margin = 8;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUpward = spaceBelow < 220 && anchorRect.top > 220;
  const top = openUpward ? Math.max(margin, anchorRect.top - 8) : anchorRect.bottom + 8;
  const left = Math.min(Math.max(margin, anchorRect.left), window.innerWidth - CARD_WIDTH - margin);

  const user = event.userId ? getUser(event.userId) : undefined;
  const department = event.departmentId ? getDepartment(event.departmentId) : undefined;
  const attendees = (event.attendeeIds ?? []).map(getUser).filter(Boolean);

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: openUpward ? undefined : top,
        bottom: openUpward ? window.innerHeight - top : undefined,
        left,
        width: CARD_WIDTH,
      }}
      className="z-50 rounded-xl bg-white shadow-lg ring-1 ring-foreground/10 p-3.5 animate-in fade-in-0 zoom-in-95 duration-100"
    >
      <div className="flex items-start gap-2">
        <span className="h-2.5 w-2.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug break-words">{event.title}</p>
          <p className="text-[11px] text-[var(--ink-soft)] mt-0.5">{eventTypeLabels[event.type]}</p>
        </div>
      </div>

      <div className="mt-2.5 space-y-1.5 text-xs text-[var(--ink-soft)]">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          {event.allDay ? formatDate(event.start) : formatDateTime(event.start)}
        </div>
        {event.location && (
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" /> {event.location}
          </div>
        )}
        {attendees.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <UsersIcon className="h-3.5 w-3.5 shrink-0" />
            <div className="flex items-center -space-x-1.5">
              {attendees.slice(0, 5).map((a) => (
                <Avatar key={a!.id} className="h-5 w-5 ring-2 ring-white" title={a!.name}>
                  <AvatarFallback className="text-[8px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{a!.avatar}</AvatarFallback>
                </Avatar>
              ))}
              {attendees.length > 5 && <span className="pl-2 text-[10px]">+{attendees.length - 5}</span>}
            </div>
          </div>
        ) : user ? (
          <div className="flex items-center gap-1.5">
            <Avatar className="h-5 w-5">
              <AvatarFallback className="text-[8px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{user.avatar}</AvatarFallback>
            </Avatar>
            {user.name}
          </div>
        ) : department ? (
          <div className="flex items-center gap-1.5">{department.name}</div>
        ) : null}
      </div>

      <Button size="sm" variant="outline" className="w-full mt-3" onClick={onOpenFull}>
        ดูรายละเอียด <ArrowUpRight className="h-3.5 w-3.5" />
      </Button>
    </div>,
    document.body
  );
}
