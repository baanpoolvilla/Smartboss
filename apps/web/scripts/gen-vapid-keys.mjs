// สร้างคู่กุญแจ VAPID สำหรับ Web Push (lib/web-push.ts) — รันครั้งเดียว แล้วใส่ผลลัพธ์ลง
// /etc/smartboss/smartboss.env  ⚠ ห้ามเปลี่ยนหลังเปิดใช้จริง (การสมัครเดิมทุกเครื่องจะใช้ไม่ได้)
//   node apps/web/scripts/gen-vapid-keys.mjs
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const toB64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const raw = Buffer.concat([Buffer.from([4]), fromB64url(pub.x), fromB64url(pub.y)]);
console.log(`VAPID_PUBLIC_KEY=${toB64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${priv.d}`);
console.log(`VAPID_SUBJECT=mailto:admin@smartboss.in.th`);
