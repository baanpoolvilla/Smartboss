import { PrismaClient } from "@prisma/client";
import { tenantGuardExtension } from "./tenant-guard";

/**
 * Prisma client เดี่ยวของทั้งแอป — cache ไว้บน globalThis ตอน dev กัน hot-reload
 * สร้าง connection ใหม่รัวๆ ต่อด้วย tenant-guard (ดู tenant-guard.ts) เพื่อดักทุก
 * query ที่ลืมกรอง orgId — เป็นการ์ดชั้นสุดท้ายของ row-level multi-tenancy
 */
/**
 * ขนาด pool ของ Prisma — ค่าเริ่มต้นคือ `จำนวน core × 2 + 1` ซึ่งบน VM 2 core
 * เหลือแค่ **5 connection สำหรับทั้งเว็บ** ทุกหน้าที่เรนเดอร์ฝั่งเซิร์ฟเวอร์
 * แย่งกันอยู่ในนั้น พอมีหน้าไหนถือ connection นานหน่อย หน้าอื่นก็ต่อคิวทันที
 *
 * ตั้งเองแทนการปล่อยให้คิดจากจำนวน core เพราะ workload ของเราเป็น I/O ล้วน
 * (รอ Postgres ตอบ ไม่ได้เผา CPU) จำนวน core จึงไม่ใช่ตัวตั้งที่ถูก — Postgres
 * ตั้ง max_connections ไว้ 100 และอีกสามโปรเซส (api/worker/gateway) จองไปคนละ
 * 10 รวม 30 เว้นที่ให้ฝั่งเว็บได้สบาย ๆ
 *
 * ตั้งทับด้วย env `DATABASE_POOL_MAX` ได้ถ้าย้ายไปเครื่องที่ใหญ่/เล็กกว่านี้
 */
const POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? 20);

/**
 * ต่อ `connection_limit` เข้ากับ DATABASE_URL — Prisma รับค่านี้ผ่าน query param
 * ของ URL เท่านั้น ตั้งผ่าน option ในโค้ดตรง ๆ ไม่ได้ ถ้า URL ระบุมาเองอยู่แล้ว
 * ไม่ต้องยุ่ง (คนตั้ง env ย่อมรู้ดีกว่า)
 */
function urlWithPoolLimit(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw || !Number.isFinite(POOL_MAX) || POOL_MAX <= 0) return undefined;
  if (raw.includes("connection_limit=")) return undefined;
  try {
    const url = new URL(raw);
    url.searchParams.set("connection_limit", String(POOL_MAX));
    return url.toString();
  } catch {
    // URL แปลก ๆ ที่ parse ไม่ได้ — ปล่อยให้ Prisma จัดการเองเหมือนเดิม
    return undefined;
  }
}

function makeClient() {
  const url = urlWithPoolLimit();
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(url ? { datasources: { db: { url } } } : {}),
  }).$extends(tenantGuardExtension);
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof makeClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
