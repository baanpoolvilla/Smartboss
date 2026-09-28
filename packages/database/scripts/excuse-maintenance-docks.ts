import { PrismaClient } from "@prisma/client";

/**
 * คืนคะแนน "ใบงานเกินกำหนด" ของใบงานที่ระบุเลขที่ — สำหรับกรณีที่เจ้าของระบบตัดสินใจยกเว้น
 * เอง เช่น ใบงานที่ดึงมาจาก ChangYai ช่วงเปลี่ยนระบบ (A-Sujita: ฉีดปลวก 3 หลัง + ล้างบ่อดัก
 * ปิดช้า 3–5 วัน) ซึ่งตามกติกาหักถูก cron จึงไม่คืนให้เอง
 *
 * ลบเหตุการณ์ที่ระบบหักเอง (createdBy = null) ไม่แตะรายการที่หัวหน้ากดหักเอง
 * ลบ ไม่ใช่ออกเหตุการณ์หักล้าง — ตัวคืนคะแนนของ cron (revokeInvalidMaintenanceDocks) ดู
 * ทุกเหตุการณ์หมวด workorder_overdue ถ้ามีแถวหักล้างที่ refId ไม่ใช่ใบงาน มันจะลบแถวนั้นทิ้ง
 * แล้วคะแนนกลับมาติดลบ · ใบงานเหล่านี้ปิดแล้ว cron หักเฉพาะใบที่ยังเปิด จึงไม่หักกลับมาอีก
 *
 * รัน:
 *   sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a; \
 *     pnpm --filter @smartboss/database exec tsx scripts/excuse-maintenance-docks.ts \
 *     --codes=WO-2568-0550,WO-2568-0545,WO-2568-0543,WO-2568-0566 --dry-run'
 *   ตัด --dry-run ออกเพื่อคืนจริง
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const codes = (arg("codes") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  if (codes.length === 0) {
    console.error("ต้องระบุ --codes=WO-xxxx-xxxx[,WO-...]");
    process.exitCode = 1;
    return;
  }

  const wos = await prisma.workOrder.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, title: true, property: { select: { name: true } } },
  });
  const missing = codes.filter((c) => !wos.some((w) => w.code === c));
  if (missing.length > 0) console.log(`ไม่พบใบงาน: ${missing.join(", ")}`);

  const events = await prisma.performanceEvent.findMany({
    where: {
      source: "maintenance",
      category: "workorder_overdue",
      refType: "work_order",
      refId: { in: wos.map((w) => w.id) },
      createdBy: null,
    },
    select: { id: true, userId: true, points: true, refId: true, occurredAt: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(events.map((e) => e.userId))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const woOf = new Map(wos.map((w) => [w.id, w]));

  let total = 0;
  for (const e of events) {
    const w = woOf.get(e.refId!);
    total += Number(e.points);
    console.log(
      `  ${nameOf.get(e.userId) ?? e.userId}  ${Number(e.points)}  ${w?.code} ${w?.title} · ${w?.property?.name ?? ""} (หักเมื่อ ${e.occurredAt.toISOString().slice(0, 10)})`,
    );
  }
  console.log(`รวม ${events.length} รายการ ${total} คะแนน`);
  if (events.length === 0) return;

  if (dryRun) {
    console.log("--dry-run: ยังไม่ได้คืน ตัด --dry-run ออกเพื่อคืนจริง");
    return;
  }
  const result = await prisma.performanceEvent.deleteMany({
    where: { id: { in: events.map((e) => e.id) }, createdBy: null },
  });
  console.log(`คืนคะแนนแล้ว ${result.count} รายการ`);
}

main()
  .catch((err) => {
    console.error("[excuse-maintenance-docks] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
