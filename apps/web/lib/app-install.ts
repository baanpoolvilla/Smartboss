"use client";

import { useSyncExternalStore } from "react";

/**
 * ตัวช่วยเรื่อง "ติดตั้ง SmartBoss เป็นแอป" (PWA) — ตรวจว่าเครื่องนี้/เบราว์เซอร์นี้
 * เป็นแบบไหน เพื่อให้หน้าจอแนะนำติดตั้งบอกขั้นตอนที่ตรงกับเครื่องจริง
 * (ปุ่มติดตั้งจริงของ Chrome อยู่ใน lib/push-client.ts: onInstallAvailable/promptInstall)
 */

/**
 * เวอร์ชันของ "ตัวแอปที่ติดตั้งบนหน้าจอ" — **ไม่ใช่** เวอร์ชันโค้ดเว็บ (โค้ดอัปเดตเอง
 * ทุกครั้งที่ deploy ไม่ต้องลงใหม่ ดู components/shell/app-update-notice.tsx)
 *
 * เพิ่มเลขนี้ **เฉพาะ** ตอนเปลี่ยนสิ่งที่ iPhone/iPad ไม่อัปเดตให้เองหลังติดตั้งไปแล้ว:
 * ชื่อแอป, ไอคอน, start_url/scope ใน app/manifest.ts — แอปบน iPhone ที่ติดตั้งก่อน
 * เลขนี้จะขึ้นแถบบอกให้ลบแล้วติดตั้งใหม่ (Android/Chrome บนคอมอัปเดตเอง ไม่ต้องบอก)
 */
export const APP_INSTALL_VERSION = 1;

const INSTALLED_KEY = "sb-app-installed";
const INSTALL_VERSION_KEY = "sb-app-install-version";

export type InAppBrowser = "line" | "facebook" | "instagram" | "tiktok" | "other";

export interface DeviceInfo {
  os: "ios" | "android" | "desktop";
  /** เปิดอยู่ในเบราว์เซอร์ในแอปอื่น (LINE/Facebook ฯลฯ) — ติดตั้งจากตรงนี้ไม่ได้ */
  inApp: InAppBrowser | null;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: fullscreen)").matches ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function detectDevice(): DeviceInfo {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  let inApp: InAppBrowser | null = null;
  if (/\bLine\//i.test(ua)) inApp = "line";
  else if (/FBAN|FBAV|FB_IAB|FBIOS|Messenger/i.test(ua)) inApp = "facebook";
  else if (/Instagram/i.test(ua)) inApp = "instagram";
  else if (/BytedanceWebview|musical_ly|TikTok/i.test(ua)) inApp = "tiktok";
  else if (android && /; wv\)/.test(ua)) inApp = "other";
  return { os: ios ? "ios" : android ? "android" : "desktop", inApp };
}

/** ถือว่า "ยังติดตั้งอยู่" ถ้าเปิดจากแอปภายในช่วงนี้ — เลยจากนี้ (ลบแอปไปแล้ว/ไม่ได้ใช้)
 * เบราว์เซอร์จะกลับมาชวนติดตั้งใหม่เอง */
export const INSTALLED_FRESH_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * เครื่องนี้เพิ่งยืนยันว่าติดตั้งแล้ว (ภายใน INSTALLED_FRESH_MS) — จำเวลาไว้ใน localStorage
 *
 * Android/Chrome บนคอม: แอปใช้ storage ร่วมกับเบราว์เซอร์ เปิดจากแอปแล้วเบราว์เซอร์รู้ด้วย
 * iPhone: แอปบนหน้าจอโฮมแยก storage จาก Safari — ตัวตัดสินหลักจึงเป็นบัญชี
 * (installedOnAccount / /api/app-install) ค่านี้เป็นแค่ตัวช่วยตอนกด "ติดตั้งแล้ว" เอง
 */
export function installedHint(): boolean {
  try {
    const at = Number(localStorage.getItem(INSTALLED_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < INSTALLED_FRESH_MS;
  } catch {
    return false;
  }
}

export function markInstalled(): void {
  try {
    localStorage.setItem(INSTALLED_KEY, String(Date.now()));
  } catch {
    // โหมดส่วนตัว — ไม่จำ
  }
}

/** บัญชีนี้เปิดจากแอปบนเครื่องระบบเดียวกันภายใน INSTALLED_FRESH_MS ไหม (ถามเซิร์ฟเวอร์) */
export async function installedOnAccount(os: DeviceInfo["os"]): Promise<boolean> {
  try {
    const res = await fetch("/api/app-install", { cache: "no-store" });
    if (!res.ok) return false;
    const seen = (await res.json()) as Partial<Record<DeviceInfo["os"], string>>;
    const at = seen[os] ? Date.parse(seen[os]!) : NaN;
    return Number.isFinite(at) && Date.now() - at < INSTALLED_FRESH_MS;
  } catch {
    return false;
  }
}

const PING_KEY = "sb-app-install-ping";
/** แอปที่ติดตั้งแจ้งเซิร์ฟเวอร์ว่ายังใช้อยู่ — วันละครั้งต่อเครื่องพอ */
export function pingInstalled(os: DeviceInfo["os"]): void {
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(PING_KEY) === today) return;
  } catch {
    // ส่งทุกครั้ง
  }
  void fetch("/api/app-install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: os }),
  })
    .then((res) => {
      if (res.ok) localStorage.setItem(PING_KEY, today);
    })
    .catch(() => undefined);
}

/** ลืมว่าเคยติดตั้ง — เรียกเมื่อรู้แน่ว่าเครื่องนี้ไม่มีแอปแล้ว (Chrome บอกว่าติดตั้งได้อีก) */
export function forgetInstalled(): void {
  try {
    localStorage.removeItem(INSTALLED_KEY);
  } catch {
    // โหมดส่วนตัว
  }
}

/**
 * เปิดจากแอปที่ติดตั้งอยู่ — จำว่าติดตั้งแล้ว และคืนเวอร์ชันตัวแอปที่ติดตั้ง
 * ครั้งแรกที่เจอ (ยังไม่มีค่า) ถือว่าเป็นเวอร์ชันปัจจุบัน — แอปที่ติดตั้งไว้ก่อนมีฟีเจอร์นี้
 * จึงไม่ถูกสั่งให้ลงใหม่ จนกว่าจะเพิ่ม APP_INSTALL_VERSION จริง
 */
export function recordStandaloneLaunch(): number {
  markInstalled();
  try {
    const stored = Number(localStorage.getItem(INSTALL_VERSION_KEY));
    if (!stored) {
      localStorage.setItem(INSTALL_VERSION_KEY, String(APP_INSTALL_VERSION));
      return APP_INSTALL_VERSION;
    }
    return stored;
  } catch {
    return APP_INSTALL_VERSION;
  }
}

/** ลิงก์หน้าปัจจุบันที่ LINE จะเปิดในเบราว์เซอร์ภายนอกให้ (พารามิเตอร์ของ LINE เอง) */
export function lineExternalUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.set("openExternalBrowser", "1");
  return url.toString();
}

const noopSubscribe = () => () => {};
/** true หลัง hydrate เท่านั้น — ข้อมูลเครื่อง (userAgent, display-mode) ไม่มีฝั่งเซิร์ฟเวอร์ */
export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
