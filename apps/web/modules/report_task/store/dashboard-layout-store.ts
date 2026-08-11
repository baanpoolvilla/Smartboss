import { create } from "zustand";
import { persist } from "zustand/middleware";

// Every widget on the Dashboard is customizable — reorder, resize, or hide
// any of them (see dashboard-grid.tsx / dashboard-customize-bar.tsx). The
// two big Overview donuts count as one widget each (same granularity as
// before this list grew) rather than exploding into one entry per card —
// Task and Report Overview stay two separate cards (each has its own
// domain-specific labels), only the KPI summary widget merges the two
// domains into one bar.
export type WidgetId =
  | "systemKpiSummary"
  | "taskOverview"
  | "reportOverview"
  | "deptPie"
  | "reportDeptPie"
  | "overdueTasks"
  | "pendingReports";

/** span = how many of the 2 dashboard grid columns the widget occupies — 1
 * (half, paired with a sibling of equal importance) or 2 (full width, its
 * own tier). Kept to just two sizes so every tier reads as either one
 * full-width headline or two equal-weight cards side by side, ranked
 * top-to-bottom by importance — not the mismatched 2/3-vs-1/3 split the
 * 3-column grid used to produce. */
export type WidgetSpan = 1 | 2;

export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  span: WidgetSpan;
}

// Four tiers, ranked top-to-bottom by importance: 1) the one headline KPI
// card (full width, the combined-domain summary), 2) the two domain-level
// Overview donuts (the detail behind it) at equal width, 3) the two
// department pies (compare across teams) at equal width, 4) the two
// row-level detail lists (what to act on, last) at equal width.
const defaultLayout: WidgetConfig[] = [
  { id: "systemKpiSummary", visible: true, span: 2 },
  { id: "taskOverview", visible: true, span: 1 },
  { id: "reportOverview", visible: true, span: 1 },
  { id: "deptPie", visible: true, span: 1 },
  { id: "reportDeptPie", visible: true, span: 1 },
  { id: "overdueTasks", visible: true, span: 1 },
  { id: "pendingReports", visible: true, span: 1 },
];

interface DashboardLayoutStore {
  widgets: WidgetConfig[];
  toggleWidget: (id: WidgetId) => void;
  setSpan: (id: WidgetId, span: WidgetSpan) => void;
  reorder: (activeId: WidgetId, overId: WidgetId) => void;
  reset: () => void;
}

export const useDashboardLayoutStore = create<DashboardLayoutStore>()(
  persist(
    (set) => ({
      widgets: defaultLayout,
      toggleWidget: (id) =>
        set((s) => ({
          widgets: s.widgets.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)),
        })),
      setSpan: (id, span) =>
        set((s) => ({
          widgets: s.widgets.map((w) => (w.id === id ? { ...w, span } : w)),
        })),
      reorder: (activeId, overId) =>
        set((s) => {
          const from = s.widgets.findIndex((w) => w.id === activeId);
          const to = s.widgets.findIndex((w) => w.id === overId);
          if (from === -1 || to === -1 || from === to) return s;
          const next = [...s.widgets];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved!);
          return { widgets: next };
        }),
      reset: () => set({ widgets: defaultLayout }),
    }),
    {
      name: "eb-dashboard-layout",
      skipHydration: true,
      // Someone's already-persisted layout may predate a widget that's since
      // been added, renamed, or removed — keep every entry this registry
      // still recognizes in its saved order, then append anything from
      // today's defaults that's missing. Bumped to 5 when the grid went from
      // 3 columns to 2 (equal-width tiers, ranked by importance) — `span: 3`
      // no longer exists, and with the "ปรับแต่ง" UI gone there's no way for
      // anyone to fix a stale span themselves, so span is always re-applied
      // from `defaultLayout` by id below rather than trusting whatever a
      // pre-redesign layout had saved (order/visibility still carry over).
      version: 5,
      migrate: (persisted) => {
        const rawWidgets = (persisted as Partial<DashboardLayoutStore> | undefined)?.widgets ?? [];
        const idRenames: Record<string, WidgetId> = { deptBar: "deptPie", reportDeptBar: "reportDeptPie" };
        const defaultSpanOf = new Map(defaultLayout.map((w) => [w.id, w.span]));
        const widgets = rawWidgets
          .map((w) => (w.id in idRenames ? { ...w, id: idRenames[w.id]! } : w))
          .map((w) => ({ ...w, span: defaultSpanOf.get(w.id) ?? w.span }));
        const known = new Set(defaultLayout.map((w) => w.id));
        const kept = widgets.filter((w) => known.has(w.id));
        const keptIds = new Set(kept.map((w) => w.id));
        const missing = defaultLayout.filter((w) => !keptIds.has(w.id));
        return { widgets: [...kept, ...missing] };
      },
      merge: (persisted, current) => {
        const persistedWidgets = (persisted as Partial<DashboardLayoutStore> | undefined)?.widgets;
        if (!persistedWidgets) return current;
        const knownIds = new Set(persistedWidgets.map((w) => w.id));
        const missing = defaultLayout.filter((w) => !knownIds.has(w.id));
        const defaultSpanOf = new Map(defaultLayout.map((w) => [w.id, w.span]));
        const widgets = persistedWidgets.map((w) => ({ ...w, span: defaultSpanOf.get(w.id) ?? w.span }));
        return { ...current, widgets: [...widgets, ...missing] };
      },
    }
  )
);
