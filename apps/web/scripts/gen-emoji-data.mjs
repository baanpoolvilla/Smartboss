// สร้าง lib/emoji-data.json จาก emojibase-data (devDependency) — รันใหม่เมื่ออยากอัปเดตชุดอิโมจิ:
//   node apps/web/scripts/gen-emoji-data.mjs
//
// ตัดให้เหลือเท่าที่ตัวเลือกอิโมจิใช้: [อิโมจิ, คำค้น (ชื่อ+แท็ก ไทยและอังกฤษ)] แยกตามหมวด เรียงตามลำดับ Unicode
// ไม่เอาโทนสีผิวแยกรายตัว (ไฟล์เต็ม ~760KB → ~200KB) และไม่เอาอิโมจิรุ่นใหม่กว่า MAX_VERSION
// เพราะเครื่องที่ระบบเก่ากว่าจะเห็นเป็นกล่องสี่เหลี่ยมเปล่า
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const th = require("emojibase-data/th/data.json");
const en = require("emojibase-data/en/data.json");

const MAX_VERSION = 15;
/** หมวดของ emojibase ที่ใช้ (2 = ส่วนประกอบอย่างโทนสีผิว ไม่ใช่อิโมจิที่คนเลือกส่ง) */
const GROUPS = [0, 1, 3, 4, 5, 6, 7, 8, 9];

const enByHex = new Map(en.map((e) => [e.hexcode, e]));
const out = Object.fromEntries(GROUPS.map((g) => [g, []]));
for (const e of [...th].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
  if (e.group === undefined || !GROUPS.includes(e.group)) continue;
  if ((e.version ?? 0) > MAX_VERSION) continue;
  const english = enByHex.get(e.hexcode);
  const words = new Set([e.label, ...(e.tags ?? []), english?.label, ...(english?.tags ?? [])].filter(Boolean).map((w) => w.toLowerCase()));
  out[e.group].push([e.emoji, [...words].join(" ")]);
}

const target = fileURLToPath(new URL("../lib/emoji-data.json", import.meta.url));
writeFileSync(target, JSON.stringify(out));
console.log(Object.entries(out).map(([g, list]) => `${g}:${list.length}`).join(" "), "→", target);
