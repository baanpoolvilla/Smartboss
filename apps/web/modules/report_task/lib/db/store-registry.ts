/**
 * Whitelist ของคีย์ที่เก็บฝั่งเซิร์ฟเวอร์ได้ — route `/api/report-task/store/[key]`
 * แตะเฉพาะคีย์ที่อยู่ในรายการนี้ กันไม่ให้ client ยิงคีย์มั่วเข้ามา
 *
 * ⚠ ค่าทางขวาเป็นชื่อไฟล์ของต้นทาง (เก็บเป็นไฟล์ JSON) ที่นี่ **ไม่ได้ใช้**
 * เพราะเก็บลง Postgres `report_task.stores` แยกตามบริษัทแทน — เก็บไว้ให้
 * ไฟล์ต่างจากต้นทางน้อยที่สุด เวลาดึงเวอร์ชันใหม่มาทับจะได้เทียบง่าย
 * (ดู docs/report_task_port.md)
 */
export const STORE_KEYS = {
  notifications: "stores/notifications.json",
  "activity-log": "stores/activity-log.json",
  departments: "stores/departments.json",
  employees: "stores/employees.json",
  // ── ของ Smartboss เพิ่มเอง ──
  // ข้อมูลเฉพาะโมดูลที่ผูกกับ core.users.id (แผนก/ตำแหน่ง/ตัวย่อ)
  // ตัวรายชื่อคนมาจาก core.users ไม่ได้เก็บที่นี่ — ดู lib/db/employee-directory.ts
  "employee-profiles": "stores/employee-profiles.json",
  holidays: "stores/holidays.json",
  leaves: "stores/leaves.json",
  todos: "stores/todos.json",
  "leave-types": "stores/leave-types.json",
  "issue-reports": "stores/issue-reports.json",
  "issue-desk-config": "stores/issue-desk-config.json",
  meetings: "stores/meetings.json",
  "penalty-settings": "stores/penalty-settings.json",
  "people-groups": "stores/people-groups.json",
  "report-feed": "stores/report-feed.json",
  "routine-dayoff": "stores/routine-dayoff.json",
  "settings-access": "stores/settings-access.json",
  stickers: "stores/stickers.json",
  "project-topics": "stores/project-topics.json",
  "attachment-settings": "stores/attachment-settings.json",
  "reminder-settings": "stores/reminder-settings.json",
  // Plain string[] of dedup keys already fired (see lib/reminder-sweep.ts) —
  // server-only, no client store reads this directly.
  "reminder-sent-log": "stores/reminder-sent-log.json",
} as const;

export type StoreKey = keyof typeof STORE_KEYS;

export function fileForStoreKey(key: string): string | null {
  return Object.prototype.hasOwnProperty.call(STORE_KEYS, key)
    ? STORE_KEYS[key as StoreKey]
    : null;
}
