"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { getUser } from "@/modules/report_task/lib/directory";
import { useTodoStore } from "@/modules/report_task/store/todo-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useCalendarVisibilityStore } from "@/modules/report_task/store/calendar-visibility-store";
import { formatDate } from "@/modules/report_task/lib/format";
import { rangeLabel, inRange, type ViewRange } from "@/modules/report_task/lib/date-filter";
import { cn } from "@/modules/report_task/lib/utils";
import { Button } from "@/modules/report_task/components/ui/button";
import { Check, Plus, Trash2 } from "lucide-react";
import type { TodoItem } from "@/modules/report_task/types";

/** Right rail for the To Do calendar tab — same visible range as the grid.
 *  "mine" shows just the viewer's own card. "all" splits into two cards
 *  (mine, then everyone else's) instead of one merged list, so "what's on
 *  my plate" doesn't get lost in a pile of other people's items once a
 *  head/owner switches scope — same split WorkSidebar already uses for
 *  tasks. Only "mine" rows are interactive (toggle/edit/delete) — someone
 *  else's is a read-only peek with their avatar for attribution. */
export function TodoSidebar({
  range,
  scope,
  onEdit,
  onAdd,
  hideMine = false,
}: {
  range: ViewRange;
  scope: "mine" | "all";
  onEdit: (t: TodoItem) => void;
  /** Now that สิ่งที่ต้องทำ has no dedicated tab/top-bar create button of its
   * own (merged into งาน — see calendar-view.tsx), this card is the one
   * reliable place to start a new item, so it gets its own quick-add. */
  onAdd?: () => void;
  /** The viewer's own to-dos now live inside WorkSidebar's "งานที่ฉันรับ"
   *  card instead (merged in, per feedback) — this card keeps only the
   *  "everyone else's" half when true, instead of showing the viewer's own
   *  list twice in two different places. */
  hideMine?: boolean;
}) {
  const todos = useTodoStore((s) => s.todos);
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  const removeTodo = useTodoStore((s) => s.removeTodo);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const hiddenUserIds = useCalendarVisibilityStore((s) => s.hiddenUserIds);

  const inRangeTodos = todos.filter((t) => inRange(t.date, range));
  const sortByDone = (a: TodoItem, b: TodoItem) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date);

  const myTodos = inRangeTodos.filter((t) => t.userId === viewingAsUserId).sort(sortByDone);
  const otherTodos = inRangeTodos
    .filter((t) => t.userId !== viewingAsUserId && !hiddenUserIds.includes(t.userId))
    .sort(sortByDone);

  const period = range.viewType === "timeGridDay" ? "วันนี้" : range.viewType === "timeGridWeek" ? "สัปดาห์นี้" : "เดือนนี้";

  function row(t: TodoItem, showOwner: boolean) {
    const mine = t.userId === viewingAsUserId;
    const owner = showOwner ? getUser(t.userId) : undefined;
    return (
      <div key={t.id} className="group flex items-center gap-2.5 rounded-lg -mx-1 px-1 py-1 hover:bg-[var(--bg-soft)] transition-colors">
        <button
          onClick={() => mine && toggleTodo(t.id)}
          disabled={!mine}
          aria-label={t.done ? "ทำเครื่องหมายว่ายังไม่เสร็จ" : "ทำเครื่องหมายว่าเสร็จแล้ว"}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-[var(--chart-amber)] disabled:opacity-50 disabled:cursor-default"
          style={t.done ? { backgroundColor: "var(--chart-amber)" } : undefined}
        >
          {t.done && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
        </button>
        <button
          onClick={() => mine && onEdit(t)}
          disabled={!mine}
          className="min-w-0 flex-1 text-left disabled:cursor-default"
        >
          <p className={cn("text-sm font-medium truncate", t.done && "line-through text-[var(--ink-soft)]")}>{t.title}</p>
          <p className="text-xs text-[var(--ink-soft)]">
            {formatDate(t.date)}
            {t.time && ` · ${t.time}`}
          </p>
          {t.note && <p className="text-xs text-[var(--ink-soft)] truncate mt-0.5">{t.note}</p>}
        </button>
        {owner && (
          <Avatar className="h-6 w-6 shrink-0" title={owner.name}>
            <AvatarImage src={owner.avatarUrl ?? undefined} alt={owner.name} />
            <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{owner.avatar}</AvatarFallback>
          </Avatar>
        )}
        {mine && (
          <button
            onClick={() => removeTodo(t.id)}
            title="ลบ"
            aria-label={`ลบ "${t.title}"`}
            className="shrink-0 text-[var(--ink-faint)] opacity-0 group-hover:opacity-100 hover:text-[var(--chart-red)] transition-opacity"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  function card(heading: string, items: TodoItem[], emptyLabel: string, showOwner: boolean, showAdd: boolean) {
    return (
      <Card className="border-[var(--line)] shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              {heading}
              {items.length > 0 && (
                <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
                  {items.filter((t) => !t.done).length}/{items.length}
                </span>
              )}
            </span>
            {showAdd && onAdd && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={onAdd}>
                <Plus className="h-3.5 w-3.5" /> เพิ่ม
              </Button>
            )}
          </CardTitle>
          <p className="text-xs text-[var(--ink-soft)]">{rangeLabel(range)} · คลิกกล่องเพื่อติ๊กเสร็จ · คลิกชื่อเพื่อแก้ไข</p>
        </CardHeader>
        <CardContent className="space-y-1.5 max-h-96 overflow-y-auto">
          {items.length === 0 && <p className="text-sm text-[var(--ink-soft)]">{emptyLabel}</p>}
          {items.map((t) => row(t, showOwner))}
        </CardContent>
      </Card>
    );
  }

  if (scope === "mine") {
    return hideMine ? null : card(`สิ่งที่ต้องทำของฉัน${period}`, myTodos, "ยังไม่มีสิ่งที่ต้องทำของฉันในช่วงนี้", false, true);
  }

  return (
    <>
      {!hideMine && card(`สิ่งที่ต้องทำของฉัน${period}`, myTodos, "ยังไม่มีสิ่งที่ต้องทำของฉันในช่วงนี้", false, true)}
      {card(`สิ่งที่ต้องทำของคนอื่น${period}`, otherTodos, "ยังไม่มีสิ่งที่ต้องทำของใครในช่วงนี้", true, false)}
    </>
  );
}
