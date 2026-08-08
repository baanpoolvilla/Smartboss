// Raw hex mirrors of the CSS custom properties in globals.css.
// Recharts sets `fill`/`stroke` as SVG presentation attributes, so we pass
// resolved hex values directly rather than var() to avoid any renderer quirks.

export const chartColors = {
  green: "#39e05a",
  blue: "#2a78d6",
  orange: "#eb6834",
  violet: "#4a3aa7",
  pink: "#e87ba4",
  amber: "#eda100",
  red: "#e34948",
  gray: "#9ca3af",
  teal: "#0d9488",
} as const;

// Mirrors statusMeta's traffic-light mapping (task-meta.ts) for renderers
// (Recharts) that need a raw hex value instead of a Tailwind class.
export const statusColors = {
  todo: chartColors.red,
  in_progress: chartColors.amber,
  done: chartColors.green,
} as const;

export const departmentColorOrder = [
  chartColors.blue,
  chartColors.violet,
  chartColors.orange,
  chartColors.amber,
  chartColors.green,
  chartColors.pink,
];

export const chartChrome = {
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  mutedText: "#6b7280",
  surface: "#ffffff",
};
