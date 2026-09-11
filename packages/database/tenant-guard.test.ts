import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { TENANT_SCOPED_MODELS } from "./tenant-guard";

/**
 * TENANT_SCOPED_MODELS ใน tenant-guard.ts คือ allowlist ที่ต้องดูแลเอง (comment
 * ของมันบอกไว้เองว่า "เพิ่มโมเดลใหม่ที่มี orgId ต้องมาต่อรายการนี้ด้วย") — ถ้าใครเพิ่ม
 * โมเดลใหม่ที่มี orgId แล้วลืมต่อ allowlist โมเดลนั้นจะหลุดการตรวจของการ์ดไปเงียบ ๆ
 * ทันที ไม่ log ด้วยซ้ำ (ต่างจากโมเดลที่ query ไม่ใส่ orgId ซึ่งอย่างน้อยยัง warn)
 *
 * เทสต์นี้อ่าน schema จริงทุกไฟล์ใน prisma/schema/*.prisma แล้ว assert ว่า
 * allowlist ตรงกับ "ทุกโมเดลที่มีคอลัมน์ orgId" เป๊ะ — ไม่ขาด ไม่เกิน (nullable
 * หรือไม่ไม่สำคัญ — whereHasOrgId/dataHasOrgId ยอมรับ `orgId: null` เป็นการกรอง
 * ที่ตั้งใจอยู่แล้ว เช่น User/Role/Notification ที่ null = แถวระดับแพลตฟอร์ม)
 */

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "prisma", "schema");

/** ตัดคอมเมนต์ทุกแบบ (บรรทัดเดียวและ block comment) ทิ้งก่อนสแกน กัน false
 * positive จากข้อความในคอมเมนต์ที่พูดถึง orgId (เช่นคอมเมนต์อธิบาย FK) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** { modelName -> orgId เป็น nullable ไหม } เฉพาะโมเดลที่มีคอลัมน์ orgId */
function modelsWithOrgId(src: string): Map<string, boolean> {
  const clean = stripComments(src);
  const result = new Map<string, boolean>();

  // จับทีละ model block แบบนับวงเล็บเอง — field type ธรรมดาของ prisma ไม่มี
  // `{` ซ้อนอยู่แล้ว (attribute ใช้ `@@`/`@`) นับ brace ตรงไปตรงมาก็พอ
  const modelRe = /model\s+(\w+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = modelRe.exec(clean))) {
    const name = match[1]!;
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < clean.length && depth > 0) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}") depth--;
      i++;
    }
    const body = clean.slice(bodyStart, i - 1);

    // field line: ขึ้นต้นด้วย orgId ตามด้วย type token ("String" หรือ "String?")
    const fieldMatch = body.match(/^\s*orgId\s+(\S+)/m);
    if (fieldMatch) {
      const type = fieldMatch[1]!;
      result.set(name, type.endsWith("?"));
    }
  }
  return result;
}

test("TENANT_SCOPED_MODELS ตรงกับโมเดลที่มีคอลัมน์ orgId ใน schema จริง", (t) => {
  const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".prisma"));
  assert.ok(files.length > 0, `ไม่เจอไฟล์ .prisma ใน ${SCHEMA_DIR} — path ผิดหรือเปล่า`);

  const orgIdModels = new Map<string, boolean>(); // model -> nullable
  for (const file of files) {
    const src = readFileSync(join(SCHEMA_DIR, file), "utf8");
    for (const [model, nullable] of modelsWithOrgId(src)) orgIdModels.set(model, nullable);
  }

  const missing = [...orgIdModels.keys()].filter((m) => !TENANT_SCOPED_MODELS.has(m));
  const stale = [...TENANT_SCOPED_MODELS].filter((m) => !orgIdModels.has(m));

  assert.deepEqual(
    missing,
    [],
    `โมเดลนี้มี orgId จริงใน schema แต่ไม่อยู่ใน TENANT_SCOPED_MODELS — การ์ดไม่เช็คเลย ` +
      `แม้แต่ log ต่อไปดูใน packages/database/tenant-guard.ts: ${missing.join(", ")}`
  );
  assert.deepEqual(
    stale,
    [],
    `โมเดลนี้อยู่ใน TENANT_SCOPED_MODELS แต่ schema จริงไม่มีคอลัมน์ orgId แล้ว — อาจ ` +
      `เป็นชื่อโมเดลที่เปลี่ยน/ลบไปแล้ว ควรเอาออกจาก allowlist: ${stale.join(", ")}`
  );

  const nullable = [...orgIdModels.entries()].filter(([, n]) => n).map(([m]) => m);
  t.diagnostic(
    `โมเดล orgId แบบ nullable (null = แถวระดับแพลตฟอร์ม, การ์ดยอมให้ผ่าน): ${nullable.join(", ")}`
  );
});
