import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";

/**
 * เข้ารหัสช่องข้อมูลอ่อนไหวที่เก็บเป็นข้อความ (เลขบัญชีธนาคาร, secret ของ 2FA)
 *
 * ใช้กุญแจตัวเดียวกับระบบบุคคล (FIELD_ENCRYPTION_KEY — base64 ของ 32 ไบต์ ที่เข้ารหัส
 * เลขบัตรประชาชนอยู่แล้ว apps/workforce-api/.../field-encryption.ts) เครื่องจริงมีอยู่แล้ว
 * ในไฟล์ env เดียวกัน (deploy/init-env.sh)
 *
 * รูปแบบ: "enc:v1:" + base64([iv:12][tag:16][ciphertext]) — AES-256-GCM
 *
 * เข้ากันได้กับของเดิมทั้งสองทาง:
 *  - ค่าเดิมที่ยังเป็นข้อความธรรมดา (ไม่ขึ้นต้น "enc:v1:") อ่านได้ตามเดิม แล้วถูกเข้ารหัสเอง
 *    ตอนบันทึกครั้งถัดไป (หรือรัน scripts/encrypt-bank-accounts.ts ทีเดียวทั้งหมด)
 *  - ไม่ได้ตั้งกุญแจ = เก็บเป็นข้อความธรรมดาเหมือนเดิม ไม่พังอะไร
 */
const PREFIX = "enc:v1:";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let cachedKey: Buffer | null | undefined;

function key(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) return (cachedKey = null);
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    console.error("[field-crypto] FIELD_ENCRYPTION_KEY ต้องเป็น base64 ของ 32 ไบต์ — ไม่เข้ารหัส");
    return (cachedKey = null);
  }
  return (cachedKey = buf);
}

export function fieldEncryptionConfigured(): boolean {
  return key() !== null;
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** เข้ารหัส — ค่าว่าง/เข้ารหัสแล้ว/ไม่มีกุญแจ คืนค่าเดิม */
export function sealField(plain: string): string {
  if (!plain || isSealed(plain)) return plain;
  const k = key();
  if (!k) return plain;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/** ถอดรหัส — ค่าที่ไม่ได้เข้ารหัสคืนค่าเดิม · ถอดไม่ได้ (กุญแจหาย/ข้อมูลเสีย) คืน "" และ log ไว้ */
export function openField(stored: string): string {
  if (!stored || !isSealed(stored)) return stored;
  const k = key();
  if (!k) {
    console.error("[field-crypto] พบข้อมูลที่เข้ารหัสไว้ แต่ไม่ได้ตั้ง FIELD_ENCRYPTION_KEY");
    return "";
  }
  try {
    const bytes = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = bytes.subarray(0, IV_LENGTH);
    const tag = bytes.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(bytes.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString("utf8");
  } catch (err) {
    console.error("[field-crypto] ถอดรหัสไม่สำเร็จ:", err instanceof Error ? err.message : err);
    return "";
  }
}

/**
 * ช่องที่เข้ารหัสให้เองทุกครั้งที่เขียน/อ่านผ่าน Prisma — โค้ดของโมดูลเห็นเป็นข้อความปกติเหมือนเดิม
 * (เลขบัญชีพนักงาน · เลขบัญชีในรอบจ่าย · เลขบัญชีบริษัท · เลขบัญชีช่าง/ร้าน)
 * ห้ามใช้ช่องพวกนี้เป็นเงื่อนไขค้นหาใน where — ค่าในฐานข้อมูลเป็นรหัสที่สุ่มใหม่ทุกครั้ง
 */
export const SEALED_FIELDS: Record<string, readonly string[]> = {
  SalaryProfile: ["bankAccount"],
  SalaryRunLine: ["bankAccount"],
  SalarySettings: ["payBankAccount"],
  MoneyVendor: ["bankAccount"],
};

function sealData(data: unknown, fields: readonly string[]): unknown {
  if (Array.isArray(data)) return data.map((d) => sealData(d, fields));
  if (!data || typeof data !== "object") return data;
  const row = data as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const f of fields) {
    const v = row[f];
    if (typeof v === "string" && v && !isSealed(v)) {
      out ??= { ...row };
      out[f] = sealField(v);
    } else if (v && typeof v === "object" && typeof (v as { set?: unknown }).set === "string") {
      out ??= { ...row };
      out[f] = { set: sealField((v as { set: string }).set) };
    }
  }
  return out ?? data;
}

function openRows(result: unknown, fields: readonly string[]): unknown {
  if (Array.isArray(result)) {
    for (const r of result) openRows(r, fields);
    return result;
  }
  if (!result || typeof result !== "object") return result;
  const row = result as Record<string, unknown>;
  for (const f of fields) {
    const v = row[f];
    if (typeof v === "string" && isSealed(v)) row[f] = openField(v);
  }
  return result;
}

export const fieldCryptoExtension = Prisma.defineExtension({
  name: "field-crypto",
  query: {
    $allModels: {
      async $allOperations({ model, args, query }) {
        const fields = SEALED_FIELDS[model];
        if (!fields) return query(args);
        const a = (args ?? {}) as Record<string, unknown>;
        // คัดลอกก่อนแก้ — ผู้เรียกยังใช้ object data เดิมต่อ (เช่นบันทึกลงประวัติ) ต้องไม่กลายเป็นรหัส
        const next: Record<string, unknown> = { ...a };
        if ("data" in a) next.data = sealData(a.data, fields);
        if ("create" in a) next.create = sealData(a.create, fields);
        if ("update" in a) next.update = sealData(a.update, fields);
        return openRows(await query(next as typeof args), fields);
      },
    },
  },
});
