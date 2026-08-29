"use client";

import { useEffect } from "react";
import { Button } from "@smartboss/ui/components/button";

/**
 * ตัวรับ error ของโมดูลบุคคล
 *
 * ── ทำไมต้องมี ──
 * release.sh build ทับ .next เดิมแล้วรีสตาร์ต แท็บที่เปิดค้างไว้ก่อน deploy จึงยัง
 * อ้างชื่อไฟล์ chunk เก่า (ชื่อมี hash) ซึ่งหายไปแล้ว → ChunkLoadError
 *
 * ถ้าไม่มีไฟล์นี้ React จะ unmount subtree ทิ้งเงียบ ๆ เหลือพื้นที่ขาวโพลน
 * โดยไม่มีอะไรบอกว่าเกิดอะไรขึ้น — ผู้ใช้เห็นแล้วนึกว่าระบบพัง ทั้งที่แค่ต้องโหลดใหม่
 *
 * แยกสองกรณีชัดเจน เพราะทางแก้คนละเรื่อง: chunk เก่าแค่กดโหลดใหม่ก็จบ
 * ส่วน error จริงต้องมีคนไปดู
 */
export default function HrError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isStale =
    error.name === "ChunkLoadError" ||
    /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
      error.message,
    );

  useEffect(() => {
    // ไม่ต้องรบกวน log ด้วย chunk เก่า — มันเกิดทุกครั้งที่ปล่อยเวอร์ชันใหม่
    if (!isStale) console.error("[hr] ", error);
  }, [error, isStale]);

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-(--radius) border border-(--line) bg-(--bg) p-6">
        <h2 className="text-base font-semibold text-(--ink)">
          {isStale ? "มีการปล่อยเวอร์ชันใหม่ระหว่างที่คุณเปิดหน้านี้ค้างไว้" : "หน้านี้แสดงผลไม่สำเร็จ"}
        </h2>

        <p className="mt-2 text-sm text-(--ink-soft)">
          {isStale
            ? "หน้าที่ค้างอยู่ยังเรียกไฟล์ของเวอร์ชันเก่าซึ่งถูกแทนที่ไปแล้ว — กดโหลดใหม่แล้วใช้งานต่อได้เลย ข้อมูลไม่หาย"
            : "ลองใหม่อีกครั้ง ถ้ายังไม่หายให้แจ้งผู้ดูแลระบบพร้อมข้อความข้างล่าง"}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={() => window.location.reload()}>
            โหลดหน้านี้ใหม่
          </Button>
          {!isStale && (
            <Button type="button" variant="outline" onClick={reset}>
              ลองใหม่
            </Button>
          )}
        </div>

        {!isStale && (
          <pre className="mt-4 overflow-x-auto rounded-(--radius) bg-(--bg-soft) p-3 text-xs text-(--ink-soft)">
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
        )}
      </div>
    </div>
  );
}
