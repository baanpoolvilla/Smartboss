"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { installAuthFetch, needsRefresh, refreshSession } from "@/lib/auth-fetch";
import { isServerSyncHeld } from "@/modules/report_task/lib/sync-pause";

/**
 * ต่ออายุ session แบบเงียบ ๆ:
 * - เช็คทุกนาที + ตอนกลับมาที่แท็บ แต่ต่ออายุจริงเฉพาะตอน access token (15 นาที) เหลือไม่ถึง 3 นาที
 *   — เดิมต่ออายุทุกครั้งที่สลับกลับมาที่แท็บ หมุน refresh token ถี่จนคำตอบหายบ่อย แล้วโดนนับว่า
 *   "token ถูกขโมย" เตะออกทุกเครื่อง (ดู lib/auth-fetch.ts, packages/auth/refresh.ts)
 * - คำขอ /api ที่ได้ 401 ต่ออายุแล้วลองใหม่เอง (installAuthFetch)
 * - ต่ออายุไม่ได้จริง (session หมด) → เด้งไป /login
 */
const CHECK_INTERVAL_MS = 60 * 1000;
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

  useEffect(() => {
    function toLogin() {
      if (isServerSyncHeld()) {
        setTimeout(toLogin, HELD_RETRY_MS);
      } else {
        router.replace("/login");
      }
    }
    installAuthFetch(toLogin);

    async function check() {
      if (!needsRefresh()) return;
      // เงียบไว้ถ้าเน็ต/เซิร์ฟเวอร์พลาด — รอบถัดไปลองใหม่
      if ((await refreshSession()) === "expired") toLogin();
    }

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, CHECK_INTERVAL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") void check();
    }
    document.addEventListener("visibilitychange", onVisible);
    void check();

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
