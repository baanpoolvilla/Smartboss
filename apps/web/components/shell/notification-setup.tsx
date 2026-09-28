"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BellRing, X } from "lucide-react";
import { toast } from "sonner";

import { detectDevice, isStandalone, useIsClient, type DeviceInfo } from "@/lib/app-install";
import { enablePush, pushSupport, refreshPushSubscription, serverPushConfigured } from "@/lib/push-client";

/**
 * ชวนเปิดการแจ้งเตือนทันทีที่เปิดแอป ("เปิดแจ้งเตือนให้ตั้งค่าง่าย ๆ ตั้งแต่ตอนโหลดเสร็จ")
 *
 * ขึ้นเมื่อ: เปิดจากแอปที่ติดตั้งแล้ว (ทุกระบบ) หรือใช้บนคอม และยังไม่เคยตอบ
 *   - iPhone/iPad: Web Push ใช้ได้เฉพาะจากแอปที่ติดตั้ง (iOS 16.4+) — ใน Safari จึงไม่ถาม
 *     ให้ InstallGate พาไปติดตั้งก่อน พอเปิดจากไอคอนค่อยถามที่นี่
 *   - มือถือในเบราว์เซอร์ที่ยังไม่ติดตั้ง: InstallGate ขึ้นก่อน ไม่ถามซ้อน
 * เบราว์เซอร์ให้ขอสิทธิ์ได้เฉพาะจากการกดปุ่ม จึงเป็นการ์ดมีปุ่ม ไม่ใช่เด้งถามเอง
 * เคยกดบล็อก → การ์ดบอกวิธีเปิดกลับตามเครื่อง · "ไว้ทีหลัง" ซ่อน 3 วัน
 * อนุญาตแล้ว → ส่งการสมัครซ้ำเงียบ ๆ ทุกครั้งที่เปิด (ผูกกับผู้ใช้ปัจจุบัน)
 */

const SNOOZE_KEY = "sb-notify-setup-snooze";
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now()));
  } catch {
    // โหมดส่วนตัว — ซ่อนแค่รอบนี้
  }
}

type Mode = "ask" | "denied";

export function NotificationSetup() {
  const isClient = useIsClient();
  const [mode, setMode] = useState<Mode | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const support = pushSupport();
    if (support === "granted") {
      void refreshPushSubscription();
      return;
    }
    if (support === "unsupported" || support === "ios-needs-install") return;

    const d = detectDevice();
    // มือถือในเบราว์เซอร์ = ให้ติดตั้งก่อน (InstallGate) ถามตอนเปิดจากแอป
    if (!isStandalone() && d.os !== "desktop") return;
    if (snoozed()) return;

    let cancelled = false;
    // รอให้หน้าโหลดเสร็จก่อนค่อยขึ้น ไม่แย่งความสนใจตอนเปิดแอปพอดี
    const timer = window.setTimeout(async () => {
      if (!(await serverPushConfigured()) || cancelled) return;
      setDevice(d);
      setMode(support === "denied" ? "denied" : "ask");
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (!isClient || !mode || !device) return null;

  const later = () => {
    snooze();
    setMode(null);
  };

  const turnOn = async () => {
    setBusy(true);
    const r = await enablePush().catch((err: unknown) => ({
      ok: false,
      reason: `เปิดแจ้งเตือนไม่สำเร็จ (${(err as Error)?.message ?? String(err)})`,
    }));
    setBusy(false);
    if (r.ok) {
      toast.success("เปิดการแจ้งเตือนแล้ว");
      setMode(null);
      return;
    }
    // กดไม่อนุญาตในหน้าต่างของเบราว์เซอร์ → เปลี่ยนเป็นวิธีเปิดกลับ
    if (pushSupport() === "denied") {
      setMode("denied");
      return;
    }
    toast.error(r.reason ?? "เปิดแจ้งเตือนไม่สำเร็จ");
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+68px)] z-[105] flex justify-center px-3">
      <div
        role="dialog"
        aria-labelledby="notify-setup-title"
        className="pointer-events-auto w-full max-w-md rounded-2xl bg-(--bg) p-4 shadow-[0_16px_40px_-10px_rgba(17,17,17,0.35)] ring-1 ring-black/[0.06]"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e9f7e6]">
            <BellRing className="h-5 w-5 text-[#4cb93f]" />
          </span>
          <div className="min-w-0 flex-1">
            <p id="notify-setup-title" className="text-[15px] font-semibold text-(--ink)">
              {mode === "ask" ? "เปิดการแจ้งเตือน" : "การแจ้งเตือนถูกปิดอยู่"}
            </p>
            <p className="mt-0.5 text-sm text-(--ink-soft)">
              {mode === "ask"
                ? "รับแจ้งเตือนงาน แชท และรายงานทันที แม้ไม่ได้เปิดแอปอยู่"
                : "เปิดกลับได้ตามขั้นตอนนี้ แล้วกลับมาเปิดแอปใหม่"}
            </p>
          </div>
          <button type="button" onClick={later} className="rounded-full p-1 text-(--ink-soft) hover:bg-black/5" aria-label="ไว้ทีหลัง">
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === "ask" ? (
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={turnOn}
              className="flex-1 rounded-xl bg-[#4cb93f] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-105 disabled:opacity-60"
            >
              {busy ? "กำลังเปิด…" : "เปิดการแจ้งเตือน"}
            </button>
            <button type="button" onClick={later} className="rounded-xl px-3 py-2.5 text-sm text-(--ink-soft) hover:bg-(--bg-soft)">
              ไว้ทีหลัง
            </button>
          </div>
        ) : (
          <ol className="mt-3 list-decimal space-y-1 rounded-xl bg-(--bg-soft) py-2.5 pr-3 pl-8 text-[13px] leading-relaxed text-(--ink)">
            {deniedSteps(device).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
      </div>
    </div>,
    document.body,
  );
}

function deniedSteps(device: DeviceInfo): string[] {
  if (device.os === "ios") {
    return ["เปิดแอป “ตั้งค่า” ของ iPhone/iPad", "เลือก การแจ้งเตือน → SmartBoss", "เปิด “อนุญาตการแจ้งเตือน”"];
  }
  if (device.os === "android") {
    return [
      "กดค้างที่ไอคอน SmartBoss บนหน้าจอ → ข้อมูลแอป (ⓘ)",
      "เลือก การแจ้งเตือน แล้วเปิด",
      "ถ้ายังไม่ได้: Chrome → ⋮ → การตั้งค่า → การตั้งค่าเว็บไซต์ → การแจ้งเตือน → อนุญาตเว็บนี้",
    ];
  }
  return [
    "กดไอคอนแม่กุญแจ (หรือ ⓘ) ข้างชื่อเว็บด้านบน — ในแอปที่ติดตั้ง: เมนู ⋯ → ข้อมูลแอป",
    "ตั้ง การแจ้งเตือน เป็น “อนุญาต”",
    "เช็คว่า Windows/Mac เปิดการแจ้งเตือนให้เบราว์เซอร์ด้วย (Windows: ตั้งค่า → ระบบ → การแจ้งเตือน)",
  ];
}
