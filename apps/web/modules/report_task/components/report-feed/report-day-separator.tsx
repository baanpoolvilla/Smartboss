/** "— วันนี้ · 7 ส.ค. 2569 —" style divider between a feed's day-grouped runs (C12). */
export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2" role="separator" aria-label={label}>
      <div className="h-px flex-1 bg-[var(--line)]" />
      <span className="shrink-0 text-[11px] font-medium text-[var(--ink-soft)]">{label}</span>
      <div className="h-px flex-1 bg-[var(--line)]" />
    </div>
  );
}
