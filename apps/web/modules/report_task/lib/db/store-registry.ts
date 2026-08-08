/**
 * Whitelist of server-backed store keys → file path under `data/`. The
 * dynamic route `/api/report-task/store/[key]` only ever touches files listed here — this
 * is what stops a client from asking the file store to read/write an
 * arbitrary path.
 */
export const STORE_KEYS = {
  notifications: "stores/notifications.json",
  "activity-log": "stores/activity-log.json",
  departments: "stores/departments.json",
  employees: "stores/employees.json",
  // ข้อมูลเฉพาะโมดูลที่ผูกกับ core.users.id (แผนก/ตำแหน่ง/ตัวย่อ)
  // ตัวรายชื่อคนมาจาก core.users ไม่ได้เก็บที่นี่ — ดู lib/db/employee-directory.ts
  "employee-profiles": "stores/employee-profiles.json",
  holidays: "stores/holidays.json",
  leaves: "stores/leaves.json",
  "leave-types": "stores/leave-types.json",
  meetings: "stores/meetings.json",
  "penalty-settings": "stores/penalty-settings.json",
  "people-groups": "stores/people-groups.json",
  "report-feed": "stores/report-feed.json",
  "routine-dayoff": "stores/routine-dayoff.json",
  "settings-access": "stores/settings-access.json",
  stickers: "stores/stickers.json",
  templates: "stores/templates.json",
} as const;

export type StoreKey = keyof typeof STORE_KEYS;

export function fileForStoreKey(key: string): string | null {
  return Object.prototype.hasOwnProperty.call(STORE_KEYS, key)
    ? STORE_KEYS[key as StoreKey]
    : null;
}
