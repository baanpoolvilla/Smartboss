import type { LucideIcon } from "lucide-react";

/** A compact metric pill — used in the page header and the right info panel. Every value passed in must come from real store data, never a placeholder number. */
export function StatsCard({
  icon: Icon,
  label,
  value,
  tone = "default",
  color = "var(--brand-green-dark)",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "default" | "accent";
  /** Icon color — each header stat gets its own tint so they're distinguishable at a glance, matching Teams/Notion-style stat rows. */
  color?: string;
}) {
  return (
    <div
      className={
        tone === "accent"
          ? "flex items-center gap-2.5 rounded-xl bg-[var(--accent)] border border-[var(--brand-green)]/20 px-3.5 py-2.5"
          : "flex items-center gap-2.5 rounded-xl bg-white border border-[var(--line)] px-3.5 py-2.5"
      }
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, white)`, color }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="leading-tight min-w-0">
        <p className="text-[11px] text-[var(--ink-soft)] truncate">{label}</p>
        <p className="text-[15px] font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}
