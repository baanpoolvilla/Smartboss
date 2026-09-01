/**
 * แก้ห้องที่ create-discord-report-rooms.ts สร้างไว้แล้ว (ตอนนั้นยังไม่ได้ตั้ง
 * feedViewMode เลยกลายเป็น Openchat ไปหมด) ให้เป็น Thread ทั้งหมด — แก้ผ่านหน้า
 * ตั้งค่าห้องไม่ได้เพราะห้องพวกนี้สร้างหลัง FEED_VIEW_MODE_LOCK_CUTOFF (อ่านค่า
 * เดิมได้อย่างเดียว ดู isOpenchatTopic ใน report-feed-store.ts) ต้องแก้ตรง DB
 *
 * แก้เฉพาะห้อง (ไม่ใช่หมวด — isCategory ไม่มีผลกับ feedViewMode อยู่แล้วเพราะ
 * เปิดโพสต์ตรงไม่ได้) ที่ชื่อตรงกับรายการห้องใน CATEGORIES ของสคริปต์คู่กัน
 * เท่านั้น เพื่อไม่ไปแตะห้องเดิมของบริษัทที่ตั้งใจทำเป็น Openchat อยู่แล้ว
 *
 * รัน (ต้องมี DATABASE_URL ชี้ไปฐานที่ต้องการ):
 *   pnpm --filter web exec tsx scripts/fix-discord-report-rooms-thread.ts --org=<slug ของบริษัท>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

// ต้องตรงกับ CATEGORIES ใน create-discord-report-rooms.ts
const CHANNEL_NAMES = new Set([
  "a-talk-gl", "knowledge-gl", "sale-gl", "management-gl",
  "a-talk-bpv", "daily-report", "booking-checkin", "qc-talk", "admin-sale-talk",
  "a-talk-const", "บางแสน-const", "พัทยา-const", "กทม-const",
  "a-talk-mk", "artwork-content", "promotion",
  "a-talks", "smartboss", "bpv-app", "lineoa", "otas", "website", "smartorder", "ai-hub-university",
  "a-talk-mc", "บางแสน-mc", "พัทยา-mc", "กทม-mc",
  "a-talk-acc", "pay-partner-app", "it-cost-spending", "request-อนุมัติโอนเงิน",
  "report",
  "open-ticket", "ticket-logs",
]);

type TopicRow = {
  id: string;
  name: string;
  parentId?: string;
  isCategory?: boolean;
  feedViewMode?: "stream" | "threads";
  [key: string]: unknown;
};

async function main() {
  const slug = arg("org");
  if (!slug) {
    console.error("ใช้: pnpm --filter web exec tsx scripts/fix-discord-report-rooms-thread.ts --org=<slug ของบริษัท>");
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) {
    console.error(`ไม่พบบริษัท slug="${slug}"`);
    process.exit(1);
  }

  const feedRow = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId: org.id, key: "report-feed" } } });
  if (!feedRow) {
    console.error("ไม่พบ report-feed store ของบริษัทนี้");
    process.exit(1);
  }
  const data = feedRow.data as { topics?: TopicRow[]; posts?: unknown[]; albums?: unknown[] };
  const topics = data.topics ?? [];

  let changed = 0;
  const updatedTopics = topics.map((t) => {
    if (!t.isCategory && CHANNEL_NAMES.has(t.name) && t.feedViewMode !== "threads") {
      changed += 1;
      console.log(`แก้ "${t.name}" → threads (เดิม: ${t.feedViewMode ?? "undefined (= openchat)"})`);
      return { ...t, feedViewMode: "threads" as const };
    }
    return t;
  });

  if (changed === 0) {
    console.log("ไม่มีห้องไหนต้องแก้ — ทุกห้องเป็น threads อยู่แล้ว หรือไม่พบห้องที่ตรงชื่อ");
    return;
  }

  await prisma.reportTaskStore.update({
    where: { orgId_key: { orgId: org.id, key: "report-feed" } },
    data: { data: { ...data, topics: updatedTopics } as unknown as object, version: { increment: 1 } },
  });
  console.log(`แก้แล้ว ${changed} ห้อง เป็น Thread`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
