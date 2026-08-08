import { create } from "zustand";

/**
 * Work-calendar task scope: "mine" (only tasks the viewer is assigned to or
 * assigned to someone else) vs "all" (everything canSeeTask already allows —
 * a department head's whole department, or the whole company for the owner).
 * Lives outside calendar-view so the sidebar/summary-dialog components (which
 * fetch their own task lists rather than receiving them as props) can read it
 * without prop-drilling through the view.
 */
interface CalendarScopeStore {
  scope: "mine" | "all";
  setScope: (scope: "mine" | "all") => void;
}

export const useCalendarScopeStore = create<CalendarScopeStore>((set) => ({
  scope: "mine",
  setScope: (scope) => set({ scope }),
}));
