"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Smartphone, X } from "lucide-react";

import { APP_INSTALL_VERSION, detectDevice, isStandalone, recordStandaloneLaunch, useIsClient } from "@/lib/app-install";

/**
 * บอกผู้ใช้เมื่อตัวที่เปิดอยู่เป็นเวอร์ชันเก่า — มี 2 แบบที่ต่างกันมาก:
 *
 * 1. **โค้ดเว็บเก่า** (เกิดทุกครั้งที่ deploy): แท็บหรือแอปที่เปิดค้างไว้ยังรัน JS ชุดเดิม
 *    จนกว่าจะโหลดใหม่ → แถบ "มีเวอร์ชันใหม่" กด "อัปเดต" = โหลดหน้าใหม่ **ไม่ต้องลบแอป**
 *    (service worker ของเราไม่ cache หน้าเว็บ โหลดใหม่ได้ของล่าสุดเสมอ — public/sw.js)
 *    ไม่โหลดใหม่ให้เอง เพราะอาจมีข้อความ/ฟอร์มที่พิมพ์ค้างอยู่
 *
 * 2. **ตัวแอปบนหน้าจอเก่า** (นาน ๆ ครั้ง): เปลี่ยนชื่อ/ไอคอน/start_url แล้ว iPhone ไม่
 *    อัปเดตให้เอง ต้องลบแล้วติดตั้งใหม่ — ขึ้นเฉพาะแอปบน iPhone/iPad ที่ติดตั้งก่อน
 *    APP_INSTALL_VERSION ปัจจุบัน (lib/app-install.ts) Android/คอมอัปเดตเองไม่ต้องบอก
 */

const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? null;
const POLL_MS = 5 * 60 * 1000;
const DISMISS_UPDATE_KEY = "sb-update-dismissed";
const DISMISS_REINSTALL_KEY = "sb-reinstall-dismissed";

export function AppUpdateNotice() {
  const isClient = useIsClient();
  const [newBuild, setNewBuild] = useState<string | null>(null);
  const [needsReinstall, setNeedsReinstall] = useState(false);

  useEffect(() => {
    if (!CLIENT_BUILD_ID) return;
    let stopped = false;

    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId: string | null };
        if (stopped || !buildId || buildId === CLIENT_BUILD_ID) return;
        let dismissed: string | null = null;
        try {
          dismissed = sessionStorage.getItem(DISMISS_UPDATE_KEY);
        } catch {
          // โหมดส่วนตัว
        }
        if (dismissed !== buildId) setNewBuild(buildId);
      } catch {
        // ออฟไลน์/เซิร์ฟเวอร์กำลังรีสตาร์ต — ลองใหม่รอบหน้า
      }
    }

    const first = window.setTimeout(check, 20_000);
    const timer = window.setInterval(check, POLL_MS);
    // กลับมาที่แท็บ/แอป (มือถือสลับแอปกลับมา) = จังหวะที่ควรเช็คที่สุด
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!isStandalone() || detectDevice().os !== "ios") return;
    if (recordStandaloneLaunch() >= APP_INSTALL_VERSION) return;
    try {
      if (sessionStorage.getItem(DISMISS_REINSTALL_KEY) === "1") return;
    } catch {
      // ขึ้นตามปกติ
    }
    // อ่าน display-mode/localStorage ได้หลังโหลดหน้าเท่านั้น — ตั้ง state ในนี้ตั้งใจ
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNeedsReinstall(true);
  }, []);

  if (!isClient || (!newBuild && !needsReinstall)) return null;

  const dismissUpdate = () => {
    try {
      if (newBuild) sessionStorage.setItem(DISMISS_UPDATE_KEY, newBuild);
    } catch {
      // ซ่อนแค่ตอนนี้
    }
    setNewBuild(null);
  };

  const dismissReinstall = () => {
    try {
      sessionStorage.setItem(DISMISS_REINSTALL_KEY, "1");
    } catch {
      // ซ่อนแค่ตอนนี้
    }
    setNeedsReinstall(false);
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[84px] z-[110] flex flex-col items-center gap-2 px-3 lg:bottom-6">
      {needsReinstall && (
        <div className="pointer-events-auto w-full max-w-md rounded-2xl bg-(--bg) p-4 shadow-[0_12px_32px_-8px_rgba(17,17,17,0.28)] ring-1 ring-black/[0.06]">
          <div className="flex items-start gap-3">
            <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-[#4cb93f]" />
            <div className="min-w-0 flex-1 text-sm text-(--ink)">
              <p className="font-semibold">แอป SmartBoss บนหน้าจอเป็นรุ่นเก่า</p>
              <p className="mt-0.5 text-(--ink-soft)">ลบแล้วติดตั้งใหม่ เพื่อให้ได้ไอคอนและชื่อล่าสุด ข้อมูลไม่หาย</p>
              <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-[13px] text-(--ink)">
                <li>กดค้างที่ไอคอน SmartBoss → <b>ลบแอป</b></li>
                <li>เปิด Safari เข้า {window.location.host}</li>
                <li>กดแชร์ → <b>เพิ่มไปยังหน้าจอโฮม</b></li>
              </ol>
            </div>
            <button type="button" onClick={dismissReinstall} className="rounded-full p-1 text-(--ink-soft) hover:bg-black/5" aria-label="ซ่อน">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {newBuild && (
        <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-(--ink) py-2.5 pr-2 pl-4 text-white shadow-[0_12px_32px_-8px_rgba(17,17,17,0.4)]">
          <RefreshCw className="h-4 w-4 shrink-0 opacity-80" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">มี SmartBoss เวอร์ชันใหม่</span>
            <span className="block text-xs opacity-75">กดอัปเดตเพื่อใช้ของล่าสุด ไม่ต้องลบแอป</span>
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 rounded-xl bg-[#4cb93f] px-3.5 py-2 text-sm font-semibold text-white hover:brightness-105"
          >
            อัปเดต
          </button>
          <button type="button" onClick={dismissUpdate} className="shrink-0 rounded-full p-1.5 opacity-70 hover:bg-white/10 hover:opacity-100" aria-label="ไว้ทีหลัง">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
