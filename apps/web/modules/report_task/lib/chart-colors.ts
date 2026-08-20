// Raw hex mirrors of the CSS custom properties in globals.css.
// Recharts sets `fill`/`stroke` as SVG presentation attributes, so we pass
// resolved hex values directly rather than var() to avoid any renderer quirks.

export const chartColors = {
  // Status traffic-light — mirrors globals.css's --chart-green/amber/red/gray.
  // Brand-anchored (bright/saturated, matching --brand-green #39e05a), not
  // the earlier earth-toned pass.
  green: "#22c55e",
  greenDark: "#39e05a", // = --brand-green, mirrored as hex for Recharts fill/stroke
  greenLight: "#fde047", // "done late" — a pale yellow, kept light so it doesn't blend into --chart-amber (see globals.css)
  // "รอตรวจสอบ" vs "เสร็จสิ้น" need to read as clearly different states at a
  // glance (one still needs a sign-off, the other is actually finished) — a
  // pale/deep pair reads that distinction better than two columns sharing
  // the exact same mid-tone green.
  greenPale: "#86efac", // "รอตรวจสอบ" — done but not yet reviewed
  greenDeep: "#1e7830", // = --brand-green-dark — "เสร็จสิ้น", reviewed & signed off
  amber: "#f59e0b",
  amberDark: "#b45309",
  amberLight: "#fcd34d",
  red: "#ef4444",
  redDark: "#b91c1c",
  redLight: "#fca5a5",
  gray: "#94a3b8",
  grayDark: "#475569",
  grayLight: "#cbd5e1",
  // Categorical (non-status) — departments, rooms, leave types, etc.
  blue: "#2a78d6",
  orange: "#eb6834",
  violet: "#4a3aa7",
  pink: "#e87ba4",
  teal: "#0d9488",
} as const;

// Mirrors statusMeta's traffic-light mapping (task-meta.ts) for renderers
// (Recharts) that need a raw hex value instead of a Tailwind class.
export const statusColors = {
  todo: chartColors.gray,
  in_progress: chartColors.amber,
  done: chartColors.green,
} as const;

// A 6th+ department in a pie folds into "อื่นๆ" using this gray, so it
// never gets confused with an individual department's own color.
export const chartGray = "#94a3b8";

// Department pies (§8) — one distinct categorical hue per department, cycled
// in this order. Colored by that department's own rate (green/amber/red)
// was tried first, but when most departments land in the same rate band
// (e.g. everyone under 50%) almost the whole donut turns one color and
// individual departments become indistinguishable — the exact thing color
// is supposed to prevent here. Identity, not performance, is what this
// chart's color needs to encode.
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
