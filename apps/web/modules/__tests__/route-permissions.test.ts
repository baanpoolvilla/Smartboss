import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Fix-list ข้อ 2 track A (Claude outputs/SmartBoss-Fix-List-2026-09-11.md) —
 * "proxy.ts เช็คแค่ล็อกอินหรือยัง สิทธิ์จริงอยู่ที่ handler แต่ละตัว —
 * handler ไหนลืมเรียก = เปิดโล่ง"
 *
 * เทสต์นี้เป็น static audit — อ่านซอร์สโค้ดของทุก route.ts เป็นข้อความ (ไม่
 * import/เรียกจริง เพราะ route handler พึ่ง next/headers's cookies() ซึ่งต้อง
 * มี request context จริงของ Next server เท่านั้น stub ไม่ได้ — ดู track B)
 * แล้ว assert ว่าทุกไฟล์เรียก guard function ที่รู้จัก หรืออยู่ใน allowlist
 * public/secret ที่ประกาศไว้ชัดเจนด้านล่าง route ใหม่ที่ไม่เข้าเงื่อนไขทั้งคู่
 * = เทสต์นี้แดงทันที (จับ "ลืมเรียก guard" ได้ — จับไม่ได้ว่า "เรียกถูก level
 * ไหม", นั่นคือหน้าที่ของมิติที่สองด้านล่าง + การรีวิวมือ)
 */

const API_DIR = join(__dirname, "..", "..", "app", "api");

/** ชื่อฟังก์ชัน/แพตเทิร์นที่นับว่า "มี guard" — requireAuth/requireOrg/
 * requirePermission เป็นแบบ Server Component (redirect เมื่อไม่ผ่าน) ส่วน
 * getSession() คือแพตเทิร์นของ API route เอง (คืน JSON error เอง เพราะ
 * endpoint แบบ JSON ไม่ควร redirect) — ทั้งคู่นับเป็น guard ที่ถูกต้อง */
const GUARD_PATTERNS = [
  /requireAuth\s*\(/,
  /requireOrg\s*\(/,
  /requirePermission\s*\(/,
  /getSession\s*\(/,
  /CRON_SECRET/,
];

/** route ที่ตั้งใจไม่มี guard ตัวไหนเลยข้างบน — ต้องมีเหตุผลกำกับทุกตัว เพิ่ม
 * ใหม่ = ต้องมาแก้ที่นี่โดยตั้งใจ (เหมือน CROSS_ORG_REASONS) ห้ามเงียบ ๆ */
const PUBLIC_OR_SECRET_ROUTES: Record<string, string> = {
  "auth/line/link/route.ts":
    "pre-login: ยืนยัน LINE ID token + รหัสผ่านเอง, rate-limited — ยังไม่มี session ให้เช็ค",
  "auth/line/route.ts":
    "pre-login: ยืนยัน LINE ID token เอง, rate-limited — ยังไม่มี session ให้เช็ค",
  "auth/login/route.ts": "จุดเข้าสู่ระบบเอง — บังคับ session ก่อนก็ล็อกอินไม่ได้เลย",
  "auth/logout/route.ts": "เรียกได้แม้ไม่มี session (เพิกถอน token ถ้ามี ไม่มีก็ no-op ปลอดภัย)",
  "auth/refresh/route.ts": "จุดขอ token ใหม่เอง — access token อาจหมดอายุไปแล้วตอนเรียก",
  "report-task/holidays/route.ts":
    "proxy ไป public API ของบุคคลที่สาม ไม่มีข้อมูลบริษัทเลย — ยังต้อง login ผ่าน proxy.ts อยู่ดี (ไม่อยู่ใต้ /api/auth|cron|webhooks) แค่ไม่ต้องเช็คสิทธิ์เพิ่มในนี้",
  "report-task/holidays/countries/route.ts":
    "เหตุผลเดียวกับ holidays/route.ts ข้างบน",
};

function listRouteFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      out.push(...listRouteFiles(full, rel));
    } else if (entry === "route.ts") {
      out.push(rel);
    }
  }
  return out;
}

test("ทุก apps/web/app/api/**/route.ts เรียก guard ที่รู้จัก หรืออยู่ใน allowlist public/secret", () => {
  const routes = listRouteFiles(API_DIR);
  assert.ok(routes.length > 0, `ไม่เจอไฟล์ route.ts เลยใน ${API_DIR} — path ผิดหรือเปล่า`);

  const missing: string[] = [];
  for (const rel of routes) {
    if (rel in PUBLIC_OR_SECRET_ROUTES) continue;
    const src = readFileSync(join(API_DIR, rel), "utf8");
    const hasGuard = GUARD_PATTERNS.some((p) => p.test(src));
    if (!hasGuard) missing.push(rel);
  }

  assert.deepEqual(
    missing,
    [],
    `route นี้ไม่เรียก guard ที่รู้จักเลย (requireAuth/requireOrg/requirePermission/ ` +
      `getSession/CRON_SECRET) และไม่อยู่ใน PUBLIC_OR_SECRET_ROUTES — ถ้าตั้งใจให้เข้าถึง ` +
      `ได้โดยไม่ต้องมีสิทธิ์ ให้เพิ่มเข้า allowlist พร้อมเหตุผล ไม่งั้นแก้ route ให้เรียก ` +
      `guard: ${missing.join(", ")}`
  );

  // allowlist ต้องไม่มีรายการค้างที่ไฟล์ถูกลบ/ย้ายไปแล้ว (กันเหมือนที่ discord-ingest
  // เคยอยู่ในนี้ก่อนถูกลบทั้งฟีเจอร์ — ต้องมาเอาออกจาก allowlist ด้วย ไม่ใช่แค่ลบไฟล์)
  const routeSet = new Set(routes);
  const stalePublicEntries = Object.keys(PUBLIC_OR_SECRET_ROUTES).filter((p) => !routeSet.has(p));
  assert.deepEqual(
    stalePublicEntries,
    [],
    `PUBLIC_OR_SECRET_ROUTES มีรายการที่ route.ts ไม่มีอยู่จริงแล้ว — เอาออก: ${stalePublicEntries.join(", ")}`
  );
});

test("รายงาน route ที่ทำ mutation แต่เช็คแค่ auth ไม่เช็ค permission (ไว้รีวิวมือ ไม่ fail)", (t) => {
  const routes = listRouteFiles(API_DIR);
  const MUTATING_METHOD = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/;
  const HAS_PERMISSION_CHECK = /requirePermission\s*\(|hasPermission\s*\(/;
  const HAS_AUTH_ONLY = /requireAuth\s*\(|requireOrg\s*\(|getSession\s*\(/;

  const flagged: string[] = [];
  for (const rel of routes) {
    if (rel in PUBLIC_OR_SECRET_ROUTES) continue;
    const src = readFileSync(join(API_DIR, rel), "utf8");
    if (!MUTATING_METHOD.test(src)) continue;
    if (HAS_PERMISSION_CHECK.test(src)) continue;
    if (HAS_AUTH_ONLY.test(src)) flagged.push(rel);
  }

  t.diagnostic(
    flagged.length === 0
      ? "ไม่มี route ที่ต้องรีวิวเพิ่ม"
      : `route ที่ทำ write แต่เช็คแค่ล็อกอิน ไม่เช็ค permission เจาะจง (${flagged.length} จุด) — ` +
          `ไม่ได้แปลว่าผิด (หลายจุดเป็นแค่ "แก้ข้อมูลของตัวเอง" ซึ่งไม่ต้องมี permission พิเศษ) ` +
          `แต่ควรรีวิวมือทีละจุด: ${flagged.join(", ")}`
  );
});
