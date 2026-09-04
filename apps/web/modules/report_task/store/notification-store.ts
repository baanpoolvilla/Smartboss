import { create } from "zustand";
import { uuid } from "@/modules/report_task/lib/uuid";

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
  /** Where clicking this notification should go — a relative in-app path.
   * Optional so existing callers that don't have anywhere specific to send
   * someone (or haven't been updated yet) keep rendering as plain, unclickable
   * rows, same as before this field existed. */
  link?: string;
}

interface NotificationStore {
  notifications: AppNotification[];
  notify: (n: Omit<AppNotification, "id" | "createdAt" | "read">) => void;
  /** Tag N people at once, skipping the actor themselves. */
  notifyMany: (userIds: string[], byUserId: string, message: string, meetingId?: string, link?: string) => void;
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
            { ...n, id: `notif-${uuid()}`, createdAt: new Date().toISOString(), read: false },
            ...s.notifications,
          ],
        })),
      notifyMany: (userIds, byUserId, message, meetingId, link) =>
        set((s) => {
          const fresh = userIds
            .filter((id) => id !== byUserId)
            .map((userId) => ({
              id: `notif-${uuid()}`,
              userId,
              byUserId,
              message,
              meetingId,
              link,
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
