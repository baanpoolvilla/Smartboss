"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { isServerSyncHeld } from "@/modules/report_task/lib/sync-pause";

/**
 * ต่ออายุ session แบบเงียบ ๆ:
 * - เรียก /api/auth/refresh ทุก ๆ ~13 นาที (ก่อน access token 15 นาทีหมดอายุ)
 * - เรียกอีกครั้งเมื่อผู้ใช้กลับมาโฟกัสหน้าจอ
 * - ถ้า refresh ล้มเหลว (401) → เด้งไป /login
 */
const REFRESH_INTERVAL_MS = 13 * 60 * 1000;
/** ตอน session หมดอายุจริง ๆ ระหว่างที่ isServerSyncHeld() ค้างอยู่ (เช่นแผง
 * "จัดลำดับห้อง" เปิดอยู่) — รอสักพักแล้วเช็คใหม่ แทนที่จะ router.replace()
 * ทันที ซึ่งคือ full navigation ที่ unmount ทั้งหน้ากลางที่ browser กำลังลาก
 * ห้องด้วย native HTML5 drag อยู่พอดี (dragend ไม่มีทางถูกยิงเลย ค้างเป็นแถว
 * จาง ๆ เหมือนที่ sync-pause.ts อธิบายไว้กับตัว poll ของ ServerStoreSync เอง
 * — ตัวนี้เป็นอีกทางที่ทำให้หน้าโดน unmount กลางอากาศแบบเดียวกัน ที่ guard
 * เดิมไม่ครอบ). */
const HELD_RETRY_MS = 5000;

export function SessionRefresher() {
  const router = useRouter();
  const refreshing = useRef(false);

  useEffect(() => {
    async function refresh() {
      if (refreshing.current) return;
      refreshing.current = true;
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST" });
        if (res.status === 401) {
          if (isServerSyncHeld()) {
            setTimeout(refresh, HELD_RETRY_MS);
          } else {
            router.replace("/login");
          }
        }
      } catch {
        // เงียบไว้ — ปล่อยให้ interval รอบถัดไปหรือ proxy จัดการ
      } finally {
        refreshing.current = false;
      }
    }

    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
