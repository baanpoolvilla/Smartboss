import { PrismaClient } from "@prisma/client";

/**
 * ลบความคิดเห็นทั้งหมดของใบงานหนึ่งใบ (ตามคำขอ — ใบงาน
 * 95acf0a0-a09a-49fb-ba7f-6f279a873009 มีความคิดเห็น 2 อัน อยากลบทิ้งทั้งคู่)
 *
 * ลบแถวออกจากตาราง work_order_comments ตรง ๆ (ไม่ใช่ store JSON แบบ report_task
 * — WorkOrderComment เป็นตารางจริงของมันเอง) ไม่แตะรูปแนบในความคิดเห็น (imageUrl)
 * ที่เก็บไฟล์จริง เหมือนกับที่ trim-work-order-after-photos.ts ทำไว้ — ลบแค่แถว
 * ที่แสดงผล ไฟล์เดิมยังอยู่ในสตอเรจ
 *
 * รัน (บนเซิร์ฟเวอร์ source /etc/smartboss/smartboss.env ก่อน):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/delete-work-order-comments.ts --dry-run
 *      เอา --dry-run ออกเพื่อลบจริง
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

const WORK_ORDER_ID = "95acf0a0-a09a-49fb-ba7f-6f279a873009";

async function main() {
  const wo = await prisma.workOrder.findUnique({
    where: { id: WORK_ORDER_ID },
    select: { id: true, code: true, title: true },
  });
  if (!wo) {
    console.log(`ไม่พบใบงาน id=${WORK_ORDER_ID}`);
    return;
  }

  const comments = await prisma.workOrderComment.findMany({
    where: { workOrderId: WORK_ORDER_ID },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, content: true, createdAt: true },
  });

  console.log(`ใบงาน ${wo.code} — ${wo.title}`);
  console.log(`ความคิดเห็นตอนนี้ ${comments.length} อัน:`);
  for (const c of comments) {
    console.log(`   [จะลบ] ${c.createdAt.toISOString()} (user=${c.userId ?? "-"}) ${c.content}`);
  }

  if (comments.length === 0) {
    console.log("\nไม่มีความคิดเห็นให้ลบ");
    return;
  }

  if (dryRun) {
    console.log("\n[dry-run] ยังไม่ลบอะไร");
    return;
  }

  const { count } = await prisma.workOrderComment.deleteMany({ where: { workOrderId: WORK_ORDER_ID } });
  console.log(`\nลบแล้ว ${count} ความคิดเห็น`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
