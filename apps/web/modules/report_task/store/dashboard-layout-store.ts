import { create } from "zustand";
import { persist } from "zustand/middleware";

// Every widget on the Dashboard is customizable — reorder, resize, or hide
// any of them (see dashboard-grid.tsx / dashboard-customize-bar.tsx). The
// Executive KPI row and the two big Overview donuts count as one widget
// each (same granularity as before this list grew) rather than exploding
// into one entry per card.
export type WidgetId =
  | "executiveKpi"
  | "systemKpiSummary"
  | "taskOverview"
  | "reportOverview"
  | "overdueTasks"
  | "pendingReports"
  | "recentActivity"
  | "deptBar"
  | "reportDeptBar"
  | "leaderboard"
  | "myTasks"
  | "deadlines";

/** span = how many of the 3 dashboard grid columns the widget occupies. */
export type WidgetSpan = 1 | 2 | 3;

export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  span: WidgetSpan;
}

const defaultLayout: WidgetConfig[] = [
  { id: "executiveKpi", visible: true, span: 3 },
  { id: "systemKpiSummary", visible: true, span: 3 },
  { id: "reportOverview", visible: true, span: 1 },
  { id: "taskOverview", visible: true, span: 2 },
  { id: "overdueTasks", visible: true, span: 1 },
  { id: "pendingReports", visible: true, span: 1 },
  { id: "recentActivity", visible: true, span: 1 },
  { id: "deptBar", visible: true, span: 2 },
  { id: "leaderboard", visible: true, span: 1 },
  { id: "reportDeptBar", visible: true, span: 2 },
  { id: "myTasks", visible: true, span: 1 },
  { id: "deadlines", visible: true, span: 3 },
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
      // been added (or list one that no longer exists) — keep every entry
      // this registry still recognizes in its saved order, then append
      // anything from today's defaults that's missing (e.g. the Executive
      // KPI/Analytics/Operations/Activity widgets, newly folded back into
      // this registry so the whole dashboard is customizable again, not
      // just the department/ranking/personal-task section).
      version: 2,
      migrate: (persisted) => {
        const widgets = (persisted as Partial<DashboardLayoutStore> | undefined)?.widgets ?? [];
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
        return { ...current, widgets: [...persistedWidgets, ...missing] };
      },
    }
  )
);
