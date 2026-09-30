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
/** ได้ยินอะไรจากท่อล่าสุดเมื่อไร (ready/ping/ข้อความ) — ใช้จับท่อที่ค้างเงียบ */
let lastHeard = 0;
let watchdog: ReturnType<typeof setInterval> | null = null;
/** เซิร์ฟเวอร์ ping ทุก 25 วิ — เงียบเกินนี้ถือว่าท่อตาย */
const SILENT_LIMIT_MS = 65_000;
/** ย่อ/สลับไปนานเกินนี้แล้วกลับมา → ดึงของที่อาจพลาดไปทันที ไม่รอท่อบอก */
const RESYNC_AFTER_HIDDEN_MS = 5_000;

// ─── บอกเซิร์ฟเวอร์ว่ากำลังดูหน้าจออยู่ไหม ───
// มือถือที่ย่อเบราว์เซอร์ยังค้างการเชื่อมต่อไว้ได้สักพัก — ถ้าไม่บอก เซิร์ฟเวอร์จะคิดว่ายังเห็นจออยู่
// แล้วไม่ส่งแจ้งเตือนเด้ง ข้อความช่วงนั้นจะเงียบ
const PRESENCE_URL = "/api/realtime/presence";
let presenceTimer: ReturnType<typeof setInterval> | null = null;
let presenceInstalled = false;

// เซิร์ฟเวอร์จำ "ดูจออยู่" แยกต่อแท็บ + รู้ endpoint Web Push ของเครื่องนี้ ⇒ ข้าม Push เฉพาะเครื่องที่ดูอยู่
// (เปิดดูในมือถือ คอมยังเด้ง และกลับกัน) — ไม่มี endpoint (ยังไม่เปิดแจ้งเตือน) ก็ส่งค่าว่าง
const TAB_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

async function pushEndpoint(): Promise<string> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration("/");
    return (await reg?.pushManager.getSubscription())?.endpoint ?? "";
  } catch {
    return "";
  }
}

function reportVisible() {
  void pushEndpoint().then((endpoint) => {
    // ย่อไประหว่างรอ endpoint — ไม่ส่ง ไม่งั้นไปถึงหลัง "ย่อแล้ว" แล้วค้างว่าดูอยู่
    if (document.visibilityState !== "visible") return;
    const body = JSON.stringify({ visible: true, tab: TAB_ID, endpoint });
    fetch(PRESENCE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  });
}

function reportHidden() {
  const body = JSON.stringify({ visible: false, tab: TAB_ID });
  // sendBeacon ส่งได้แม้หน้ากำลังถูกพักหรือปิด
  if (!navigator.sendBeacon?.(PRESENCE_URL, new Blob([body], { type: "application/json" }))) {
    fetch(PRESENCE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }
}

function onVisibility() {
  if (document.visibilityState === "visible") {
    // มือถือ/เบราว์เซอร์พักแท็บที่ย่อไว้ได้ — ท่อดูเหมือนยังต่ออยู่แต่ข้อความระหว่างนั้นอาจไม่มา
    // กลับมาหน้าจอแล้วให้ทุกตัวฟังดึงส่วนที่พลาดเอง (แชทดึงข้อความใหม่, ตัวเลขยังไม่อ่าน)
    const wasHiddenFor = hiddenAt != null ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    reportVisible();
    if (wasHiddenFor >= RESYNC_AFTER_HIDDEN_MS && status === "open") emit({ type: "realtime.reconnected" });
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
  lastHeard = Date.now();
  if (!watchdog) {
    // ท่อที่ค้างเงียบ (ไม่หลุดให้เห็น แต่ไม่มีอะไรมา) — EventSource ไม่รู้ตัวเอง ต้องปิดแล้วต่อใหม่
    // ต่อใหม่ได้ "ready" → emit realtime.reconnected → ทุกตัวฟังดึงของที่พลาดไป
    watchdog = setInterval(() => {
      if (!source || Date.now() - lastHeard < SILENT_LIMIT_MS) return;
      console.warn("[realtime] stream silent — reconnecting");
      source.close();
      source = null;
      setStatus("offline");
      open();
    }, 15_000);
  }

  es.addEventListener("ping", () => {
    lastHeard = Date.now();
  });
  es.addEventListener("ready", () => {
    lastHeard = Date.now();
    retryDelay = 2000;
    setStatus("open");
    if (everOpened) emit({ type: "realtime.reconnected" });
    everOpened = true;
  });
  es.onmessage = (e) => {
    lastHeard = Date.now();
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
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
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
