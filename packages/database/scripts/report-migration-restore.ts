import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

/**
 * ปุ่มถอยของการย้ายข้อมูลเข้าห้องรวม (สรุปงาน-รวมห้องรายงาน 2026-09-23) —
 * เขียนไฟล์ backup กลับเข้าฐานข้อมูล ทุกอย่างกลับเป็นเหมือนวินาทีที่ backup ไว้
 *
 * เขียนไว้ตั้งแต่ก่อนเริ่มย้ายข้อมูล และทดสอบให้เห็นว่าใช้ได้จริงก่อนแตะของจริง —
 * ไม่ใช่มาเขียนตอนไฟไหม้ ("ถ้าทำมาแล้วไม่โอเคผมบอกให้คืนค่าเดิมเลย")
 *
 * คืนทั้ง 2 ก้อนที่ report-migration-backup.ts ดัมพ์ไว้:
 *  1. report_task.stores  — เขียนทับทั้งแถว (data + version) ตามไฟล์
 *  2. core.performance_events (source=report_task) — ลบของปัจจุบันทิ้งทั้งหมด
 *     แล้วใส่ของจากไฟล์กลับเข้าไป ทำแบบนี้เพราะ event เป็น ledger ที่ "เพิ่ม
 *     อย่างเดียว" — หลัง migration จะมีแถวใหม่งอกมา การลบ-แล้ว-ใส่กลับจึงเป็น
 *     วิธีเดียวที่ได้สถานะ ณ ตอน backup เป๊ะ ๆ ไม่มีของแปลกปลอมตกค้าง
 *
 * ทั้งหมดอยู่ใน transaction เดียว — ล้มกลางคันก็ไม่มีอะไรเปลี่ยน
 *
 * รัน (บนเซิร์ฟเวอร์ source /etc/smartboss/smartboss.env ก่อน):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/report-migration-restore.ts \
 *     --stores ./backups/report-task-stores-XXXX.json \
 *     --events ./backups/report-task-events-XXXX.json --dry-run
 *      เอา --dry-run ออกเพื่อคืนค่าจริง
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface StoreRow {
  orgId: string;
  key: string;
  data: unknown;
  version: number;
  updatedBy: string | null;
}

interface EventRow {
  id: string;
  orgId: string;
  userId: string;
  source: string;
  category: string;
  refType: string | null;
  refId: string | null;
  // Decimal ของ Prisma กลายเป็น string ตอน JSON.stringify — ส่งกลับตรง ๆ
  // (Prisma รับทั้ง string/number) ห้ามแปลงเป็น number เองกลางทาง จะเสียความละเอียด
  points: string | number;
  occurredAt: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

async function main() {
  const storesPath = argValue("--stores");
  const eventsPath = argValue("--events");
  if (!storesPath || !eventsPath) {
    console.log("ต้องระบุ --stores <ไฟล์> และ --events <ไฟล์> (ไฟล์ที่ได้จาก report-migration-backup.ts)");
    process.exitCode = 1;
    return;
  }

  const stores: StoreRow[] = JSON.parse(readFileSync(storesPath, "utf8"));
  const events: EventRow[] = JSON.parse(readFileSync(eventsPath, "utf8"));

  // สถานะปัจจุบัน เอาไว้บอกว่าการคืนค่าครั้งนี้จะเปลี่ยนอะไรบ้าง
  const nowStores = await prisma.reportTaskStore.findMany();
  const nowEventCount = await prisma.performanceEvent.count({ where: { source: "report_task" } });

  console.log(`\n=== คืนค่าเดิม ${dryRun ? "(dry-run — ยังไม่เขียนอะไร)" : "(เขียนจริง)"} ===\n`);
  console.log(`สโตร์   ตอนนี้ ${nowStores.length} แถว  ->  จะกลับเป็น ${stores.length} แถวตามไฟล์`);
  for (const s of stores) {
    const cur = nowStores.find((n) => n.orgId === s.orgId && n.key === s.key);
    const data = s.data as Record<string, unknown> | null;
    const posts = Array.isArray(data?.posts) ? (data!.posts as unknown[]).length : 0;
    const curData = cur?.data as Record<string, unknown> | null;
    const curPosts = Array.isArray(curData?.posts) ? (curData!.posts as unknown[]).length : 0;
    const note = s.key === "report-feed" ? `  โพสต์ ${curPosts} -> ${posts}` : "";
    console.log(`   - ${s.key}  version ${cur?.version ?? "(ไม่มีแถวนี้)"} -> ${s.version}${note}`);
  }
  console.log(`\nคะแนน   ตอนนี้ ${nowEventCount} เหตุการณ์  ->  จะกลับเป็น ${events.length} เหตุการณ์`);

  if (dryRun) {
    console.log(`\n[dry-run] ยังไม่เขียนอะไรลงฐานข้อมูล เอา --dry-run ออกเพื่อคืนค่าจริง\n`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const s of stores) {
      await tx.reportTaskStore.upsert({
        where: { orgId_key: { orgId: s.orgId, key: s.key } },
        // version จากไฟล์ตรง ๆ — ไคลเอนต์ที่เปิดค้างอยู่จะเจอเลขไม่ตรงแล้วโหลดใหม่เอง
        // (optimistic concurrency ของสโตร์นี้) ซึ่งเป็นสิ่งที่ต้องการพอดีหลังคืนค่า
        create: { orgId: s.orgId, key: s.key, data: s.data as never, version: s.version, updatedBy: s.updatedBy },
        update: { data: s.data as never, version: s.version, updatedBy: s.updatedBy },
      });
    }

    await tx.performanceEvent.deleteMany({ where: { source: "report_task" } });
    if (events.length > 0) {
      await tx.performanceEvent.createMany({
        data: events.map((e) => ({
          id: e.id,
          orgId: e.orgId,
          userId: e.userId,
          source: e.source,
          category: e.category,
          refType: e.refType,
          refId: e.refId,
          points: e.points,
          occurredAt: new Date(e.occurredAt),
          note: e.note,
          createdBy: e.createdBy,
          createdAt: new Date(e.createdAt),
        })),
      });
    }
  });

  console.log(`\nคืนค่าเรียบร้อย — ทุกอย่างกลับเป็นเหมือนตอน backup แล้ว`);
  console.log(`บอกให้ทุกคนรีเฟรชหน้าจอหนึ่งรอบ จะได้โหลดข้อมูลที่คืนแล้วขึ้นมาใหม่\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
