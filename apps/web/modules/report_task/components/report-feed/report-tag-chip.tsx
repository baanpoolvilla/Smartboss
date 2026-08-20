import type { ReportTag } from "@/modules/report_task/store/report-tag-store";

/** Read-only tag pill — tinted background + matching text color from the
 * tag's own `color`, same `color-mix(...16%, white)` recipe topic-sidebar.tsx
 * uses for room icons, so a tag reads as visually related to (but distinct
 * from) a room badge rather than inventing a third color language. */
export function ReportTagChip({ tag }: { tag: ReportTag }) {
  return (
    <span
      className="shrink-0 truncate max-w-[160px] rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${tag.color} 16%, white)`, color: tag.color }}
      title={tag.name}
    >
      {tag.name}
    </span>
  );
}
