import { create } from "zustand";

export interface AppNotification {
  id: string;
  /** Recipient. */
  userId: string;
  message: string;
  /** Who triggered it, so we can skip self-notifying. */
  byUserId: string;
  createdAt: string;
  read: boolean;
  meetingId?: string;
}

interface NotificationStore {
  notifications: AppNotification[];
  notify: (n: Omit<AppNotification, "id" | "createdAt" | "read">) => void;
  /** Tag N people at once, skipping the actor themselves. */
  notifyMany: (userIds: string[], byUserId: string, message: string, meetingId?: string) => void;
  markAllRead: (userId: string) => void;
}

// Server-synced via ServerStoreSync (apiKey "notifications") in
// store-hydrator.tsx — shared across teammates, not per-browser.
export const useNotificationStore = create<NotificationStore>()(
  (set) => ({
      notifications: [],
      notify: (n) =>
        set((s) => ({
          notifications: [
            { ...n, id: `notif-${crypto.randomUUID()}`, createdAt: new Date().toISOString(), read: false },
            ...s.notifications,
          ],
        })),
      notifyMany: (userIds, byUserId, message, meetingId) =>
        set((s) => {
          const fresh = userIds
            .filter((id) => id !== byUserId)
            .map((userId) => ({
              id: `notif-${crypto.randomUUID()}`,
              userId,
              byUserId,
              message,
              meetingId,
              createdAt: new Date().toISOString(),
              read: false,
            }));
          return { notifications: [...fresh, ...s.notifications] };
        }),
      markAllRead: (userId) =>
        set((s) => ({
          notifications: s.notifications.map((n) => (n.userId === userId ? { ...n, read: true } : n)),
        })),
    })
);
