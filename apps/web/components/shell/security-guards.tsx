"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearChatCache } from "@/modules/chat/lib/offline-cache";

/**
 * ด่านความปลอดภัยที่บริษัทเปิดเองที่ หลังบ้าน › ความปลอดภัย (ไม่เปิด = ไม่ทำอะไรเลย)
 *
 * 1) ออกจากระบบเมื่อไม่ได้ใช้งาน — เตือนก่อน 60 วินาที กด "ใช้งานต่อ" ได้ · นับรวมทุกแท็บของเครื่องนี้
 *    (แท็บหนึ่งยังใช้อยู่ = อีกแท็บไม่เด้งออก) · กำลังโทร/เล่นวิดีโออยู่นับว่าใช้งาน
 * 2) บทบาทที่ถูกบังคับยืนยันตัวตน 2 ชั้นแต่ยังไม่เปิด — พาไปหน้าตั้งค่า (หน้าเงินเดือนกันฝั่งเซิร์ฟเวอร์อีกชั้น)
 */
const ACTIVITY_KEY = "sb-last-activity";
const WARN_SECONDS = 60;

function readLast(): number {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeLast(now: number): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(now));
  } catch {
    // โหมดส่วนตัวบางเบราว์เซอร์เขียนไม่ได้ — นับเฉพาะแท็บนี้
  }
}

function mediaPlaying(): boolean {
  return Array.from(document.querySelectorAll<HTMLMediaElement>("video, audio")).some((m) => !m.paused && !m.ended);
}

export function SecurityGuards({
  idleMinutes,
  mustSetupTwoFactor,
}: {
  idleMinutes: number;
  mustSetupTwoFactor: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const loggingOut = useRef(false);
  const lastLocal = useRef(0);

  useEffect(() => {
    if (mustSetupTwoFactor && !pathname.startsWith("/account/security")) {
      router.replace("/account/security?setup=required");
    }
  }, [mustSetupTwoFactor, pathname, router]);

  useEffect(() => {
    if (idleMinutes <= 0) return;
    const limitMs = idleMinutes * 60_000;
    let lastWrite = 0;

    function touch() {
      const now = Date.now();
      lastLocal.current = now;
      // เขียน localStorage ไม่เกินทุก 5 วินาที — เลื่อนหน้าจอยิง event ถี่มาก
      if (now - lastWrite < 5000) return;
      lastWrite = now;
      writeLast(now);
    }

    async function logout() {
      if (loggingOut.current) return;
      loggingOut.current = true;
      try {
        clearChatCache();
        await fetch("/api/auth/refresh/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "idle" }),
        });
      } catch {
        // เน็ตหลุดก็ยังพาไปหน้า login — cookie เดิมจะหมดอายุเอง
      }
      window.location.replace(`/login?idle=${idleMinutes}`);
    }

    function tick() {
      if (mediaPlaying()) touch();
      const last = Math.max(readLast(), lastLocal.current);
      const remaining = limitMs - (Date.now() - last);
      if (remaining <= 0) void logout();
      else if (remaining <= WARN_SECONDS * 1000) setSecondsLeft(Math.ceil(remaining / 1000));
      else setSecondsLeft(null);
    }

    // เปิดหน้ามาครั้งแรกบนเครื่องนี้ (ยังไม่เคยจดเวลา) = เริ่มนับจากตอนนี้
    // ถ้าเคยจดไว้และเลยกำหนดไปแล้ว (ปิดแอปทิ้งไว้นาน) tick แรกจะออกจากระบบให้เลย
    if (readLast() === 0) touch();

    const events = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
    const interval = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    tick();

    return () => {
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [idleMinutes]);

  if (secondsLeft === null) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
    >
      <div className="w-full max-w-sm rounded-(--radius-lg) border border-(--line) bg-(--bg) p-5 shadow-(--shadow-card)">
        <h2 id="idle-title" className="text-base font-semibold text-(--ink)">
          ยังใช้งานอยู่ไหม?
        </h2>
        <p className="mt-2 text-sm text-(--ink-soft)">
          ไม่มีการใช้งานมาเกือบ {idleMinutes} นาที — ระบบจะออกจากระบบให้เองใน{" "}
          <strong className="text-(--ink)">{secondsLeft} วินาที</strong> เพื่อกันคนอื่นใช้เครื่องนี้ต่อ
          (บริษัทของคุณตั้งค่าไว้)
        </p>
        <p className="mt-1 text-xs text-(--ink-soft)">ข้อมูลที่พิมพ์ค้างไว้และยังไม่ได้กดบันทึกจะหาย</p>
        <button
          type="button"
          autoFocus
          onClick={() => {
            lastLocal.current = Date.now();
            writeLast(Date.now());
            setSecondsLeft(null);
          }}
          className="mt-4 h-12 w-full rounded-(--radius) bg-(--brand-navy,var(--ink)) text-sm font-semibold text-white"
        >
          ใช้งานต่อ
        </button>
      </div>
    </div>
  );
}
