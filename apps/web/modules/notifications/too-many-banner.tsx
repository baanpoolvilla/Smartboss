"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { isCustom } from "./prefs";
import { useNotifPrefs } from "./use-notification-prefs";
import type { UnifiedNotification } from "./types";

/** แจ้งเตือนวันนี้ถึงเท่านี้ถึงชวน */
const THRESHOLD = 20;
/** กด ✕ แล้วไม่ถามอีกกี่วัน */
const SNOOZE_DAYS = 7;

function isToday(iso: string, nowMs: number): boolean {
  const d = new Date(iso);
  const now = new Date(nowMs);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/**
 * "แจ้งเตือนวันนี้ 48 อัน เยอะไปไหม?" + ปุ่มพาไปหน้าตั้งค่า — ไม่มีปุ่มเลือกระดับตรงนี้ ให้ไปเลือกที่หน้า
 * ตั้งค่าที่เดียว จะได้ไม่งง ("บอกแค่เยอะไปไหม ลองไปตั้งค่าดูสิ และกดพาไป")
 * ขึ้นเฉพาะคนที่ยังไม่เคยตั้ง (ระดับ "เห็นทั้งหมด" และไม่ได้ปรับเอง) · ✕ = ไม่ถามอีก 7 วัน
 */
export function TooManyNotificationsBanner({
  items,
  onGoToSettings,
}: {
  items: UnifiedNotification[];
  onGoToSettings: () => void;
}) {
  const prefs = useNotifPrefs((s) => s.prefs);
  const loaded = useNotifPrefs((s) => s.loaded);
  const save = useNotifPrefs((s) => s.save);
  // เวลาตอนเปิดกล่อง/หน้า — พอสำหรับนับ "วันนี้" และเช็ก 7 วัน (render ต้องไม่เรียก Date.now ตรง ๆ)
  const [nowMs] = useState(() => Date.now());

  const today = items.filter((n) => n.scope !== "org" && isToday(n.createdAt, nowMs)).length;
  const snoozed =
    !!prefs.bannerDismissedAt && nowMs - Date.parse(prefs.bannerDismissedAt) < SNOOZE_DAYS * 86_400_000;
  if (!loaded || today < THRESHOLD || prefs.level !== "all" || isCustom(prefs) || snoozed) return null;

  return (
    <div className="relative mx-3 my-2 rounded-xl border border-(--brand-green)/30 bg-(--brand-green)/8 px-3 py-2.5 pr-9 text-sm">
      <p className="font-semibold text-(--ink)">แจ้งเตือนวันนี้ {today} อัน เยอะไปไหม?</p>
      <p className="mt-0.5 text-xs text-(--ink-soft)">ลองไปตั้งค่าดูว่าจะให้เตือนเรื่องอะไรบ้าง</p>
      <button
        type="button"
        onClick={onGoToSettings}
        className="mt-2 inline-flex h-8 items-center rounded-lg bg-(--brand-green-dark) px-3 text-xs font-semibold text-white hover:brightness-110"
      >
        ไปที่ตั้งค่า ›
      </button>
      <button
        type="button"
        onClick={() => void save({ ...prefs, bannerDismissedAt: new Date().toISOString() })}
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
        aria-label="ปิด ไม่ต้องถามอีก"
        title="ปิด ไม่ต้องถามอีก"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
