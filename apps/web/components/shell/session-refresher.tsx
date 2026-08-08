"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * ต่ออายุ session แบบเงียบ ๆ:
 * - เรียก /api/auth/refresh ทุก ๆ ~13 นาที (ก่อน access token 15 นาทีหมดอายุ)
 * - เรียกอีกครั้งเมื่อผู้ใช้กลับมาโฟกัสหน้าจอ
 * - ถ้า refresh ล้มเหลว (401) → เด้งไป /login
 */
const REFRESH_INTERVAL_MS = 13 * 60 * 1000;

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
          router.replace("/login");
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
