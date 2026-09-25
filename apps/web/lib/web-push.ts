import "server-only";
import { createECDH, createHmac, createCipheriv, createPrivateKey, randomBytes, sign } from "node:crypto";
import { prisma } from "@smartboss/database";

/**
 * Web Push (แจ้งเตือนเด้งแม้ปิดเว็บ) — เขียนเองด้วย node:crypto ตามมาตรฐาน
 * RFC 8291 (เข้ารหัส aes128gcm) + RFC 8292 (VAPID) ไม่พึ่งแพ็กเกจ web-push
 *
 * ตั้งค่า: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url) + VAPID_SUBJECT
 * (mailto: หรือ https:) ใน smartboss.env — สร้างคู่กุญแจด้วย:
 *   node apps/web/scripts/gen-vapid-keys.mjs
 * ไม่ตั้ง = ฟีเจอร์ปิดเงียบ ๆ (isWebPushConfigured() เป็น false) ส่วนอื่นทำงานปกติ
 *
 * ⚠ ห้ามเปลี่ยนคู่กุญแจหลังเปิดใช้จริง — การสมัครรับแจ้งเตือนเดิมทุกเครื่องจะใช้ไม่ได้
 */

export interface WebPushPayload {
  title: string;
  body?: string;
  /** เปิดหน้านี้เมื่อกดแจ้งเตือน */
  url?: string;
  /** แจ้งเตือน tag เดียวกันแทนที่อันเดิม (เช่น ต่อห้องแชท) ไม่ซ้อนเป็นกอง */
  tag?: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

export function isWebPushConfigured(): boolean {
  return Boolean(vapidPublicKey() && process.env.VAPID_PRIVATE_KEY?.trim());
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** HKDF แบบที่ RFC 8291 ใช้ (extract แล้ว expand รอบเดียว ความยาว ≤ 32 ไบต์) */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

function vapidAuthHeader(endpoint: string): string {
  const pub = fromB64url(vapidPublicKey()!);
  const d = process.env.VAPID_PRIVATE_KEY!.trim();
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: process.env.VAPID_SUBJECT?.trim() || "mailto:admin@smartboss.in.th",
      })
    )
  );
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapidPublicKey()}`;
}

/** เข้ารหัส payload สำหรับเครื่องปลายทาง (RFC 8291, record เดียว) */
function encrypt(p256dh: string, authSecret: string, payload: Buffer): Buffer {
  const uaPublic = fromB64url(p256dh);
  const auth = fromB64url(authSecret);
  const ecdh = createECDH("prime256v1");
  const asPublic = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(auth, sharedSecret, keyInfo, 32);
  const salt = randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 = ตัวปิด record สุดท้าย (ไม่มี padding)
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/**
 * ส่งแจ้งเตือนถึงทุกเครื่องที่ผู้ใช้เหล่านี้สมัครไว้ — ไม่ throw; เครื่องที่ถอนสิทธิ์แล้ว
 * (404/410) ลบทิ้งให้เอง
 */
export async function sendWebPush(orgId: string, userIds: string[], payload: WebPushPayload): Promise<void> {
  if (!isWebPushConfigured() || userIds.length === 0) return;
  let subs: { id: string; endpoint: string; p256dh: string; auth: string }[];
  try {
    subs = await prisma.webPushSubscription.findMany({
      where: { orgId, userId: { in: userIds } },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
  } catch (err) {
    console.error("[web-push] load subscriptions failed", err);
    return;
  }
  const data = Buffer.from(JSON.stringify(payload));
  const gone: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        const res = await fetch(s.endpoint, {
          method: "POST",
          headers: {
            Authorization: vapidAuthHeader(s.endpoint),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "86400",
            Urgency: "high",
          },
          body: new Uint8Array(encrypt(s.p256dh, s.auth, data)),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 404 || res.status === 410) gone.push(s.id);
        else if (!res.ok) console.warn("[web-push] push rejected", res.status, await res.text().catch(() => ""));
      } catch (err) {
        console.warn("[web-push] push failed", err instanceof Error ? err.message : err);
      }
    })
  );

  if (gone.length > 0) {
    await prisma.webPushSubscription.deleteMany({ where: { orgId, id: { in: gone } } }).catch(() => {});
  }
}
