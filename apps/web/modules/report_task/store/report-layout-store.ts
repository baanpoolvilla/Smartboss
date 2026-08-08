import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ReportWidgetId = "kpi" | "statusDonut" | "priorityBar" | "departmentBar" | "memberBar" | "table";

/** span = how many of the 3 report grid columns the widget occupies. */
export type ReportWidgetSpan = 1 | 2 | 3;

export interface ReportWidgetConfig {
  id: ReportWidgetId;
  visible: boolean;
  span: ReportWidgetSpan;
}

const defaultLayout: ReportWidgetConfig[] = [
  { id: "kpi", visible: true, span: 3 },
  { id: "statusDonut", visible: true, span: 1 },
  { id: "priorityBar", visible: true, span: 2 },
  { id: "departmentBar", visible: true, span: 1 },
  { id: "memberBar", visible: true, span: 2 },
  { id: "table", visible: true, span: 3 },
];

interface ReportLayoutStore {
  widgets: ReportWidgetConfig[];
  toggleWidget: (id: ReportWidgetId) => void;
  setSpan: (id: ReportWidgetId, span: ReportWidgetSpan) => void;
  reorder: (activeId: ReportWidgetId, overId: ReportWidgetId) => void;
  /** The "revert if it doesn't look good" escape hatch — back to the original fixed layout. */
  reset: () => void;
}

export const useReportLayoutStore = create<ReportLayoutStore>()(
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
      name: "eb-report-layout",
      skipHydration: true,
      // A browser that saved a layout before a widget existed would never see
      // it (persisted array wins outright by default) — append any default
      // widget missing from the persisted list. Also drop any persisted id
      // that's no longer a real widget (e.g. one removed since), since the
      // registry has nothing to render it with.
      merge: (persisted, current) => {
        const p = persisted as ReportLayoutStore | undefined;
        if (!p?.widgets) return current;
        const known = p.widgets.filter((pw) => defaultLayout.some((w) => w.id === pw.id));
        const missing = defaultLayout.filter((w) => !known.some((pw) => pw.id === w.id));
        return { ...current, ...p, widgets: [...known, ...missing] };
      },
    }
  )
);
