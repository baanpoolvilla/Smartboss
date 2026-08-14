"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { getUser } from "@/modules/report_task/lib/directory";
import { useTodoStore } from "@/modules/report_task/store/todo-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useCalendarVisibilityStore } from "@/modules/report_task/store/calendar-visibility-store";
import { formatDate } from "@/modules/report_task/lib/format";
import { rangeLabel, inRange, type ViewRange } from "@/modules/report_task/lib/date-filter";
import { cn } from "@/modules/report_task/lib/utils";
import { Check } from "lucide-react";
import type { TodoItem } from "@/modules/report_task/types";

/** Right rail for the To Do calendar tab — same visible range as the grid,
 *  "mine" narrows to the viewer's own items, "all" shows everyone's with an
 *  avatar per row so whose it is is still obvious in a mixed list. */
export function TodoSidebar({ range, scope }: { range: ViewRange; scope: "mine" | "all" }) {
  const todos = useTodoStore((s) => s.todos);
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const hiddenUserIds = useCalendarVisibilityStore((s) => s.hiddenUserIds);

  const visible = todos
    .filter((t) => inRange(t.date, range))
    .filter((t) => scope === "mine" ? t.userId === viewingAsUserId : !hiddenUserIds.includes(t.userId))
    // Not-yet-done first, each half sorted by date — a checked-off item
    // shouldn't crowd out what's still left to do at the top of the list.
    .sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date));

  const period = range.viewType === "timeGridDay" ? "วันนี้" : range.viewType === "timeGridWeek" ? "สัปดาห์นี้" : "เดือนนี้";
  const heading = scope === "mine" ? `To Do ของฉัน${period}` : `To Do ทั้งหมด${period}`;
  const emptyLabel = scope === "mine" ? "ยังไม่มี To Do ของฉันในช่วงนี้" : "ยังไม่มี To Do ของใครในช่วงนี้";

  function row(t: TodoItem) {
    const owner = scope === "all" ? getUser(t.userId) : undefined;
    return (
      <button
        key={t.id}
        onClick={() => toggleTodo(t.id)}
        className="w-full flex items-center gap-2.5 text-left rounded-lg -mx-1 px-1 py-1 hover:bg-[var(--bg-soft)] transition-colors"
      >
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-[var(--chart-amber)]"
          style={t.done ? { backgroundColor: "var(--chart-amber)" } : undefined}
        >
          {t.done && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium truncate", t.done && "line-through text-[var(--ink-soft)]")}>{t.title}</p>
          <p className="text-xs text-[var(--ink-soft)]">{formatDate(t.date)}</p>
        </div>
        {owner && (
          <Avatar className="h-6 w-6 shrink-0" title={owner.name}>
            <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{owner.avatar}</AvatarFallback>
          </Avatar>
        )}
      </button>
    );
  }

  return (
    <Card className="border-[var(--line)] shadow-none">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
          {heading}
          {visible.length > 0 && (
            <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
              {visible.filter((t) => !t.done).length}/{visible.length}
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-[var(--ink-soft)]">{rangeLabel(range)} · คลิกรายการเพื่อติ๊กเสร็จ</p>
      </CardHeader>
      <CardContent className="space-y-1.5 max-h-96 overflow-y-auto">
        {visible.length === 0 && <p className="text-sm text-[var(--ink-soft)]">{emptyLabel}</p>}
        {visible.map(row)}
      </CardContent>
    </Card>
  );
}
