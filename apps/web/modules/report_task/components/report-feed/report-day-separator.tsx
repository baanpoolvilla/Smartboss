/** "— วันนี้ · 7 ส.ค. 2569 —" style divider between a feed's day-grouped runs (C12). */
export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2" role="separator" aria-label={label}>
      <div className="h-px flex-1 bg-[#CBD5E1] opacity-50" />
      {/* text-xs, regular weight — a date is orientation, not something to
          read with the same weight as a username (§3's hierarchy: this
          should sit quieter than the people actually posting). */}
      <span className="shrink-0 text-xs font-normal text-[var(--ink-soft)]">{label}</span>
      <div className="h-px flex-1 bg-[#CBD5E1] opacity-50" />
    </div>
  );
}
