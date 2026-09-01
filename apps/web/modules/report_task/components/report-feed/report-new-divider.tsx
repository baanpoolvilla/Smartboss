/** Discord-style "new messages" line — a thin red rule marking where this
 * viewer's unread posts begin. Its position is frozen at the first-unread
 * post when the room is opened (see ReportFeed / OpenchatFeed), so it doesn't
 * creep as posts get marked read while you scroll. "ข้อความใหม่" sits on the
 * right, the same side Discord puts its "NEW" tag. */
export function NewMessagesDivider() {
  return (
    <div className="flex items-center gap-2 px-5 py-0.5" role="separator" aria-label="ข้อความใหม่">
      <div className="h-px flex-1 bg-[var(--chart-red)] opacity-60" />
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[var(--chart-red)]">
        ข้อความใหม่
      </span>
    </div>
  );
}
