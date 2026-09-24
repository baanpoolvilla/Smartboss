"use client";

/**
 * สมัครรับแจ้งเตือนแบบเด้ง (Web Push) บนเครื่องนี้ — ใช้คู่กับ public/sw.js และ
 * /api/push/subscribe ฝั่งเซิร์ฟเวอร์ (lib/web-push.ts)
 *
 * iPhone/iPad: Web Push ใช้ได้เฉพาะเมื่อ "เพิ่มลงหน้าจอหลัก" แล้วเปิดจากไอคอนนั้น
 * (iOS 16.4+) — pushSupport() บอกสถานะนี้ให้ UI แสดงคำแนะนำที่ถูกต้อง
 */

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
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
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
    icon: "/icon.png",
    badge: "/badge.png",
    // @ts-expect-error vibrate ยังไม่อยู่ใน NotificationOptions ของ TypeScript แต่ Chrome บน Android รองรับ
    vibrate: [180, 80, 180],
    data: { url: options.url ?? "/" },
  });
}
