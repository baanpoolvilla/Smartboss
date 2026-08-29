"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * รีเฟรชรายการสแกนเองทุก 15 วินาที
 *
 * หน้านี้ใช้ตอนยืนอยู่หน้าเครื่องแล้วให้คนลองแตะนิ้ว — ถ้าต้องกด F5 เองทุกครั้ง
 * จะแยกไม่ออกว่า "ยังไม่ขึ้น" เพราะเครื่องไม่ส่ง หรือเพราะยังไม่ได้รีเฟรช
 *
 * ปิดได้ เพราะเวลานั่งไล่ดูข้อมูลย้อนหลัง การที่ตารางขยับเองจะกวนมากกว่าช่วย
 */
export function AutoRefresh() {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => {
      router.refresh();
      setTick((n) => n + 1);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [on, router]);

  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-(--ink-soft)">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => setOn(e.target.checked)}
        className="h-4 w-4"
      />
      <span>
        รีเฟรชอัตโนมัติทุก 15 วิ
        {on && tick > 0 ? ` · อัปเดตแล้ว ${tick} ครั้ง` : ""}
      </span>
    </label>
  );
}
