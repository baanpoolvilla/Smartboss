"use client";

/**
 * ท่อสดฝั่งเบราว์เซอร์ — EventSource เส้นเดียวต่อแท็บ ใช้ร่วมกันทุกคอมโพเนนต์ที่ฟังอยู่
 * (หน้าแชท, ตัวเลขบนเมนู, ตัวเด้งแจ้งเตือน) เปิดเมื่อมีคนฟังคนแรก ปิดเมื่อไม่มีใครฟัง
 *
 * หลุดแล้ว EventSource ต่อใหม่เอง — พอต่อได้อีกครั้งจะส่ง { type: "realtime.reconnected" }
 * ให้ผู้ฟังดึงส่วนที่พลาดไประหว่างหลุด (เช่น แชทดึง ?after=<seq ล่าสุด>)
 * ถ้าเซิร์ฟเวอร์ปิดเส้นถาวร (เช่น session หมดอายุ) ถอยไปลองใหม่แบบห่างขึ้นเรื่อย ๆ
 */

export interface RealtimeEventMessage {
  type: string;
  [key: string]: unknown;
}

export type RealtimeStatus = "connecting" | "open" | "offline";

type Handler = (event: RealtimeEventMessage) => void;
type StatusHandler = (status: RealtimeStatus) => void;

const handlers = new Set<Handler>();
const statusHandlers = new Set<StatusHandler>();
let source: EventSource | null = null;
let status: RealtimeStatus = "offline";
let everOpened = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenAt: number | null = null;

// ─── บอกเซิร์ฟเวอร์ว่ากำลังดูหน้าจออยู่ไหม ───
// มือถือที่ย่อเบราว์เซอร์ยังค้างการเชื่อมต่อไว้ได้สักพัก — ถ้าไม่บอก เซิร์ฟเวอร์จะคิดว่ายังเห็นจออยู่
// แล้วไม่ส่งแจ้งเตือนเด้ง ข้อความช่วงนั้นจะเงียบ
const PRESENCE_URL = "/api/realtime/presence";
let presenceTimer: ReturnType<typeof setInterval> | null = null;
let presenceInstalled = false;

function reportVisible() {
  fetch(PRESENCE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"visible":true}', keepalive: true }).catch(() => {});
}

function reportHidden() {
  const body = '{"visible":false}';
  // sendBeacon ส่งได้แม้หน้ากำลังถูกพักหรือปิด
  if (!navigator.sendBeacon?.(PRESENCE_URL, new Blob([body], { type: "application/json" }))) {
    fetch(PRESENCE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }
}

function onVisibility() {
  if (document.visibilityState === "visible") {
    hiddenAt = null;
    reportVisible();
  } else {
    hiddenAt = Date.now();
    reportHidden();
  }
}

function installPresence() {
  if (presenceInstalled || typeof document === "undefined") return;
  presenceInstalled = true;
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", reportHidden);
  if (document.visibilityState === "visible") reportVisible();
  else hiddenAt = Date.now();
  // ต่ออายุทุก 30 วิขณะดูหน้าจอ (เซิร์ฟเวอร์ลืมเองใน 45 วิ ถ้าเครื่องหายไปเฉย ๆ)
  presenceTimer = setInterval(() => {
    if (document.visibilityState === "visible") reportVisible();
  }, 30_000);
}

function uninstallPresence() {
  if (!presenceInstalled) return;
  presenceInstalled = false;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("pagehide", reportHidden);
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
}

/** หน้าเว็บเพิ่งถูกย่อ/สลับออกไปไม่เกิน ms นี้ — ช่วงที่เซิร์ฟเวอร์อาจยังไม่รู้ตัว */
export function hiddenRecently(ms: number): boolean {
  return hiddenAt != null && Date.now() - hiddenAt < ms;
}

function setStatus(next: RealtimeStatus) {
  if (status === next) return;
  status = next;
  for (const h of statusHandlers) h(next);
}

function emit(event: RealtimeEventMessage) {
  for (const h of handlers) {
    try {
      h(event);
    } catch (err) {
      console.error("[realtime] handler failed", err);
    }
  }
}

function open() {
  if (source || typeof window === "undefined" || typeof EventSource === "undefined") return;
  setStatus("connecting");
  installPresence();
  const es = new EventSource("/api/realtime");
  source = es;

  es.addEventListener("ready", () => {
    retryDelay = 2000;
    setStatus("open");
    if (everOpened) emit({ type: "realtime.reconnected" });
    everOpened = true;
  });
  es.onmessage = (e) => {
    try {
      emit(JSON.parse(e.data));
    } catch {
      // ข้อมูลเสีย — ข้าม
    }
  };
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      // เบราว์เซอร์เลิกต่อเอง (เช่น 401/500) — ต่อใหม่เองแบบถอยห่าง
      es.close();
      if (source === es) source = null;
      setStatus("offline");
      if (handlers.size > 0 && !retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (handlers.size > 0) open();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60_000);
      }
    } else {
      setStatus("connecting");
    }
  };
}

function close() {
  source?.close();
  source = null;
  uninstallPresence();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  setStatus("offline");
}

/** ฟังเหตุการณ์จากท่อสด — คืนฟังก์ชันเลิกฟัง */
export function subscribeRealtime(handler: Handler): () => void {
  handlers.add(handler);
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  open();
  return () => {
    handlers.delete(handler);
    // หน่วงปิดไว้นิดหนึ่ง — เปลี่ยนหน้าแล้วคอมโพเนนต์ใหม่มาฟังต่อทันที ไม่ต้องต่อเส้นใหม่
    if (handlers.size === 0 && !closeTimer) {
      closeTimer = setTimeout(() => {
        closeTimer = null;
        if (handlers.size === 0) close();
      }, 5000);
    }
  };
}

export function onRealtimeStatus(handler: StatusHandler): () => void {
  statusHandlers.add(handler);
  handler(status);
  return () => statusHandlers.delete(handler);
}

export function realtimeStatus(): RealtimeStatus {
  return status;
}
