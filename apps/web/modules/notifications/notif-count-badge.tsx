"use client";

import { useEffect, useState } from "react";
import { maintenanceCategoryFor } from "./derive";
import type { NotifCategory } from "./types";

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
 * ไม่ได้ mount ให้) — ยิง fetch ของตัวเองตรงๆ เหมือนที่ AppTileReviewBadge ทำ
 */
export function NotifCountBadge({ categories, className }: { categories: NotifCategory[]; className?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/maintenance")
      .then((res) => res.json())
      .then((data: { items?: { type: string; readAt: string | null }[] }) => {
        if (cancelled) return;
        const n = (data.items ?? []).filter(
          (it) => !it.readAt && categories.includes(maintenanceCategoryFor(it.type))
        ).length;
        setCount(n);
      })
      .catch(() => {
        // Best-effort — a failed fetch just leaves the badge hidden.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.join(",")]);

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
