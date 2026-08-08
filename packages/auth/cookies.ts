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

export function setAccessCookie(store: CookieSetter, token: string): void {
  store.set({
    ...baseCookie,
    name: COOKIE_ACCESS,
    value: token,
    path: "/",
    maxAge: ttlToSeconds(ACCESS_TOKEN_TTL),
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
  store.set({
    ...baseCookie,
    name: COOKIE_REFRESH,
    value: "",
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  });
}
