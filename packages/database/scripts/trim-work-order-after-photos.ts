import { PrismaClient } from "@prisma/client";

/**
 * ลบรูป "ภาพหลังแก้ไข" (afterPhotoUrls) ของใบงานหนึ่งใบ เหลือไว้แค่ URL ที่ระบุ
 * — ตามคำขอ (ใบงาน WO-2569-0149, เหลือรูปที่ 2 ไว้รูปเดียวจาก 6 รูป)
 *
 * ไม่ลบไฟล์จริงออกจากที่เก็บไฟล์ (MinIO) แค่เอา URL ออกจาก afterPhotoUrls —
 * ตัดออกจากที่แสดงผลในหน้าใบงาน ไฟล์เดิมยังอยู่ในสตอเรจ (ทำความสะอาดไฟล์กำพร้า
 * เป็นงานแยกต่างหาก ไม่ใช่สคริปต์นี้)
 *
 * รัน (บนเซิร์ฟเวอร์ source /etc/smartboss/smartboss.env ก่อน):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/trim-work-order-after-photos.ts --dry-run
 *      เอา --dry-run ออกเพื่อเขียนจริง
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

const WORK_ORDER_ID = "0c5335a2-d245-4734-93ae-915b2315efcc";
const KEEP_URL =
  "/api/files/e944483d-be10-43a4-a4c7-288a7b5908b2/maintenance/work-orders/after/1789981455501-e8cb54c52f4fc522.jpeg";

async function main() {
  const wo = await prisma.workOrder.findUnique({
    where: { id: WORK_ORDER_ID },
    select: { id: true, code: true, title: true, afterPhotoUrls: true },
  });
  if (!wo) {
    console.log(`ไม่พบใบงาน id=${WORK_ORDER_ID}`);
    return;
  }

  console.log(`ใบงาน ${wo.code} — ${wo.title}`);
  console.log(`ภาพหลังแก้ไขตอนนี้ ${wo.afterPhotoUrls.length} รูป:`);
  for (const url of wo.afterPhotoUrls) {
    console.log(`   ${url === KEEP_URL ? "[เก็บไว้]" : "[จะลบ]  "} ${url}`);
  }

  if (!wo.afterPhotoUrls.includes(KEEP_URL)) {
    console.log("\n⚠ ไม่พบ URL ที่จะเก็บไว้ในรายการนี้เลย — หยุดไว้ก่อน ไม่แก้อะไร");
    return;
  }

  if (dryRun) {
    console.log("\n[dry-run] ยังไม่เขียนอะไร");
    return;
  }

  await prisma.workOrder.update({
    where: { id: WORK_ORDER_ID },
    data: { afterPhotoUrls: [KEEP_URL] },
  });
  console.log("\nลบแล้ว — เหลือภาพหลังแก้ไข 1 รูปตามที่ขอ");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
