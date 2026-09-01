/**
 * สร้างห้องรายงาน (ReportTopic) ให้ตรงกับโครงสร้างห้อง Discord ของบริษัท —
 * แต่ละหมวด (category ใน Discord) กลายเป็นหัวข้อหลัก (isCategory: true, กด
 * เปิดโพสต์ตรงไม่ได้ เป็นแค่ตัวจัดกลุ่ม) แต่ละห้อง (channel) กลายเป็นหัวข้อย่อย
 * (parentId ชี้กลับไปหมวดของมัน) — โครงสร้างตรงกับ topic-sidebar.tsx
 *
 * ทุกห้องที่สร้างเป็นแบบ Thread (feedViewMode: "threads") ทั้งหมด — ห้องไหน
 * อยากได้แบบ Openchat แทน ให้สร้าง/แก้เพิ่มเองทีหลังจากหน้าเว็บ
 *
 * ไม่แตะห้อง/โพสต์ที่มีอยู่แล้ว — merge เข้ากับ topics เดิมใน store คีย์
 * "report-feed" เท่านั้น (อ่านของเดิมมาต่อท้าย ไม่เขียนทับ) ตรวจชื่อหมวด/ห้อง
 * ที่มีอยู่แล้วก่อนด้วย ถ้าซ้ำจะข้าม ไม่สร้างซ้ำ รันซ้ำได้อย่างปลอดภัย
 *
 * รวมทุกหมวด/ห้องที่เห็นในภาพ Discord ครบ — "ห้องประชุม" สร้างเป็นหมวดเปล่า
 * (ไม่มีรายชื่อห้องให้เห็นในภาพต้นฉบับ) และหมวด "test" (มีห้อง whiteboard)
 * บวกห้อง "test" เดี่ยวๆ นอกหมวดใดๆ (TOP_LEVEL_CHANNELS ด้านล่าง)
 *
 * รัน (ต้องมี DATABASE_URL ชี้ไปฐานที่ต้องการ — บนเซิร์ฟเวอร์คือ source
 * /etc/smartboss/smartboss.env ก่อน เหมือนตอนรัน db:deploy):
 *   pnpm --filter web exec tsx scripts/create-discord-report-rooms.ts --org=<slug ของบริษัท>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TOPIC_COLORS = [
  "var(--chart-blue)",
  "var(--chart-violet)",
  "var(--chart-orange)",
  "var(--chart-amber)",
  "var(--chart-green)",
  "var(--chart-pink)",
  "var(--chart-red)",
];

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

const CATEGORIES: { name: string; channels: string[] }[] = [
  { name: "GL Chats", channels: ["a-talk-gl", "knowledge-gl", "sale-gl", "management-gl"] },
  { name: "BPV Chats", channels: ["a-talk-bpv", "daily-report", "booking-checkin", "qc-talk", "admin-sale-talk"] },
  { name: "Construction", channels: ["a-talk-const", "บางแสน-const", "พัทยา-const", "กทม-const"] },
  { name: "Marketing", channels: ["a-talk-mk", "daily-report", "artwork-content", "promotion"] },
  {
    name: "IT, OTA, App, Web, Line, AI",
    channels: ["a-talks", "smartboss", "bpv-app", "lineoa", "otas", "website", "smartorder", "ai-hub-university"],
  },
  { name: "Material Control", channels: ["a-talk-mc", "บางแสน-mc", "พัทยา-mc", "กทม-mc"] },
  { name: "Accounting", channels: ["a-talk-acc", "pay-partner-app", "it-cost-spending", "request-อนุมัติโอนเงิน"] },
  { name: "General Worker", channels: ["report"] },
  { name: "Support Tickets", channels: ["open-ticket", "ticket-logs"] },
  // ไม่มีห้องให้เห็นในภาพต้นฉบับ (ยุบ/ไม่มีข้อความบรรยาย) — สร้างเป็นหมวดเปล่า
  // ไว้ก่อน เพิ่มห้องทีหลังจากหน้าเว็บได้เมื่อรู้ว่ามีห้องอะไรบ้าง
  { name: "ห้องประชุม", channels: [] },
  { name: "test", channels: ["whiteboard"] },
];

/** ห้องเดี่ยวๆ ที่ไม่ได้อยู่ใต้หมวดไหนเลยในภาพ (เช่น "test" ที่ลอยอยู่ล่างสุด) */
const TOP_LEVEL_CHANNELS: string[] = ["test"];

type TopicRow = {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  minImages: number;
  cutoffs: never[];
  parentId?: string;
  isCategory?: boolean;
  feedViewMode?: "stream" | "threads";
};

async function main() {
  const slug = arg("org");
  if (!slug) {
    console.error("ใช้: pnpm --filter web exec tsx scripts/create-discord-report-rooms.ts --org=<slug ของบริษัท>");
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) {
    console.error(`ไม่พบบริษัท slug="${slug}"`);
    process.exit(1);
  }

  const feedRow = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId: org.id, key: "report-feed" } } });
  const existingFeed = (feedRow?.data as { topics?: TopicRow[]; posts?: unknown[]; albums?: unknown[] } | null) ?? {};
  const existingTopics = existingFeed.topics ?? [];
  const existingNames = new Set(existingTopics.map((t) => t.name));

  const now = new Date().toISOString();
  const newTopics: TopicRow[] = [];
  let colorIdx = existingTopics.length;
  let skippedCategories = 0;
  let skippedChannels = 0;

  for (const cat of CATEGORIES) {
    if (existingNames.has(cat.name)) {
      console.log(`ข้าม หมวด "${cat.name}" (มีอยู่แล้ว)`);
      skippedCategories += 1;
      continue;
    }
    const catId = id("topic");
    newTopics.push({
      id: catId,
      name: cat.name,
      color: TOPIC_COLORS[colorIdx % TOPIC_COLORS.length]!,
      createdAt: now,
      minImages: 0,
      cutoffs: [],
      isCategory: true,
    });
    colorIdx += 1;
    for (const channel of cat.channels) {
      if (existingNames.has(channel)) {
        console.log(`  ข้าม ห้อง "${channel}" ใน "${cat.name}" (มีชื่อนี้อยู่แล้วในระบบ)`);
        skippedChannels += 1;
        continue;
      }
      newTopics.push({
        id: id("topic"),
        name: channel,
        color: TOPIC_COLORS[colorIdx % TOPIC_COLORS.length]!,
        createdAt: now,
        minImages: 0,
        cutoffs: [],
        parentId: catId,
        // ทุกห้องสร้างเป็น Thread โดยดีฟอลต์ (ผู้ใช้ขอ) — ห้องไหนอยากได้แบบ
        // Openchat ค่อยสร้าง/แก้เพิ่มเองทีหลัง (แก้ผ่านห้องตั้งค่าไม่ได้ถ้าห้อง
        // ถูกสร้างหลัง FEED_VIEW_MODE_LOCK_CUTOFF — ดู isOpenchatTopic ใน
        // report-feed-store.ts — ต้องลบห้องแล้วสร้างใหม่ หรือแก้ตรง DB)
        feedViewMode: "threads",
      });
      colorIdx += 1;
    }
  }

  for (const channel of TOP_LEVEL_CHANNELS) {
    if (existingNames.has(channel)) {
      console.log(`ข้าม ห้อง "${channel}" (มีชื่อนี้อยู่แล้วในระบบ)`);
      skippedChannels += 1;
      continue;
    }
    newTopics.push({
      id: id("topic"),
      name: channel,
      color: TOPIC_COLORS[colorIdx % TOPIC_COLORS.length]!,
      createdAt: now,
      minImages: 0,
      cutoffs: [],
      feedViewMode: "threads",
    });
    colorIdx += 1;
  }

  if (newTopics.length === 0) {
    console.log("ไม่มีอะไรต้องสร้างเพิ่ม — ทุกหมวด/ห้องมีอยู่แล้ว");
    return;
  }

  const mergedFeed = {
    topics: [...existingTopics, ...newTopics],
    posts: existingFeed.posts ?? [],
    albums: existingFeed.albums ?? [],
  };
  await prisma.reportTaskStore.upsert({
    where: { orgId_key: { orgId: org.id, key: "report-feed" } },
    create: { orgId: org.id, key: "report-feed", data: mergedFeed as unknown as object, version: 1 },
    update: { data: mergedFeed as unknown as object, version: { increment: 1 } },
  });

  const createdCategories = newTopics.filter((t) => t.isCategory).length;
  const createdChannels = newTopics.length - createdCategories;
  console.log(
    `สร้างแล้ว: ${createdCategories} หมวด, ${createdChannels} ห้อง` +
      (skippedCategories || skippedChannels ? ` (ข้ามซ้ำ: ${skippedCategories} หมวด, ${skippedChannels} ห้อง)` : "")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
