import { PrismaClient } from "@prisma/client";

/**
 * ตั้ง "วันเริ่มนับ" ของการหักคะแนนรายงาน (report-penalty-enabled-since) ของบริษัท
 *
 * ตัวหักคะแนนรายงาน (apps/web/app/api/report-task/reports/sweep/route.ts) ตัดสินเต็ม
 * กติกา (ไม่ส่ง −2 · ส่งสาย −1 · หักเพิ่ม/เปลี่ยนหมวดได้) เฉพาะวันที่ >= ค่านี้ วันก่อนหน้า
 * ทำได้แค่คืนคะแนน — บริษัทที่ค่านี้หายไป ตัดสินได้แค่วันปัจจุบัน วันที่ไม่ส่งเลยจึงค้างเป็น
 * "สาย −1" ไม่เคยกลายเป็น "ไม่ส่ง −2" ตั้งค่านี้ย้อนไปวันที่เปิดสวิตช์จริง แล้ว sweep รอบถัดไป
 * จะตัดสินใหม่ตั้งแต่วันนั้น (ย้อนได้สูงสุด 45 วัน) — คะแนนเก่าจะถูกแก้ให้ตรงกติกา
 * **รวมถึงหักเพิ่ม** สำหรับรอบที่ไม่ส่งจริง
 *
 * รัน:
 *   sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a; \
 *     pnpm --filter @smartboss/database exec tsx scripts/set-report-penalty-start.ts \
 *     --org=<orgId> --date=2026-09-23 [--dry-run]'
 */

const prisma = new PrismaClient();
const KEY = "report-penalty-enabled-since";

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const orgId = arg("org");
  const date = arg("date");
  const dryRun = process.argv.includes("--dry-run");
  if (!orgId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("ต้องระบุ --org=<orgId> --date=YYYY-MM-DD");
    process.exitCode = 1;
    return;
  }

  const current = await prisma.reportTaskStore.findUnique({
    where: { orgId_key: { orgId, key: KEY } },
    select: { data: true, version: true },
  });
  console.log(`ค่าปัจจุบัน: ${current ? JSON.stringify(current.data) : "(ไม่มี)"} → ตั้งเป็น "${date}"`);
  if (dryRun) {
    console.log("[dry-run] ยังไม่เขียน");
    return;
  }

  await prisma.reportTaskStore.upsert({
    where: { orgId_key: { orgId, key: KEY } },
    create: { orgId, key: KEY, data: date, version: 1 },
    update: { data: date, version: { increment: 1 } },
  });
  console.log("✔ บันทึกแล้ว — เปิด /api/report-task/reports/sweep หนึ่งครั้ง (หรือรอหน้าเว็บเรียกเองใน 60 วินาที)");
}

main()
  .catch((err) => {
    console.error("[set-report-penalty-start] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
