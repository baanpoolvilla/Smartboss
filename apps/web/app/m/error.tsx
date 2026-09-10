"use client";

import { useEffect } from "react";

/**
 * จอ error ของ Mini App — ตั้งใจ **แสดงข้อความจริง** ไม่ใช่ "เกิดข้อผิดพลาด" ลอย ๆ
 *
 * พนักงานเปิดจากในแอป LINE บนมือถือ ไม่มี devtools ให้เปิดดู console เลย
 * ถ้าไม่พ่นข้อความจริงออกมาบนจอ เวลาพังจะไม่มีใครรู้เลยว่าพังเพราะอะไร —
 * ตอนไล่บั๊กรอบแรกเสียเวลาไปหลายรอบเพราะอาการที่เห็นคือ "เด้งออกเฉย ๆ"
 */
export default function MiniAppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // ส่งเข้า console ด้วย เผื่อวันหน้ามีใครต่อ remote debug ได้
    console.error("mini app error", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-6 pt-10">
      <div>
        <h1 className="text-lg font-bold text-(--danger)">เปิดหน้านี้ไม่สำเร็จ</h1>
        <p className="mt-1 text-sm text-(--ink-soft)">
          ถ่ายภาพหน้าจอนี้ส่งให้ผู้ดูแลระบบ จะช่วยให้แก้ได้ตรงจุด
        </p>
      </div>

      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-(--radius) bg-(--bg-soft) p-3 text-xs text-(--ink)">
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
      </pre>

      <button
        type="button"
        onClick={reset}
        className="h-12 w-full rounded-(--radius) bg-(--app) text-base font-semibold text-white"
      >
        ลองใหม่
      </button>
    </div>
  );
}
