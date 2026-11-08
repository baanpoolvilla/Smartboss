"use client";

import { useEffect, useRef, startTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { subscribeRealtime, type RealtimeEventMessage } from "@/lib/realtime-client";

/**
 * "อัปเดตหน้าเอง" สำหรับหน้าที่เซิร์ฟเวอร์สร้าง (แจ้งซ่อม ระบบบุคคล เบิกจ่าย เงินเดือน คนงานรายวัน ฯลฯ)
 * ผู้ใช้ 8/11/2569: "บางหน้าต้องกด F5 ถึงเห็นข้อมูลใหม่" — หน้าพวกนี้สร้างครั้งเดียวตอนเปิด คนอื่นแก้ข้อมูลแล้วไม่มีอะไรบอก
 *
 * ดึงข้อมูลของหน้าใหม่ (router.refresh — คงสถานะฝั่งเบราว์เซอร์ ข้อความที่พิมพ์ค้างไม่หาย) เมื่อ:
 *   - กลับมาที่หน้าต่างหลังซ่อนไว้เกิน 5 วิ
 *   - มีแจ้งเตือนใหม่ถึงตัวเอง (notify.new) — ส่วนใหญ่แปลว่ามีคนแก้เรื่องที่เกี่ยวกับเรา
 *   - เปิดค้างไว้ ทุก 60 วิ
 * ไม่ทำเมื่อ: หน้าต่างถูกซ่อน · กำลังพิมพ์ในช่องกรอก · มีหน้าต่างฟอร์ม/เมนูเปิดอยู่ · เพิ่งดึงไปไม่ถึง 10 วิ
 * หน้าที่อัปเดตสดอยู่แล้ว (แชท รีพอร์ต บอร์ดงาน แจ้งบัค) ข้าม — มีตัวซิงก์ของตัวเอง
 */
const LIVE_PREFIXES = ["/chat-report", "/report-task", "/issue-reports", "/chat", "/m/"];
const IDLE_REFRESH_MS = 60_000;
const MIN_GAP_MS = 10_000;
const HIDDEN_LONG_MS = 5_000;

function busy(): boolean {
  if (typeof document === "undefined") return true;
  if (document.visibilityState !== "visible") return true;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return true;
  // หน้าต่างฟอร์ม / dialog / เมนูที่เปิดอยู่ — ดึงใหม่ระหว่างนี้เสี่ยงทำให้สิ่งที่กำลังทำเปลี่ยนใต้มือ
  if (document.querySelector('[role="dialog"], [aria-modal="true"], [role="menu"], [data-state="open"][role="listbox"]')) return true;
  return false;
}

export function LiveRefresh() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const lastRefresh = useRef(0); // ตั้งค่าจริงใน effect ข้างล่าง (เปลี่ยนหน้า = ข้อมูลใหม่)
  const pending = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const live = LIVE_PREFIXES.some((p) => pathname.startsWith(p));

  useEffect(() => {
    lastRefresh.current = Date.now(); // เพิ่งเปลี่ยนหน้า = ข้อมูลใหม่อยู่แล้ว
  }, [pathname]);

  useEffect(() => {
    if (live) return;
    const refresh = (force = false) => {
      if (!force && Date.now() - lastRefresh.current < MIN_GAP_MS) {
        pending.current = true; // เพิ่งดึงไป — จำไว้ ดึงทันทีที่ครบช่วงห่าง (ไม่ทิ้งไปรอรอบ 60 วิ)
        return;
      }
      if (busy()) {
        pending.current = true; // ทำตอนว่าง (รอบตัวจับเวลาถัดไป / ตอนกลับมาที่หน้าต่าง)
        return;
      }
      pending.current = false;
      lastRefresh.current = Date.now();
      startTransition(() => router.refresh());
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (away >= HIDDEN_LONG_MS || pending.current) refresh();
    };
    const off = subscribeRealtime((e: RealtimeEventMessage) => {
      if (e.type === "notify.new") setTimeout(() => refresh(), 800); // ให้การบันทึกของอีกฝั่งลงฐานข้อมูลก่อน
    });
    const timer = setInterval(() => {
      if (pending.current || Date.now() - lastRefresh.current >= IDLE_REFRESH_MS) refresh();
    }, 2_000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      off();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [live, router]);

  return null;
}
