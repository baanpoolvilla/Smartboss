import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ขั้น 0 ของการย้ายข้อมูลเข้าห้องรวม (สรุปงาน-รวมห้องรายงาน 2026-09-23) —
 * ดัมพ์ทุกอย่างที่การย้ายจะไปแตะ ออกมาเป็นไฟล์ก่อน "แตะอะไรทั้งสิ้น"
 *
 * ทำไมต้องมี: ตาราง report_task.stores เก็บแค่ก้อน JSON ก้อนเดียว (ห้อง+โพสต์+
 * รอบ ทั้งบริษัทอยู่ในนั้น) ฟิลด์ `version` ในตารางเป็นแค่ตัวนับกันสองแท็บเขียน
 * ทับกัน ไม่ใช่ประวัติเวอร์ชัน — เขียนทับแล้วของเดิมหายทันที ไม่มีตาข่ายอื่นรองรับ
 *
 * ดัมพ์ 2 ก้อน:
 *  1. report_task.stores ทุกแถว (ไม่ใช่แค่ report-feed — ก้อนอื่นเล็กมาก
 *     เอามาด้วยเลย จะได้คืนได้ทั้งโมดูลถ้าจำเป็น)
 *  2. core.performance_events เฉพาะของ report_task (ประวัติคะแนนที่เคยหัก/คืน)
 *
 * ไฟล์ที่ได้เอาไปใช้กับ report-migration-restore.ts ได้ตรง ๆ
 *
 * รัน (บนเซิร์ฟเวอร์ source /etc/smartboss/smartboss.env ก่อน):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/report-migration-backup.ts
 *      --out <โฟลเดอร์>   ระบุที่เก็บเอง (ค่าเริ่มต้น ./backups)
 */

const prisma = new PrismaClient();

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const outDir = argValue("--out") ?? "./backups";
  // ตราประทับเวลาในชื่อไฟล์ — รันซ้ำได้เรื่อย ๆ ไม่มีทางทับไฟล์เก่าของตัวเอง
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(outDir, { recursive: true });

  const stores = await prisma.reportTaskStore.findMany();
  const events = await prisma.performanceEvent.findMany({
    where: { source: "report_task" },
  });

  const storePath = join(outDir, `report-task-stores-${stamp}.json`);
  const eventPath = join(outDir, `report-task-events-${stamp}.json`);

  writeFileSync(storePath, JSON.stringify(stores, null, 2), "utf8");
  writeFileSync(eventPath, JSON.stringify(events, null, 2), "utf8");

  // สรุปให้เห็นกับตาว่าได้อะไรมาบ้าง — ตัวเลขพวกนี้เอาไปเทียบตอน restore ได้
  console.log(`\n=== BACKUP เสร็จแล้ว (${stamp}) ===\n`);
  console.log(`สโตร์  ${stores.length} แถว  ->  ${storePath}`);
  for (const s of stores) {
    const data = s.data as Record<string, unknown> | null;
    const topics = Array.isArray(data?.topics) ? (data!.topics as unknown[]).length : 0;
    const posts = Array.isArray(data?.posts) ? (data!.posts as unknown[]).length : 0;
    const detail = s.key === "report-feed" ? `  (ห้อง ${topics} · โพสต์ ${posts})` : "";
    console.log(`   - ${s.key}  org=${s.orgId}  version=${s.version}${detail}`);
  }
  console.log(`\nคะแนน  ${events.length} เหตุการณ์  ->  ${eventPath}`);

  console.log(`\nเก็บไฟล์ 2 อันนี้ไว้ให้ดี และโหลดลงเครื่องอีกชุดก่อนเริ่มย้ายข้อมูล`);
  console.log(`คืนค่าเดิมเมื่อไหร่ก็ได้ด้วย:`);
  console.log(`   pnpm --filter @smartboss/database exec tsx scripts/report-migration-restore.ts \\`);
  console.log(`     --stores ${storePath} --events ${eventPath} --dry-run\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
