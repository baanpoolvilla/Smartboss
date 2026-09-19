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
  /** Which report-feed room this is about, if any — rendered as a small
   * label ahead of the message so someone with several rooms open can tell
   * where it happened without reading the whole sentence. Absent for
   * notifications that aren't about a room at all (task/meeting/ticket).
   * Stored as the room's name at the moment of the event (not a topicId to
   * look up later) — cheap to render anywhere without also having to sync
   * the whole report-feed store just to resolve one name, and a renamed or
   * deleted room shouldn't rewrite what already happened in someone's
   * notification history anyway. */
  topicName?: string;
  /** Where clicking this notification should go — a relative in-app path.
   * Optional so existing callers that don't have anywhere specific to send
   * someone (or haven't been updated yet) keep rendering as plain, unclickable
   * rows, same as before this field existed. */
  link?: string;
  /** แยกแจ้งเตือนแบบ "โพสต์ใหม่ในห้อง" (ส่งให้เฉพาะ owner ไว้ทำภาพรวม CEO)
   * ออกจากแจ้งเตือนที่เจาะจงถึงผู้รับโดยตรง (ถูกแท็ก/ตอบกลับ/รีแอ็กชัน/งาน/
   * ตั๋วปัญหา). "task_comment"/"task_attachment" = มีคนคอมเมนต์/แนบไฟล์ใหม่ใน
   * งาน, "task_assigned" = มีคนมอบหมาย/เพิ่มคุณเป็นผู้รับผิดชอบงานนี้ (ดู
   * taskId) ไม่มีค่า = เป็นแจ้งเตือนส่วนตัวของผู้รับแบบอื่น ๆ */
  kind?: "room_post" | "task_comment" | "task_attachment" | "task_assigned" | "sticker_settings";
  /** งานที่แจ้งเตือนนี้พูดถึง — ใส่เฉพาะ kind "task_comment"/"task_attachment"/
   * "task_assigned" ไว้นับ unread ต่อการ์ดบน Kanban (ดู task-comment-activity.ts)
   * ตัวข้อความ/ลิงก์เองไม่พอให้ parse เพราะรูปแบบข้อความเปลี่ยนได้ */
  taskId?: string;
}

interface NotificationStore {
  notifications: AppNotification[];
  notify: (n: Omit<AppNotification, "id" | "createdAt" | "read">) => void;
  /** Tag N people at once, skipping the actor themselves. */
  notifyMany: (
    userIds: string[],
    byUserId: string,
    message: string,
    meetingId?: string,
    link?: string,
    topicName?: string,
    kind?: "room_post" | "task_comment" | "task_attachment" | "task_assigned" | "sticker_settings",
    taskId?: string
  ) => void;
  markAllRead: (userId: string) => void;
  /** ทำเครื่องหมายอ่านทีละรายการ — ใช้ตอนคลิกการ์ดแจ้งเตือน (สไตล์ Facebook) */
  markRead: (id: string) => void;
  /** อ่านคอมเมนต์/ไฟล์แนบ/การมอบหมายใหม่ของงานนี้หมดแล้ว — เรียกตอนเปิดดู
   * รายละเอียดงาน (ไม่ใช่แค่คลิกจากกระดิ่ง) เพื่อให้ badge บนการ์ด/เมนูหายไป
   * ทันทีที่คนเข้าไปดูจริง ไม่ต้องรอไปคลิกที่แจ้งเตือนแยกทีละอัน ล้างทั้งสาม
   * kind พร้อมกัน — เปิดงานแล้วเห็นทั้งคอมเมนต์/ไฟล์แนบ/ตัวเองอยู่ในรายชื่อ
   * ผู้รับผิดชอบอยู่แล้วในหน้าเดียวกัน ไม่มีเหตุผลจะล้างแค่อย่างใดอย่างหนึ่ง */
  markTaskActivityRead: (userId: string, taskId: string) => void;
  /** ลบงานแล้วต้องเก็บกวาดแจ้งเตือนของงานนั้นทิ้งด้วย ไม่งั้นกระดิ่ง/badge เมนู
   * ค้างชี้ไปงานที่ไม่มีอยู่แล้ว ("ลบงานไปแล้วแต่ทำไมแจ้งเตือนยังขึ้น") จับคู่
   * ด้วย taskId (แจ้งเตือนคอมเมนต์/ไฟล์แนบใหม่) หรือ link ที่พาไป highlight
   * งานนั้นเป๊ะๆ (แจ้งเตือนงานแบบอื่น ๆ ที่เกิดก่อนมี field taskId — สถานะ
   * เปลี่ยน/ตรวจงาน/ตั้งกำหนดส่งใหม่ ฯลฯ ไม่มี taskId ผูกมา มีแต่ link) */
  removeTaskNotifications: (taskId: string) => void;
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
      notifyMany: (userIds, byUserId, message, meetingId, link, topicName, kind, taskId) =>
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
              topicName,
              kind,
              taskId,
              createdAt: new Date().toISOString(),
              read: false,
            }));
          return { notifications: [...fresh, ...s.notifications] };
        }),
      markAllRead: (userId) =>
        set((s) => ({
          notifications: s.notifications.map((n) => (n.userId === userId ? { ...n, read: true } : n)),
        })),
      markRead: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        })),
      markTaskActivityRead: (userId, taskId) =>
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.userId === userId &&
            n.taskId === taskId &&
            (n.kind === "task_comment" || n.kind === "task_attachment" || n.kind === "task_assigned") &&
            !n.read
              ? { ...n, read: true }
              : n
          ),
        })),
      removeTaskNotifications: (taskId) =>
        set((s) => ({
          notifications: s.notifications.filter(
            (n) => n.taskId !== taskId && !(n.link && n.link.includes(`highlight=${taskId}`))
          ),
        })),
    })
);
