"use client";

import { useEffect, useMemo } from "react";
import { maintenanceCategoryFor } from "./derive";
import type { NotifCategory } from "./types";
import { useMaintenanceNotifStore } from "./use-maintenance-notifications";

/**
 * ตัวเลขแดงที่ tile หน้าแรกและเมนูข้างในโมดูล — เวอร์ชันทั่วไปของ
 * AppTileReviewBadge/TaskReviewNavBadge เดิมที่ผูกกับ report_task โดยเฉพาะ
 * (คำนวณจาก tasks/posts array ตรงๆ ไม่ใช่แค่นับแจ้งเตือน) ตัวนี้ใช้กับ
 * แจ้งซ่อมบำรุง/HR ซึ่งข้อมูล "ยังไม่ได้ดู" ของทั้งสองอย่างมีแค่จำนวน
 * แจ้งเตือนที่ยังไม่อ่านใน core.notifications เท่านั้น (ไม่มี array งาน/โพสต์
 * ให้สแกนหาสถานะเพิ่มเหมือน report_task) — พอด้วยกับ /api/notifications/
 * maintenance ตัวเดียว
 *
 * ("อยากให้เห็นว่าตรงไหนมีแจ้งเตือนอะไรบ้าง...ทำให้หมดกับทุก module")
 *
 * ไม่ได้ผ่าน useUnifiedNotifications (นั่นต้องมี report_task's
 * useNotificationStore/useIdentityStore hydrate ก่อน ซึ่งหน้าแรก/โมดูลอื่นๆ
 * ไม่ได้ mount ให้) — แต่ยังอ่านจาก useMaintenanceNotifStore ตัวเดียวกับที่
 * bell popover/หน้าใบงานใช้ (ไม่ใช่ store เฉพาะ maintenance module — เก็บ
 * แจ้งเตือนทุก category จาก core.notifications) แทนที่จะยิง fetch ของตัวเอง
 * แยกต่างหากเหมือนเดิม — เดิมยิง fetch ครั้งเดียวตอน mount แล้วไม่ฟังอีกเลย
 * พอมีคน markRead จากที่อื่น (กระดิ่ง, auto-mark ตอนเปิดหน้ารายละเอียด) เลข
 * ที่นี่ไม่ขยับตาม ต้องรีเฟรชหน้าถึงจะหาย ("กดในกระดิ่งแล้วมามันหายแต่ต้อง
 * รีเฟรชเลข 1 ตรงใบงานถึงจะหาย") — subscribe ตรงๆ แก้ปัญหานี้เพราะทุกที่ที่
 * เขียน store (markRead/markReadByReference/markAllRead/refresh) แชร์
 * instance เดียวกัน re-render ที่นี่ทันทีโดยไม่ต้อง fetch เพิ่ม
 */
export function NotifCountBadge({
  categories,
  types,
  className,
}: {
  categories: NotifCategory[];
  /** จำกัดเฉพาะชนิดแจ้งเตือน (core.notifications.type) เพิ่มจาก category — ใช้แยกเลขของเมนูย่อย
   * ที่อยู่ category เดียวกัน เช่น แจ้งบัค "ทั้งหมด" (ตั๋วที่คนอื่นแจ้ง) กับ "ตั๋วของฉัน" (ความคืบหน้า
   * ของตั๋วที่ฉันแจ้งเอง) */
  types?: string[];
  className?: string;
}) {
  const items = useMaintenanceNotifStore((s) => s.items);
  const loaded = useMaintenanceNotifStore((s) => s.loaded);
  const refresh = useMaintenanceNotifStore((s) => s.refresh);

  useEffect(() => {
    // ตัวแรกที่ mount เป็นคน fetch ให้ — ถ้ามีตัวอื่น (บนหน้าเดียวกัน หรือกระดิ่ง)
    // fetch ไปแล้ว/กำลัง fetch อยู่ loaded จะยังไม่ true จนกว่าจะเสร็จ ไม่ยิงซ้ำ
    if (!loaded) void refresh();
  }, [loaded, refresh]);

  const count = useMemo(
    () =>
      items.filter(
        (it) => !it.readAt && categories.includes(maintenanceCategoryFor(it.type)) && (!types || types.includes(it.type))
      ).length,
    [items, categories, types]
  );

  if (count === 0) return null;
  return (
    <span
      className={
        className ??
        "absolute -right-1 -top-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white ring-2 ring-(--bg)"
      }
      aria-label={`มีแจ้งเตือนที่ยังไม่ได้ดู ${count} รายการ`}
      title={`มีแจ้งเตือนที่ยังไม่ได้ดู ${count} รายการ`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
