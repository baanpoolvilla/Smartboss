import { PrismaClient } from "@prisma/client";
import { tenantGuardExtension } from "./tenant-guard";

/**
 * Prisma client เดี่ยวของทั้งแอป — cache ไว้บน globalThis ตอน dev กัน hot-reload
 * สร้าง connection ใหม่รัวๆ ต่อด้วย tenant-guard (ดู tenant-guard.ts) เพื่อดักทุก
 * query ที่ลืมกรอง orgId — เป็นการ์ดชั้นสุดท้ายของ row-level multi-tenancy
 */
function makeClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
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
