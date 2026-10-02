"use client";

/**
 * สมัครรับแจ้งเตือนแบบเด้ง (Web Push) บนเครื่องนี้ — ใช้คู่กับ public/sw.js และ
 * /api/push/subscribe ฝั่งเซิร์ฟเวอร์ (lib/web-push.ts)
 *
 * iPhone/iPad: Web Push ใช้ได้เฉพาะเมื่อ "เพิ่มลงหน้าจอหลัก" แล้วเปิดจากไอคอนนั้น
 * (iOS 16.4+) — pushSupport() บอกสถานะนี้ให้ UI แสดงคำแนะนำที่ถูกต้อง
 */

import { detectDevice, installedOnAccount, isStandalone as isInstalledApp } from "@/lib/app-install";

export type PushSupport =
  | "unsupported" // เบราว์เซอร์ไม่รองรับเลย
  | "ios-needs-install" // iPhone ที่ยังไม่ได้เพิ่มลงหน้าจอหลัก
  | "denied" // ผู้ใช้เคยกดไม่อนุญาต ต้องไปเปิดในตั้งค่าเบราว์เซอร์เอง
  | "default" // ยังไม่เคยถาม
  | "granted";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const hasApis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!hasApis) return isIos() && !isStandalone() ? "ios-needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted") return "granted";
  return "default";
}

// ─── ติดตั้งเป็นแอป (Android / Chrome บนคอม) ───
// Chrome ส่งเหตุการณ์ beforeinstallprompt มาเมื่อเว็บติดตั้งได้ — เก็บไว้ให้ปุ่ม "ติดตั้ง" เรียกทีหลัง
// (iPhone ไม่มีเหตุการณ์นี้ ต้องกด แชร์ → เพิ่มไปยังหน้าจอโฮม เอง)
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let installPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<(available: boolean) => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e as InstallPromptEvent;
    installListeners.forEach((l) => l(true));
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installListeners.forEach((l) => l(false));
  });
}

/** ฟังว่าตอนนี้กดติดตั้งเป็นแอปได้ไหม — คืนฟังก์ชันเลิกฟัง */
export function onInstallAvailable(listener: (available: boolean) => void): () => void {
  installListeners.add(listener);
  listener(installPrompt !== null);
  return () => installListeners.delete(listener);
}

/**
 * รอสัญญาณ "ติดตั้งได้" (beforeinstallprompt) ไม่เกิน ms — true = เบราว์เซอร์ตัวนี้ยังไม่มีแอป
 * (Chrome ที่ติดตั้งแอปไว้แล้วจะไม่ส่งสัญญาณนี้ / iPhone ไม่มีสัญญาณนี้เลย = false)
 */
function installableWithin(ms: number): Promise<boolean> {
  if (installPrompt) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      installListeners.delete(listener);
      resolve(false);
    }, ms);
    const listener = (available: boolean) => {
      if (!available) return;
      window.clearTimeout(timer);
      installListeners.delete(listener);
      resolve(true);
    };
    installListeners.add(listener);
  });
}

/** เปิดหน้าต่างติดตั้งของเบราว์เซอร์ — ต้องเรียกจากการกดปุ่ม */
export async function promptInstall(): Promise<boolean> {
  const p = installPrompt;
  if (!p) return false;
  await p.prompt();
  const { outcome } = await p.userChoice;
  installPrompt = null;
  installListeners.forEach((l) => l(false));
  return outcome === "accepted";
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;
let serverPush: Promise<boolean> | null = null;

/** เซิร์ฟเวอร์ตั้งค่า Web Push ไว้หรือยัง (ถามครั้งเดียวต่อแท็บ) */
export function serverPushConfigured(): Promise<boolean> {
  serverPush ??= fetch("/api/push/subscribe")
    .then((r) => r.json())
    .then((r) => Boolean(r?.publicKey))
    .catch(() => false);
  return serverPush;
}

/** ลงทะเบียน service worker (ครั้งเดียวต่อแท็บ) */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration;
  registration =
    typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null)
      : Promise.resolve(null);
  return registration;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * แปลงข้อผิดพลาดตอนสมัคร Web Push เป็นคำอธิบายที่ผู้ใช้ทำตามได้ — เดิมทุกกรณีกลายเป็น
 * "เปิดแจ้งเตือนไม่สำเร็จ" เฉย ๆ (ผู้เรียก catch ทิ้ง) บอกไม่ได้เลยว่าต้องแก้ที่ไหน
 * ("โหลดลงคอมมันขึ้น เปิดแจ้งเตือนไม่สำเร็จ")
 */
function pushErrorReason(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as { message?: string })?.message ?? String(err);
  if (name === "NotAllowedError") {
    return "เครื่องนี้ไม่อนุญาตการแจ้งเตือน — Windows: ตั้งค่า → ระบบ → การแจ้งเตือน → เปิดให้ Chrome/Edge, Mac: การตั้งค่าระบบ → การแจ้งเตือน";
  }
  if (name === "AbortError" || /push service/i.test(message)) {
    return "เบราว์เซอร์ติดต่อบริการแจ้งเตือนไม่ได้ — ถ้าใช้ Brave ให้เปิด “Use Google services for push messaging” ใน brave://settings/privacy หรือลองใช้ Chrome/Edge (เครือข่ายบางที่บล็อกไว้)";
  }
  return `เปิดแจ้งเตือนไม่สำเร็จ (${name || "Error"}: ${message})`;
}

/**
 * ขออนุญาต (ถ้ายังไม่เคย) แล้วส่งการสมัครไปเก็บที่เซิร์ฟเวอร์
 * ต้องเรียกจากการกดปุ่มของผู้ใช้ — เบราว์เซอร์ไม่ให้ถามสิทธิ์เองโดยไม่มีการกด
 */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  const support = pushSupport();
  if (support === "unsupported") return { ok: false, reason: "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน" };
  if (support === "ios-needs-install") return { ok: false, reason: "บน iPhone ให้กดแชร์ → เพิ่มไปยังหน้าจอโฮม แล้วเปิดจากไอคอนก่อน" };
  if (support === "denied") return { ok: false, reason: "การแจ้งเตือนถูกปิดไว้ — เปิดได้ที่ตั้งค่าเว็บไซต์ของเบราว์เซอร์" };

  const res = await fetch("/api/push/subscribe").then((r) => r.json()).catch(() => null);
  const publicKey: string | null = res?.publicKey ?? null;
  if (!publicKey) return { ok: false, reason: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าการแจ้งเตือน" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "ไม่ได้อนุญาตการแจ้งเตือน" };

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: "ลงทะเบียนการแจ้งเตือนไม่สำเร็จ" };
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const options = { userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) };
    try {
      sub = await reg.pushManager.subscribe(options);
    } catch (err) {
      // การสมัครเก่าที่ผูกกับกุญแจเซิร์ฟเวอร์คนละชุดค้างอยู่ — ถอนแล้วสมัครใหม่ครั้งเดียว
      if ((err as { name?: string })?.name === "InvalidStateError") {
        try {
          await (await reg.pushManager.getSubscription())?.unsubscribe();
          sub = await reg.pushManager.subscribe(options);
        } catch (retryErr) {
          return { ok: false, reason: pushErrorReason(retryErr) };
        }
      } else {
        return { ok: false, reason: pushErrorReason(err) };
      }
    }
  }
  const saved = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  return saved.ok ? { ok: true } : { ok: false, reason: "บันทึกการแจ้งเตือนไม่สำเร็จ" };
}

/**
 * อนุญาตไว้แล้ว → ส่งการสมัครซ้ำเงียบ ๆ ทุกครั้งที่เปิดเว็บ (ผูกกับผู้ใช้ที่ล็อกอินอยู่ตอนนี้
 * และกู้คืนกรณีเบราว์เซอร์ต่ออายุ endpoint ใหม่เอง)
 */
export async function refreshPushSubscription(): Promise<void> {
  if (pushSupport() !== "granted") return;
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  // มือถือ เปิดในเบราว์เซอร์ (ไม่ใช่แอป) + บัญชีนี้ใช้แอปที่ติดตั้งบนเครื่องระบบเดียวกันอยู่ + เบราว์เซอร์
  // ตัวนี้เองไม่ได้เป็นตัวที่ติดตั้งแอป (ยัง "ติดตั้งได้") → เลิกรับแจ้งเตือนทางเบราว์เซอร์ตัวนี้
  // ไม่งั้นแจ้งเตือนมาซ้ำสองทาง และอันที่มาจากเบราว์เซอร์กดแล้วเปิดเป็นแท็บเบราว์เซอร์แทนแอป
  // (เจอกับ Samsung Internet บน Android ขณะที่แอปติดตั้งจาก Chrome)
  // ห้ามยกเลิกใน Chrome ที่ติดตั้งแอปไว้เอง — แอปกับ Chrome ใช้การสมัครรับแจ้งเตือนอันเดียวกัน
  // ยกเลิกตรงนั้น = แอปเงียบไปด้วย (เช็กด้วย installableWithin: Chrome ที่มีแอปแล้วไม่ส่งสัญญาณ)
  const device = detectDevice();
  if (
    !isInstalledApp() &&
    device.os === "android" &&
    (await installedOnAccount(device.os)) &&
    (await installableWithin(4000))
  ) {
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
    return;
  }
  if (!sub) {
    await enablePush().catch(() => undefined);
    return;
  }
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  }).catch(() => undefined);
}

/** แสดงแจ้งเตือนจากหน้าเว็บเอง (แท็บเปิดอยู่แต่ไม่ได้อยู่หน้าจอ) */
export async function showLocalNotification(title: string, options: { body?: string; url?: string; tag?: string }): Promise<void> {
  if (pushSupport() !== "granted") return;
  const reg = await registerServiceWorker();
  await reg?.showNotification(title, {
    body: options.body,
    tag: options.tag,
    icon: "/icon-v4.png",
    badge: "/badge-v2.png",
    // @ts-expect-error vibrate ยังไม่อยู่ใน NotificationOptions ของ TypeScript แต่ Chrome บน Android รองรับ
    vibrate: [180, 80, 180],
    data: { url: options.url ?? "/" },
  });
}
