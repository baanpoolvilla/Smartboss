import "server-only";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * ตัวเรียก Google Ads API ผ่าน REST (spec §2–3)
 *
 * Google ไม่มี client library ทางการสำหรับ Node — spec แนะนำให้แยก service
 * Python ถ้าภาษาไม่ตรง แต่ REST endpoint `googleAds:searchStream` ให้ข้อมูลชุด
 * เดียวกันทุกอย่าง จึงเรียกตรงจากโปรเซสเว็บเดิม ไม่ต้องเพิ่ม service ที่ 5 บน VM
 *
 * Credential อยู่ใน env ของเซิร์ฟเวอร์เท่านั้น (spec §2 / §9) ห้ามส่งไป browser:
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID      เลข MCC (ใส่ขีดหรือไม่ก็ได้ — ตัดขีดออกก่อนส่ง)
 *   GOOGLE_ADS_API_VERSION            เช่น v25 — ตรวจเวอร์ชันล่าสุดที่
 *                                     developers.google.com/google-ads/api
 *   GOOGLE_ADS_DEVELOPER_TOKEN        ไม่บังคับ — ปัจจุบัน Google ผูกระดับการเข้าถึง
 *                                     (Test/Explorer/Basic/Standard) กับ Google Cloud
 *                                     project ของ credential แล้ว ตัวอย่าง REST ทางการ
 *                                     ไม่ส่ง header developer-token · ตั้งไว้เฉพาะเมื่อ
 *                                     มี token แบบเดิมจาก API Center (ส่งให้เมื่อมีค่า)
 *   แบบ Service Account (แนะนำ):
 *     GOOGLE_ADS_SERVICE_ACCOUNT_KEY_FILE  path ไฟล์ JSON key หรือ
 *     GOOGLE_ADS_SERVICE_ACCOUNT_JSON      เนื้อ JSON ทั้งก้อน
 *   หรือแบบ OAuth (ทางเลือก):
 *     GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_REFRESH_TOKEN
 */

const SCOPE = "https://www.googleapis.com/auth/adwords";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export class GoogleAdsError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "GoogleAdsError";
  }
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function digits(v: string | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

function loadServiceAccount(): ServiceAccountKey | null {
  const inline = process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON;
  const file = process.env.GOOGLE_ADS_SERVICE_ACCOUNT_KEY_FILE;
  const raw = inline?.trim() ? inline : file ? readFileSync(file, "utf8") : null;
  if (!raw) return null;
  const key = JSON.parse(raw) as ServiceAccountKey;
  if (!key.client_email || !key.private_key) {
    throw new GoogleAdsError("ไฟล์ Service Account ไม่มี client_email/private_key", 0, false);
  }
  return key;
}

export type AuthMode = "service_account" | "oauth" | "none";

/** ข้อมูลการตั้งค่าแบบปิดบังค่า — ใช้แสดงบนหน้าตั้งค่า (spec §7 หน้า 4) */
export interface MaskedConfig {
  authMode: AuthMode;
  apiVersion: string | null;
  loginCustomerId: string | null;
  developerToken: string | null;
  serviceAccountEmail: string | null;
  oauthClientId: string | null;
  missing: string[];
}

function mask(v: string | undefined | null, keep = 4): string | null {
  if (!v) return null;
  if (v.length <= keep) return "•".repeat(v.length);
  return `${"•".repeat(Math.min(12, v.length - keep))}${v.slice(-keep)}`;
}

function authMode(): AuthMode {
  if (process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON?.trim() || process.env.GOOGLE_ADS_SERVICE_ACCOUNT_KEY_FILE?.trim()) {
    return "service_account";
  }
  if (process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim()) return "oauth";
  return "none";
}

export function maskedConfig(): MaskedConfig {
  const mode = authMode();
  const missing: string[] = [];
  if (!digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)) missing.push("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
  if (!process.env.GOOGLE_ADS_API_VERSION) missing.push("GOOGLE_ADS_API_VERSION");
  if (mode === "none") missing.push("GOOGLE_ADS_SERVICE_ACCOUNT_KEY_FILE หรือ GOOGLE_ADS_REFRESH_TOKEN");
  if (mode === "oauth") {
    if (!process.env.GOOGLE_ADS_CLIENT_ID) missing.push("GOOGLE_ADS_CLIENT_ID");
    if (!process.env.GOOGLE_ADS_CLIENT_SECRET) missing.push("GOOGLE_ADS_CLIENT_SECRET");
  }

  let serviceAccountEmail: string | null = null;
  if (mode === "service_account") {
    try {
      serviceAccountEmail = loadServiceAccount()?.client_email ?? null;
    } catch {
      missing.push("Service Account key (อ่านไฟล์ไม่ได้)");
    }
  }

  return {
    authMode: mode,
    apiVersion: process.env.GOOGLE_ADS_API_VERSION ?? null,
    loginCustomerId: digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) || null,
    developerToken: mask(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
    serviceAccountEmail,
    oauthClientId: mask(process.env.GOOGLE_ADS_CLIENT_ID, 12),
    missing,
  };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

async function postToken(body: URLSearchParams): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    const detail = typeof json.error_description === "string" ? json.error_description : String(json.error ?? res.status);
    throw new GoogleAdsError(`ขอ access token ไม่สำเร็จ: ${detail}`, res.status, res.status >= 500);
  }
  return json as { access_token: string; expires_in: number };
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const mode = authMode();
  let result: { access_token: string; expires_in: number };

  if (mode === "service_account") {
    // JWT bearer grant — Service Account ที่ถูกเพิ่มเป็นผู้ใช้ในบัญชี Google Ads
    // โดยตรง ไม่ต้องมี refresh token จึงไม่หมดอายุแบบ OAuth ที่ยังเป็น Testing
    const key = loadServiceAccount()!;
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64url(
      JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    const signature = signer.sign(key.private_key).toString("base64url");
    result = await postToken(
      new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claims}.${signature}`,
      })
    );
  } else if (mode === "oauth") {
    result = await postToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN ?? "",
      })
    );
  } else {
    throw new GoogleAdsError("ยังไม่ได้ตั้งค่า credential ของ Google Ads API", 0, false);
  }

  cachedToken = { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
  return result.access_token;
}

/** error ชั่วคราวที่ควรลองใหม่ (spec §3.3 rate limit หรือ error ชั่วคราว) */
function isRetryable(status: number, body: string): boolean {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  return /RESOURCE_EXHAUSTED|RESOURCE_TEMPORARILY_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|TRANSIENT_ERROR|INTERNAL_ERROR/.test(body);
}

function errorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const err = (first as { error?: { message?: string; details?: { errors?: { message?: string }[] }[] } })?.error;
    const detail = err?.details?.[0]?.errors?.[0]?.message;
    if (detail || err?.message) return `${detail ?? err?.message} (HTTP ${status})`;
  } catch {
    /* ไม่ใช่ JSON — ใช้ข้อความดิบ */
  }
  return `HTTP ${status}: ${body.slice(0, 300)}`;
}

const MAX_ATTEMPTS = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface StreamResult<T> {
  rows: T[];
  /** true = มีการลองซ้ำอย่างน้อยหนึ่งครั้งก่อนสำเร็จ (บันทึกเป็นสถานะ "retried") */
  retried: boolean;
}

/**
 * รัน GAQL ด้วย `searchStream` (spec §3.3 ใช้กับข้อมูลจำนวนมาก) พร้อม retry แบบ
 * exponential backoff 1s → 2s → 4s → 8s (+jitter) เมื่อเจอ error ชั่วคราว
 */
export async function searchStream<T = Record<string, unknown>>(customerId: string, query: string): Promise<StreamResult<T>> {
  const version = process.env.GOOGLE_ADS_API_VERSION;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const loginCustomerId = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  if (!version || !loginCustomerId) {
    throw new GoogleAdsError("ยังไม่ได้ตั้งค่า GOOGLE_ADS_API_VERSION / LOGIN_CUSTOMER_ID", 0, false);
  }

  const url = `https://googleads.googleapis.com/${version}/customers/${digits(customerId)}/googleAds:searchStream`;
  let retried = false;

  for (let attempt = 1; ; attempt++) {
    let status = 0;
    let body = "";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          ...(developerToken ? { "developer-token": developerToken } : {}),
          "login-customer-id": loginCustomerId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });
      status = res.status;
      body = await res.text();
      if (res.ok) {
        const batches = JSON.parse(body) as { results?: T[] }[];
        return { rows: batches.flatMap((b) => b.results ?? []), retried };
      }
      if (status === 401) cachedToken = null;
    } catch (err) {
      if (err instanceof GoogleAdsError && !err.retryable) throw err;
      // network error — ถือว่าชั่วคราว
      body = err instanceof Error ? err.message : String(err);
      status = status || 503;
    }

    if (!isRetryable(status, body) || attempt >= MAX_ATTEMPTS) {
      throw new GoogleAdsError(errorMessage(status, body), status, isRetryable(status, body));
    }
    retried = true;
    await sleep(1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
  }
}

/** บัญชีโฆษณาทั้งหมดใต้ MCC (ไม่รวมบัญชี manager) — ใช้หน้าตั้งค่า "บัญชีที่ดึง" */
export async function listClientAccounts(): Promise<
  { customerId: string; name: string | null; currencyCode: string | null; timeZone: string | null }[]
> {
  const mcc = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const { rows } = await searchStream<{
    customerClient?: { id?: string; descriptiveName?: string; currencyCode?: string; timeZone?: string };
  }>(
    mcc,
    `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,
            customer_client.time_zone, customer_client.manager, customer_client.status
     FROM customer_client
     WHERE customer_client.manager = FALSE AND customer_client.status = 'ENABLED'`
  );
  return rows
    .map((r) => r.customerClient)
    .filter((c): c is NonNullable<typeof c> => !!c?.id)
    .map((c) => ({
      customerId: String(c.id),
      name: c.descriptiveName ?? null,
      currencyCode: c.currencyCode ?? null,
      timeZone: c.timeZone ?? null,
    }));
}

/** ทดสอบการเชื่อมต่อ — อ่านชื่อบัญชี MCC */
export async function testConnection(): Promise<{ ok: true; name: string | null } | { ok: false; error: string }> {
  try {
    const mcc = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
    const { rows } = await searchStream<{ customer?: { descriptiveName?: string } }>(
      mcc,
      "SELECT customer.id, customer.descriptive_name FROM customer"
    );
    return { ok: true, name: rows[0]?.customer?.descriptiveName ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
