import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import type { Sticker } from "@/modules/report_task/types";

/** ป้ายคะแนนอ่านง่าย: "+5" / "-5" / "0" */
function pointsLabel(points: number) {
  return points > 0 ? `+${points}` : `${points}`;
}

/**
 * ทุกครั้งที่สติกเกอร์ "มีผลต่อคะแนน" ถูกเพิ่ม/แก้ไข/ลบจากหน้าตั้งค่า —
 * แจ้งเตือนพนักงานทุกคนในบริษัท (ไม่ใช่แค่ owner/หัวหน้าแผนกเหมือน pattern
 * แจ้งเตือนอื่นในโมดูลนี้) ว่ามีการเปลี่ยนกติกาให้คะแนน — ตามที่ขอ "แจ้งให้
 * ทั้งบริษัททราบ" ตรงตัว. ใช้ตอนบันทึกจาก StickerManagerPanel และตอนเพิ่มจาก
 * ป็อปอัปเลือกสติกเกอร์โดยตรง (ช่องว่างในแถวมีผลต่อคะแนน).
 */
export function notifyStickerChange(
  kind: "added" | "edited" | "removed",
  sticker: Pick<Sticker, "emoji" | "label" | "points">,
  byUserId: string
) {
  const allUserIds = useEmployeeStore.getState().employees.map((e) => e.id);
  const tag = `${sticker.emoji} ${sticker.label}`;
  const message =
    kind === "added"
      ? `เพิ่มสติกเกอร์ใหม่ "${tag}" แล้ว มีผลต่อคะแนน (${pointsLabel(sticker.points)})`
      : kind === "edited"
        ? `แก้ไขสติกเกอร์ "${tag}" แล้ว มีผลต่อคะแนน (${pointsLabel(sticker.points)})`
        : `ลบสติกเกอร์ "${tag}" ออกแล้ว จะไม่มีผลต่อคะแนนอีกต่อไปตั้งแต่นี้`;

  useNotificationStore
    .getState()
    .notifyMany(allUserIds, byUserId, message, undefined, "/report-task/settings?section=stickers", undefined, "sticker_settings");
}
