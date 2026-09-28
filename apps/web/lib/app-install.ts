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

/**
 * เคยติดตั้ง/เปิดจากแอปบนเครื่องนี้แล้วหรือยัง — จำไว้ใน localStorage
 *
 * Android/Chrome บนคอม: แอปที่ติดตั้งใช้ storage ร่วมกับเบราว์เซอร์ จึงรู้ได้จากในแท็บปกติ
 * iPhone: แอปบนหน้าจอโฮมแยก storage จาก Safari ⇒ Safari ไม่มีทางรู้เอง ต้องให้ผู้ใช้กด
 * "ติดตั้งแล้ว" (markInstalled) บนหน้าจอแนะนำ
 */
export function installedHint(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markInstalled(): void {
  try {
    localStorage.setItem(INSTALLED_KEY, "1");
  } catch {
    // โหมดส่วนตัว — ไม่จำ
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
