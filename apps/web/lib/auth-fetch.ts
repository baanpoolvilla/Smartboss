"use client";

/**
 * ต่ออายุ session ฝั่งหน้าเว็บ — ใช้ร่วมกันระหว่างตัวต่ออายุตามเวลา (components/shell/session-refresher.tsx)
 * กับ fetch ที่เจอ 401
 *
 * ทำไมต้องระวังความถี่: ทุกครั้งที่ต่ออายุ refresh token ใบเก่าจะใช้ไม่ได้อีก ถ้าคำตอบไปไม่ถึงเครื่อง
 * (แอปถูกพัก/โหลดหน้าใหม่กลางคัน) เครื่องจะถือใบเก่าค้าง — เซิร์ฟเวอร์กู้ให้ได้ 5 นาที
 * (packages/auth/refresh.ts) แต่ยิ่งหมุนน้อยยิ่งดี จึง:
 *  - ต่ออายุเฉพาะตอน access token ใกล้หมด (อ่านเวลาจาก cookie sb_access_exp)
 *  - ทุกแท็บใช้กุญแจเดียวกัน (Web Locks) — แท็บแรกต่ออายุ แท็บอื่นเห็นเวลาใหม่แล้วไม่ต้องทำซ้ำ
 */

const EXP_COOKIE = "sb_access_exp";
/** ต่ออายุเมื่อเหลือน้อยกว่านี้ */
export const REFRESH_BEFORE_MS = 3 * 60_000;

export type RefreshOutcome = "ok" | "expired" | "error";

/** access token เหลืออีกกี่ ms — null = ไม่รู้ (ไม่มี cookie: หมดแล้ว หรือ session เก่าก่อนมี cookie นี้) */
export function accessMsLeft(): number | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)sb_access_exp=(\d+)/);
  return m ? Number(m[1]) - Date.now() : null;
}

export function needsRefresh(): boolean {
  const left = accessMsLeft();
  return left === null || left < REFRESH_BEFORE_MS;
}

let inflight: Promise<RefreshOutcome> | null = null;

async function doRefresh(force: boolean): Promise<RefreshOutcome> {
  // อีกแท็บเพิ่งต่ออายุให้ระหว่างรอกุญแจ — ไม่ต้องหมุนซ้ำ
  if (!force && !needsRefresh()) return "ok";
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST" });
    if (res.ok) return "ok";
    return res.status === 401 ? "expired" : "error";
  } catch {
    return "error";
  }
}

/**
 * ต่ออายุ (ครั้งเดียวพร้อมกันทั้งแท็บนี้ และทีละแท็บข้ามแท็บ)
 * force = เซิร์ฟเวอร์เพิ่งตอบ 401 — ต่ออายุแม้ cookie เวลาบอกว่ายังไม่หมด (เช่น นาฬิกาเครื่องเพี้ยน)
 */
export function refreshSession(force = false): Promise<RefreshOutcome> {
  if (inflight) return inflight;
  const run = () => doRefresh(force);
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const viaLock = async (): Promise<RefreshOutcome> => (locks ? await locks.request(EXP_COOKIE, run) : run());
  const p = viaLock().finally(() => {
    inflight = null;
  });
  inflight = p;
  return p;
}

let installed = false;
let onExpired: (() => void) | null = null;

/**
 * ครอบ window.fetch: คำขอ /api ของเว็บนี้ที่ได้ 401 (access token หมดระหว่างแท็บถูกพัก) → ต่ออายุแล้วลองใหม่
 * หนึ่งครั้ง แทนที่ทุกโมดูลจะขึ้น "โหลดข้อมูลไม่สำเร็จ" · ต่ออายุไม่ได้จริง (session หมด) → onExpired
 */
export function installAuthFetch(expired: () => void): void {
  onExpired = expired;
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    const guarded =
      url.origin === window.location.origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/");
    if (!guarded) return original(input, init);

    // Request ที่มี body อ่านได้ครั้งเดียว — เก็บสำเนาไว้ลองใหม่
    const retryInput = input instanceof Request ? input.clone() : input;
    const res = await original(input, init);
    if (res.status !== 401) return res;

    const outcome = await refreshSession(true);
    if (outcome === "ok") return original(retryInput, init);
    if (outcome === "expired") onExpired?.();
    return res;
  };
}
