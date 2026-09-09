export type NotifModule = "report" | "maintenance";

export type NotifCategory =
  | "report_post"
  | "reply"
  | "mention"
  | "reaction"
  | "task"
  /** rejectReview() in task-store.ts — "ตรวจงาน...แล้วไม่ผ่าน" ใช้คำว่า "งาน"
   * เหมือนแจ้งเตือนงานทั่วไปทุกอย่าง เลยเคยได้ไอคอนติ๊กถูกเขียวเดียวกับตอน
   * "ผ่าน" ("ต้องแยกสิเวลาโดนไม่ผ่าน") — แยกเป็นหมวดของตัวเอง ไอคอนย้อนกลับ
   * สีแดง ให้ต่างจากติ๊กถูกเขียวของ "ผ่าน"/"เสร็จ" ชัดเจนตั้งแต่แวบแรก */
  | "task_rejected"
  | "meeting"
  | "ticket"
  | "report_reminder"
  | "work_order"
  | "pm"
  | "expense"
  | "purchase_order"
  | "general";

/** Normalized shape both notification sources (report_task's client store +
 * maintenance's Prisma-backed `core.notifications`) get mapped into, so the
 * bell popover and the full /notifications page render one merged, sorted
 * list instead of two side-by-side sections. */
export interface UnifiedNotification {
  /** Prefixed with the source (`rt:`/`mt:`) so ids from the two sources
   * can never collide once merged into one list/key space. */
  id: string;
  module: NotifModule;
  category: NotifCategory;
  /** report: the notification's own message. maintenance: the record's title. */
  message: string;
  /** maintenance only — the record's body, if any. */
  body?: string | null;
  /** report only — who triggered it, for the avatar. maintenance notifications
   * aren't attributed to a person, so this stays undefined for those. */
  byUserId?: string;
  /** report: topicName. maintenance notifications aren't scoped to a room. */
  roomName?: string;
  createdAt: string;
  read: boolean;
  link?: string | null;
}
