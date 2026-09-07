import { create } from "zustand";

/** Shape of a maintenance notification once it's crossed the wire — Prisma's
 * `DateTime`/nullable fields become plain strings/null after JSON.stringify. */
export interface MaintenanceNotif {
  id: string;
  title: string;
  body: string | null;
  type: string;
  referenceId: string | null;
  createdAt: string;
  readAt: string | null;
}

interface MaintenanceNotifStore {
  items: MaintenanceNotif[];
  /** `true` once the first fetch has completed (success or failure) — lets
   * callers avoid flashing "no notifications" before data has even loaded. */
  loaded: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/** Client-side mirror of `core.notifications` for the logged-in user (real
 * auth session, via /api/notifications/maintenance — NOT the report_task
 * module's demo `viewingAsUserId`). Plain zustand, not persisted — this is
 * server-owned data, re-fetched on demand (mount + whenever the bell
 * dropdown opens) rather than kept in sync continuously like the
 * report_task store's own server-synced state. */
export const useMaintenanceNotifStore = create<MaintenanceNotifStore>()((set, get) => ({
  items: [],
  loaded: false,
  async refresh() {
    try {
      const res = await fetch("/api/notifications/maintenance");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: MaintenanceNotif[] };
      set({ items: data.items, loaded: true });
    } catch {
      // Network hiccup/not logged in yet — leave whatever's already loaded
      // in place rather than clearing a good list out from under the user.
      set({ loaded: true });
    }
  },
  async markRead(id) {
    const prev = get().items;
    set({ items: prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)) });
    try {
      await fetch("/api/notifications/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      set({ items: prev });
    }
  },
  async markAllRead() {
    const prev = get().items;
    const now = new Date().toISOString();
    set({ items: prev.map((n) => (n.readAt ? n : { ...n, readAt: now })) });
    try {
      await fetch("/api/notifications/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch {
      set({ items: prev });
    }
  },
}));
