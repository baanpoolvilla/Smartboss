"use client";

import { TaskCard } from "./task-card";
import { MaintenanceCard } from "./maintenance-card";
import type { BoardEntry } from "@/modules/report_task/lib/maintenance-board";
import { ShowMoreToggle } from "@/modules/report_task/components/shared/show-more-toggle";
import { useShowMore } from "@/modules/report_task/hooks/use-show-more";
import { useIsMobile } from "@/modules/report_task/hooks/use-is-mobile";
import { statusMeta } from "@/modules/report_task/lib/task-meta";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task, TaskStatus } from "@/modules/report_task/types";
import { useMemo } from "react";
import { MessageCircle } from "lucide-react";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { unreadTaskCommentCounts } from "@/modules/report_task/lib/task-comment-activity";

/** คอมเมนต์ที่ยังไม่ได้อ่าน แยกตามงาน (ของคนที่ดูอยู่) — ใช้ร่วมกับแท็บคอลัมน์บนมือถือใน kanban-board.tsx */
export function useUnreadCommentMap(): Map<string, number> {
  const notifications = useNotificationStore((s) => s.notifications);
  const me = useIdentityStore((s) => s.viewingAsUserId);
  return useMemo(() => unreadTaskCommentCounts(notifications, me), [notifications, me]);
}
export const sumUnread = (tasks: Task[], map: Map<string, number>) => tasks.reduce((n, t) => n + (map.get(t.id) ?? 0), 0);

/** เวลาคอมเมนต์ล่าสุดที่ยังไม่อ่าน แยกตามงาน — ใช้เรียงการ์ดที่มีคอมเมนต์ใหม่ขึ้นบนสุด (ใหม่สุดก่อน) */
function useUnreadCommentLatest(): Map<string, string> {
  const notifications = useNotificationStore((s) => s.notifications);
  const me = useIdentityStore((s) => s.viewingAsUserId);
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const n of notifications) {
      if (n.userId !== me || n.read || n.kind !== "task_comment" || !n.taskId) continue;
      if ((m.get(n.taskId) ?? "") < n.createdAt) m.set(n.taskId, n.createdAt);
    }
    return m;
  }, [notifications, me]);
}
import type { LucideIcon } from "lucide-react";

export interface BoardColumn {
  id: string;
  label: string;
  accent: string;
  icon?: LucideIcon;
  tasks: Task[];
  /** Computed from due dates, not a real grouped attribute — a task never
   * "belongs" to this column directly, it just currently qualifies. */
  derived?: boolean;
  /** Overrides the generic empty-column message — the derived "เลยกำหนด"
   * column gets its own celebratory copy instead. */
  emptyMessage?: string;
  /** Department grouping only — how many distinct project topics this
   * department's tasks span (including an "อื่นๆ" bucket if any task has
   * none), shown in the summary body instead of every single card. */
  projectCount?: number;
  /** Department grouping only — the actual project names behind projectCount
   * ("อยากให้แสดงลูกที่เป็นชื่อโปรเจคอะ" — a bare count didn't say which
   * ones, just how many), shown as chips in the summary body. */
  projectNames?: string[];
  /** Skip listing every task card in the body — show just "N โปรเจค · M งาน"
   * instead, since department grouping's real content lives one click away
   * (DepartmentTopicsBoard via onHeaderClick), not in this column itself.
   * ("ให้บอกแค่ว่ามีกี่โปรเจคกี่งานอะไรแบบนั้น" — the full card list here
   * duplicated what clicking through already shows, just more cluttered.)
   * Assignee grouping doesn't use this chip style — it always has
   * `breakdown` instead. */
  summaryOnly?: boolean;
  /** Assignee grouping only — this person's tasks broken down one row per
   * department, each independently clickable (via onBreakdownClick) to
   * just that department's tasks (still landing on project-topic columns
   * once there — PersonTopicsBoard always splits by topic). Clicking the
   * card/header itself (onHeaderClick) goes to this person's full task list
   * instead — every department mixed together, one page, no further clicks
   * needed ("กดการ์ดนี้เป็นงานของคนนั้นเลยแบบงานทั้งหมด...ดูง่ายเลย"); a row
   * here is the narrower, deliberate alternative ("ต้องเป็นแผนกด้วยสิ...
   * แสดงแค่ของใครของมันที่ได้รับมอบหมายในแผนกนั้นๆ"). */
  breakdown?: { id: string; label: string; accent: string; count: number }[];
  /** การ์ดที่จะแสดงจริง เมื่อมีใบงานซ่อมปนกับงาน (lib/maintenance-board.ts — เรียงรวมกันแล้ว)
   * ไม่ใส่ = แสดง tasks ตามเดิม · แถบ %/เลยกำหนดในหัวคอลัมน์ยังนับเฉพาะงาน */
  entries?: BoardEntry[];
}

const PAGE_SIZE = 10; // ผู้ใช้ขอ 17/10/2569: แต่ละคอลัมน์โชว์ 10 ใบก่อน (เดิม 6) แล้วกด "แสดงเพิ่มเติม" แบบเดิม
// <640px shows fewer cards up front — a full-width column already fills the
// screen with just a few, so 6 was several screens of scrolling before
// "แสดงเพิ่มเติม" ever showed up.
const MOBILE_PAGE_SIZE = 3;

export function KanbanColumn({
  column,
  boardTotal,
  onOpen,
  onHeaderClick,
  headerClickTitle,
  onBreakdownClick,
  groupedByPriority,
  groupedByStatus,
  hideHeaderOnMobile,
}: {
  column: BoardColumn;
  /** Every task currently on the board (post-filter) — the denominator for this column's "N% ของบอร์ด" bar. */
  boardTotal: number;
  onOpen: (id: string) => void;
  /** Set only when grouped by assignee or department — clicking anywhere on
   * the card/header opens that person's full task list, or that
   * department's tasks broken down by project topic. Absent for
   * status/priority columns, which don't map to either. */
  onHeaderClick?: () => void;
  /** Tooltip for the clickable header — differs by what onHeaderClick drills
   * into (a person vs a department), defaults to the person wording since
   * that was the only case before department grouping existed. */
  headerClickTitle?: string;
  /** Assignee grouping only — clicking one row of column.breakdown jumps
   * straight to just that one department's tasks for this person, narrower
   * than what onHeaderClick opens (their full list, every department mixed
   * together). */
  onBreakdownClick?: (departmentId: string) => void;
  /** Passed straight through to each card — see TaskCard's own doc. */
  groupedByPriority?: boolean;
  /** A normal (non-derived) status column is, by definition, 100% one status
   * — every task in "กำลังทำ" already IS "กำลังทำ". Repeating that as a
   * legend chip under the bar ("● กำลังทำ N") just restated the header
   * label/count back at itself, so the by-status split is skipped here in
   * favor of an on-time/overdue split instead (see isPlainStatusColumn) —
   * still shown for the derived "รอตรวจสอบ" column and for priority/assignee
   * grouping, where a column can genuinely mix statuses. */
  groupedByStatus?: boolean;
  /** มือถือ (<640px): ซ่อนการ์ดหัวคอลัมน์ — แถบแท็บของบอร์ดบอกชื่อ+จำนวนแทนแล้ว (ดู kanban-board.tsx) */
  hideHeaderOnMobile?: boolean;
}) {
  const accent = column.accent;
  // คอมเมนต์ที่ยังไม่อ่านในคอลัมน์นี้ — ขึ้นแทนป้ายจำนวนงานทางขวา (จำนวนงานย้ายไปไว้หน้าชื่อแทนไอคอน)
  const unreadMap = useUnreadCommentMap();
  const unreadComments = sumUnread(column.tasks, unreadMap);
  const percent = boardTotal > 0 ? Math.round((column.tasks.length / boardTotal) * 100) : 0;
  // The header's icon chip/count/% text used to just be `accent` itself —
  // fine for a saturated color like the amber/red/gray accents, but the
  // derived "รอตรวจสอบ" column's accent (chartColors.greenPale, a pale
  // sage) is barely visible as text on its own pale-tint background. Darken
  // it for text specifically so every column stays legible regardless of
  // how light its own accent is, while the background tint and the little
  // dot (still solid `accent`) keep the light/dark cue between columns.
  const textAccent = `color-mix(in srgb, ${accent} 55%, black)`;

  // A column can mix statuses (every assignee column does; the derived
  // "รอตรวจสอบ" column is always 100% "done" though, so this stays flat
  // there) — a single-accent-color bar couldn't say which. Segment it by
  // each task's own status instead so "what kind of tasks does this person
  // actually have" reads at a glance without opening a single card.
  const statusOrder: TaskStatus[] = ["todo", "in_progress", "done"];
  const statusCounts = statusOrder.map((s) => ({
    status: s,
    count: column.tasks.filter((t) => t.status === s).length,
  }));

  // "รอดำเนินการ"/"กำลังทำ" no longer have a separate "เลยกำหนด" column to
  // drain into — a late task just stays here. The plain status-segmented bar
  // above is a no-op for these two (100% one status, by definition), so they
  // get their own split instead: on-time in the column's own accent, late in
  // the same red DueDateBadge already uses on the card itself, so a column
  // full of red reads as "everything in here is late" at a glance.
  //
  // The derived "รอตรวจสอบ" column is also single-status underneath (every
  // task in it is literally task.status === "done", just further filtered by
  // !reviewedBy) but used to fall through to the by-status segmented bar
  // below anyway since it's `derived` — which rendered 100% statusMeta.done's
  // own dark green, ignoring the column's own pale-green accent entirely. Its
  // overdueCount is always 0 (a done task is never overdue), so routing it
  // through this same on-time/overdue branch just paints it as one flat bar
  // in its own accent — no on-time/overdue split needed, same effect. The
  // other derived column ("เลยกำหนดเท่านั้น"'s single flat list) stays out of
  // this on purpose — that one's tasks really are overdue, so it should keep
  // showing red, not silently repaint pale-green.
  const isPlainStatusColumn = groupedByStatus && (!column.derived || column.id === "review");
  const overdueCount = isPlainStatusColumn
    ? column.tasks.filter((t) => t.status !== "done" && dueUrgency(t) === "overdue").length
    : 0;
  const onTimeCount = column.tasks.length - overdueCount;

  // หัวคอลัมน์: ช่วงสีบนพื้นหลัง (แทนหลอดเดิม) — คอลัมน์สถานะปกติ = ตรงเวลา (สีคอลัมน์) + เลยกำหนด (แดง),
  // คอลัมน์อื่น (ตามคน/ความสำคัญ) = แยกตามสถานะ เหมือนหลอดเดิมทุกอย่าง แค่ย้ายไปเป็นพื้น
  const total = column.tasks.length;
  const headerSegments: { pct: number; color: string }[] =
    total === 0
      ? []
      : isPlainStatusColumn
        ? [
            ...(onTimeCount > 0 ? [{ pct: (onTimeCount / total) * 100, color: accent }] : []),
            ...(overdueCount > 0 ? [{ pct: (overdueCount / total) * 100, color: chartColors.red }] : []),
          ]
        : statusCounts.filter((x) => x.count > 0).map((x) => ({ pct: (x.count / total) * 100, color: statusMeta[x.status].accentColor }));
  // ป้ายจำนวนสีทึบ — สีอ่อน (รอตรวจสอบ = เขียวอ่อน) เข้มขึ้นนิดให้ตัวเลขสีขาวอ่านออก
  const chipColor = `color-mix(in srgb, ${accent} 82%, black)`;
  // รายละเอียดที่เอาออกจากหน้าหัว (ป้าย "เลย", ตัวหนังสือใต้หลอด) อยู่ใน tooltip แทน
  const headerTitle = [
    onHeaderClick ? (headerClickTitle ?? "ดูงานของคนนี้แยกตามหมวดงาน") : null,
    `${column.label} ${total} งาน · ${percent}% ของบอร์ด`,
    isPlainStatusColumn
      ? overdueCount > 0
        ? `ตรงเวลา ${onTimeCount} · เลยกำหนด ${overdueCount}`
        : null
      : statusCounts.filter((x) => x.count > 0).map((x) => `${statusMeta[x.status].label} ${x.count}`).join(" · "),
  ]
    .filter(Boolean)
    .join("\n");

  // §6 — every column caps at PAGE_SIZE cards up front (same constant for
  // every column, so all columns stay in sync scrolling-wise before anyone
  // expands); "ดูเพิ่มเติม" reveals the rest, "แสดงน้อยลง" collapses back —
  // same two-way toggle as the Dashboard's capped lists
  // (useShowMore/ShowMoreToggle), not a one-way "keep clicking to add more"
  // with no way back.
  const isMobile = useIsMobile();
  const baseEntries: BoardEntry[] = column.entries ?? column.tasks.map((task) => ({ type: "task", task }));
  // การ์ดที่มีคอมเมนต์ยังไม่อ่าน "เด้ง" ขึ้นบนสุด (คอมเมนต์ใหม่สุดก่อน) ที่เหลือเรียงตามเดิม —
  // เปิดอ่านแล้ว (แจ้งเตือนถูกทำว่าอ่านแล้ว) การ์ดกลับไปอยู่ตำแหน่งเดิมเอง (ผู้ใช้ขอ 17/10/2569)
  const unreadLatest = useUnreadCommentLatest();
  const entries = useMemo(() => {
    const lastOf = (e: BoardEntry) => (e.type === "task" ? unreadLatest.get(e.task.id) ?? "" : "");
    if (!baseEntries.some((e) => lastOf(e))) return baseEntries;
    const fresh = baseEntries.filter((e) => lastOf(e)).sort((a, b) => lastOf(b).localeCompare(lastOf(a)));
    return [...fresh, ...baseEntries.filter((e) => !lastOf(e))];
  }, [baseEntries, unreadLatest]);
  const { visible: visibleEntries, remaining, expanded, toggle } = useShowMore(entries, isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE);

  return (
    <div
      id={`kanban-col-${column.id}`}
      // <640px: one column fills the whole viewport width and snaps into
      // place on swipe (see KanbanBoard's `snap-x snap-mandatory` scroller +
      // its own pager buttons) — ≥640px reverts to the original fixed-width
      // lane sitting side-by-side with the others.
      className="flex h-full min-h-0 flex-1 basis-full min-w-full max-w-full sm:basis-[300px] sm:min-w-[280px] sm:max-w-[400px] shrink-0 flex-col snap-center sm:snap-none transition-shadow duration-500"
    >
      {(() => {
        // ทั้งการ์ดหัวคอลัมน์กดได้เลยตอนมี onHeaderClick (คนดูเรื่องผู้รับผิดชอบ/
        // แผนก) — เดิมกดได้แค่ตรงชื่อเป็นตัวหนังสือเล็กๆ เท่านั้น เจอเป้าหมาย
        // ยากไป ("ตอนนี้มันกดได้แค่ตรงชื่ออะ") จึงย้ายพฤติกรรมคลิกมาไว้ที่การ์ด
        // ทั้งใบแทน — ไม่มีปุ่ม/ลิงก์อื่นซ้อนอยู่ข้างในการ์ดนี้เลย จึงสลับทั้ง
        // การ์ดเป็น <button> ได้อย่างปลอดภัย (ไม่ใช่ interactive ซ้อน interactive)
        const HeaderTag = onHeaderClick ? "button" : "div";
        return (
          <HeaderTag
            type={onHeaderClick ? "button" : undefined}
            onClick={onHeaderClick}
            title={headerTitle}
            className={cn(
              // แบบ A ที่เลือกจาก mockup (18/10/2569): ทั้งหัวคือหลอด — พื้นสีจาง = สัดส่วนในคอลัมน์ (ตรงเวลา/เลยกำหนด
              // หรือแยกตามสถานะ) + เส้นสีเข้มที่ขอบล่าง · แถวเดียว 42px แทนกล่อง 3 ชั้นเดิม (~84px) คืนที่ให้การ์ด
              "relative shrink-0 w-full h-[42px] overflow-hidden rounded-xl bg-white border border-[var(--line)] shadow-[0_1px_2px_rgba(16,24,40,0.04)] mb-3 text-left",
              hideHeaderOnMobile && "hidden sm:block",
              onHeaderClick && "cursor-pointer transition-colors hover:border-[var(--brand-green)]"
            )}
          >
            {headerSegments.length > 0 && (
              <>
                <span className="absolute inset-0 flex" aria-hidden>
                  {headerSegments.map((seg, i) => (
                    <span
                      key={i}
                      className="h-full transition-[width] duration-300"
                      style={{
                        width: `${seg.pct}%`,
                        backgroundColor: `color-mix(in srgb, ${seg.color} 24%, white)`,
                        boxShadow: i > 0 ? "inset 1.5px 0 0 white" : undefined,
                      }}
                    />
                  ))}
                </span>
                <span className="absolute inset-x-0 bottom-0 flex h-[3px]" aria-hidden>
                  {headerSegments.map((seg, i) => (
                    <span key={i} className="h-full transition-[width] duration-300" style={{ width: `${seg.pct}%`, backgroundColor: seg.color }} />
                  ))}
                </span>
              </>
            )}
            <span className="relative flex h-full items-center gap-2 px-2">
              {/* จำนวนงาน — ป้ายสีทึบของคอลัมน์ */}
              <span
                className="flex h-6 min-w-[26px] shrink-0 items-center justify-center rounded-[7px] px-1.5 text-[13px] font-bold tabular-nums text-white"
                style={{ backgroundColor: chipColor }}
              >
                {entries.length}
              </span>
              <h3 className="min-w-0 truncate text-sm font-bold tracking-tight text-[var(--ink)]">{column.label}</h3>
              {/* % ของบอร์ด ต่อท้ายชื่อ (ไม่ไปทับรอยต่อสีทางขวา) */}
              <span className="-ml-0.5 shrink-0 text-xs font-semibold tabular-nums text-[var(--ink-soft)]">{percent}%</span>
              {/* คอมเมนต์ที่ยังไม่อ่าน — ขวาสุด ไม่มี = ไม่แสดง */}
              {unreadComments > 0 && (
                <span
                  className="ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-[var(--chart-red)] px-2 text-xs font-bold tabular-nums text-white shadow-[0_1px_3px_rgba(229,72,77,0.35)]"
                  title={`มีคอมเมนต์ที่ยังไม่ได้อ่าน ${unreadComments} รายการ ในคอลัมน์นี้`}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  {unreadComments}
                </span>
              )}
            </span>
          </HeaderTag>
        );
      })()}

      <div
        // Every column shares the exact same surface; columns are told
        // apart only by the header's dot/icon/count color and this bar's
        // fill. min-h-0 is the classic flex-child-with-overflow fix —
        // without it this column keeps growing to fit every card instead of
        // scrolling its own list within the board's fixed row height (see
        // kanban-board.tsx's scroller comment). Used to only apply at lg:,
        // same gap every self-scrolling piece of this board had below that
        // — the column had no bounded height of its own on mobile to scroll
        // within, so a tall column's cards had nowhere to go but rely on
        // whatever ambient page scroll existed above it, which is almost
        // certainly what was behind cards losing their scroll position when
        // paging between columns ("กดเลื่อนไปแล้ว...ไม่เอาอยู่ตำแหน่งเดิม").
        // Unconditional now, matching every other level of this board's
        // scroll chain (AppScaffold, tasks/page.tsx, KanbanBoard's own row).
        // <640px: ไม่มีกรอบ/ขอบในของคอลัมน์ (การ์ดชิดขอบจอ) + เว้นท้ายรายการให้พ้นปุ่ม + ลอย
        className="flex-1 flex min-h-0 flex-col gap-2 pb-24 rounded-xl overflow-y-auto transition-colors duration-200 sm:gap-1.5 sm:p-2.5 sm:bg-[var(--bg-soft)]/50"
      >
        {column.summaryOnly && column.breakdown?.length ? (
          column.breakdown.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onBreakdownClick?.(row.id)}
              disabled={!onBreakdownClick}
              className="flex items-center gap-2.5 rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-[var(--brand-green)] hover:bg-[color-mix(in_srgb,var(--brand-green)_4%,white)] disabled:hover:border-[var(--line)] disabled:hover:bg-white disabled:cursor-default"
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: row.accent }} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]">{row.label}</span>
              <span
                className="text-[11px] font-semibold rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center tabular-nums shrink-0"
                style={{ backgroundColor: `color-mix(in srgb, ${row.accent} 14%, white)`, color: `color-mix(in srgb, ${row.accent} 55%, black)` }}
              >
                {row.count}
              </span>
            </button>
          ))
        ) : column.summaryOnly ? (
          <button
            type="button"
            onClick={onHeaderClick}
            disabled={!onHeaderClick}
            className="flex-1 flex flex-col items-center justify-center gap-2.5 text-center rounded-lg border border-dashed border-[var(--line)] py-6 px-3 hover:border-[var(--brand-green)] hover:bg-white transition-colors disabled:hover:border-[var(--line)] disabled:hover:bg-transparent disabled:cursor-default"
          >
            <span className="text-sm font-semibold text-[var(--ink)]">
              {column.projectCount ?? 0} หมวด · {column.tasks.length} งาน
            </span>
            {!!column.projectNames?.length && (
              <div className="flex flex-wrap items-center justify-center gap-1.5 px-1">
                {column.projectNames.slice(0, 4).map((name) => (
                  <span
                    key={name}
                    className="max-w-[150px] truncate rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, white)`, color: textAccent }}
                    title={name}
                  >
                    {name}
                  </span>
                ))}
                {column.projectNames.length > 4 && (
                  <span className="text-[11px] font-medium text-[var(--ink-soft)]">
                    +{column.projectNames.length - 4} อื่นๆ
                  </span>
                )}
              </div>
            )}
            {onHeaderClick && (
              <span className="text-[11px] text-[var(--ink-soft)]">คลิกเพื่อดูรายละเอียด</span>
            )}
          </button>
        ) : (
          <>
            {visibleEntries.map((e) =>
              e.type === "mx" ? (
                <MaintenanceCard key={`mx-${e.item.kind}-${e.item.id}`} item={e.item} />
              ) : (
              <TaskCard
                key={e.task.id}
                task={e.task}
                onOpen={onOpen}
                showOriginalStatus={column.derived}
                groupedByPriority={groupedByPriority}
                // A done card fades so it visually "settles" next to open ones —
                // only meaningful where a column actually mixes statuses
                // (priority/assignee grouping). In the status-grouped board every
                // column is one status already (a "รอตรวจสอบ"/"เสร็จสิ้น" column is
                // 100% done by definition), so fading there just washes out the
                // whole column for no comparative benefit — every other contrast
                // fix on the card would fight this opacity for nothing.
                dimWhenDone={!groupedByStatus}
              />
              )
            )}

            <ShowMoreToggle expanded={expanded} remaining={remaining} onToggle={toggle} />

            {entries.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-xs text-[var(--ink-soft)] border border-dashed border-[var(--line)] rounded-lg py-8 text-center px-3">
                {column.emptyMessage ?? "ยังไม่มีงานในสถานะนี้"}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
