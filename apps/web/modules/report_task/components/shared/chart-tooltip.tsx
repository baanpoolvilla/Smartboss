"use client";

/**
 * One tooltip shell for every Pie/Donut on the Dashboard (§8.2) — recharts'
 * own default tooltip doesn't match the app and only shows a raw number, so
 * every chart wires this in instead via `<Tooltip content={<ChartTooltip renderRow={...} />} />`.
 * `renderRow` maps whatever a chart's own datum shape is into {color, title, lines}
 * so this component stays generic across charts with different payload shapes.
 */
export interface ChartTooltipContent {
  color: string;
  title: string;
  /** Extra lines under the title — e.g. "24 งาน · 42% ของทั้งหมด", "เสร็จ 18 · เลยกำหนด 6". */
  lines: string[];
}

export function ChartTooltip<T>({
  active,
  payload,
  renderRow,
}: {
  active?: boolean;
  payload?: { payload: T }[];
  renderRow: (datum: T) => ChartTooltipContent | null;
}) {
  if (!active || !payload?.length) return null;
  const content = renderRow(payload[0]!.payload);
  if (!content) return null;
  return (
    <div className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[13px] shadow-[0_8px_24px_-8px_rgba(17,17,17,0.22)] max-w-[220px]">
      <p className="flex items-center gap-1.5 font-semibold">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: content.color }} />
        {content.title}
      </p>
      {content.lines.map((line, i) => (
        <p key={i} className="text-[var(--ink-soft)]">{line}</p>
      ))}
    </div>
  );
}
