import { create } from "zustand";
import { persist } from "zustand/middleware";

export type IcsLinkTarget = "work" | "schedule";

export interface ExternalCalendarLink {
  id: string;
  label: string;
  connectedAt: string;
  /** Which calendar tab this source's events show up on. */
  target: IcsLinkTarget;
  /** Owner's pause switch — shared with the team when true. */
  visible: boolean;
}

export interface GoogleCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  sourceId: string;
  sourceLabel: string;
  /** Whoever connected this calendar — lets the shared "who's shown" list govern it, same as tasks/leaves. */
  ownerUserId: string;
  target: IcsLinkTarget;
  /** Owner's choice: shared with the whole team, or private to just them. */
  shared: boolean;
  /** Shared by every instance expanded from the same recurring source event
   *  — absent for a one-off event. See the API route for how it's built. */
  seriesId?: string;
}

interface GoogleCalendarStore {
  // Keyed by our app's userId — each person manages their own connections
  // (possibly several: Google + Outlook + Apple) here, but the resulting
  // events are shared team-wide once connected (see `events` below).
  linksByUser: Record<string, ExternalCalendarLink[]>;
  /** Every connected calendar's events, team-wide — not scoped to one viewer. */
  events: GoogleCalendarEvent[];
  lastSyncedAt: string | null;
  syncing: boolean;
  /** Bumped whenever a link is added/removed/re-targeted/re-shared — the
   * calendar's poll effect depends on this too, so a change shows up
   * immediately instead of waiting for the next scheduled poll. */
  resyncNonce: number;
  setLinks: (userId: string, links: ExternalCalendarLink[]) => void;
  setEvents: (events: GoogleCalendarEvent[]) => void;
  setSyncing: (v: boolean) => void;
  removeLink: (userId: string, linkId: string) => void;
  setLinkTarget: (userId: string, linkId: string, target: IcsLinkTarget) => void;
  setLinkVisible: (userId: string, linkId: string, visible: boolean) => void;
  requestResync: () => void;
}

export const useGoogleCalendarStore = create<GoogleCalendarStore>()(
  persist(
    (set) => ({
      linksByUser: {},
      events: [],
      lastSyncedAt: null,
      syncing: false,
      resyncNonce: 0,
      setLinks: (userId, links) => set((s) => ({ linksByUser: { ...s.linksByUser, [userId]: links } })),
      setEvents: (events) => set({ events, lastSyncedAt: new Date().toISOString() }),
      setSyncing: (syncing) => set({ syncing }),
      removeLink: (userId, linkId) =>
        set((s) => ({
          linksByUser: { ...s.linksByUser, [userId]: (s.linksByUser[userId] ?? []).filter((l) => l.id !== linkId) },
          events: s.events.filter((e) => e.sourceId !== linkId),
        })),
      setLinkTarget: (userId, linkId, target) =>
        set((s) => ({
          linksByUser: {
            ...s.linksByUser,
            [userId]: (s.linksByUser[userId] ?? []).map((l) => (l.id === linkId ? { ...l, target } : l)),
          },
        })),
      setLinkVisible: (userId, linkId, visible) =>
        set((s) => ({
          linksByUser: {
            ...s.linksByUser,
            [userId]: (s.linksByUser[userId] ?? []).map((l) => (l.id === linkId ? { ...l, visible } : l)),
          },
        })),
      requestResync: () => set((s) => ({ resyncNonce: s.resyncNonce + 1 })),
    }),
    {
      name: "eb-google-calendar",
      skipHydration: true,
      // The fetched events are cheap to re-sync and go stale fast — only
      // connection state/preference is worth persisting across reloads.
      partialize: (s) => ({ linksByUser: s.linksByUser }),
      // v1: "target: schedule" (syncing an external calendar into the
      // วันลา/วันหยุด tab) was removed — auto-detecting routine days off from
      // an outside calendar turned out more confusing than useful in
      // practice. Any link someone had already pointed at schedule just
      // moves to work instead of silently vanishing.
      version: 1,
      migrate: (persisted) => {
        const state = persisted as { linksByUser?: Record<string, ExternalCalendarLink[]> } | undefined;
        if (state?.linksByUser) {
          for (const userId of Object.keys(state.linksByUser)) {
            state.linksByUser[userId] = (state.linksByUser[userId] ?? []).map((l) =>
              l.target === "schedule" ? { ...l, target: "work" as const } : l
            );
          }
        }
        return state;
      },
    }
  )
);
