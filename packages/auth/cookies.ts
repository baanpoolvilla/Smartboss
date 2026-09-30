import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  COOKIE_SECURE,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL,
  ACCESS_TOKEN_TTL,
  ttlToSeconds,
} from "./env";

/** โครงสร้างขั้นต่ำของ cookie store (รองรับทั้ง next/headers และ NextResponse.cookies) */
export interface CookieSetter {
  set(cookie: {
    name: string;
    value: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
    path?: string;
    maxAge?: number;
  }): void;
}

const baseCookie = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: "lax" as const,
};

/**
 * เวลาหมดอายุของ access token (ms) ให้หน้าเว็บอ่านได้ — ตัว token เป็น httpOnly อ่านไม่ได้ หน้าเว็บ
 * เลยต้องต่ออายุแบบเดา ๆ ทุกครั้งที่สลับกลับมาที่แท็บ (หมุน refresh token ถี่เกินจำเป็น ยิ่งถี่ยิ่งมีโอกาส
 * คำตอบหาย) — มีแค่ตัวเลขเวลา ไม่มีอะไรลับ (apps/web/components/shell/session-refresher.tsx)
 */
export const COOKIE_ACCESS_EXP = "sb_access_exp";

export function setAccessCookie(store: CookieSetter, token: string): void {
  const maxAge = ttlToSeconds(ACCESS_TOKEN_TTL);
  store.set({
    ...baseCookie,
    name: COOKIE_ACCESS,
    value: token,
    path: "/",
    maxAge,
  });
  store.set({
    ...baseCookie,
    httpOnly: false,
    name: COOKIE_ACCESS_EXP,
    value: String(Date.now() + maxAge * 1000),
    path: "/",
    maxAge,
  });
}

export function setRefreshCookie(store: CookieSetter, token: string): void {
  store.set({
    ...baseCookie,
    name: COOKIE_REFRESH,
    value: token,
    path: REFRESH_COOKIE_PATH,
    maxAge: ttlToSeconds(REFRESH_TOKEN_TTL),
  });
}

export function clearAuthCookies(store: CookieSetter): void {
  store.set({ ...baseCookie, name: COOKIE_ACCESS, value: "", path: "/", maxAge: 0 });
  store.set({ ...baseCookie, httpOnly: false, name: COOKIE_ACCESS_EXP, value: "", path: "/", maxAge: 0 });
  store.set({
    ...baseCookie,
    name: COOKIE_REFRESH,
    value: "",
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  });
}
