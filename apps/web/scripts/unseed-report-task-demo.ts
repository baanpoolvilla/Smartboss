/**
 * ลบข้อมูลทดสอบที่ seed-report-task-demo.ts สร้างไว้ทั้งหมด — งาน, สิ่งที่ต้องทำ,
 * ห้องรายงาน (และโพสต์ในห้องทดสอบนั้นๆ ถ้ามีคนลองโพสต์ไว้) เฉพาะรายการที่ชื่อ
 * ขึ้นต้นด้วย "[ทดสอบ] " เท่านั้น — ไม่แตะข้อมูลจริงของบริษัท
 *
 * รัน:
 *   pnpm --filter web exec tsx scripts/unseed-report-task-demo.ts --org=<slug ของบริษัท>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = "[ทดสอบ] ";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const slug = arg("org");
  if (!slug) {
    console.error("ใช้: pnpm --filter web exec tsx scripts/unseed-report-task-demo.ts --org=<slug ของบริษัท>");
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) {
    console.error(`ไม่พบบริษัท slug="${slug}"`);
    process.exit(1);
  }

  // ── งาน ──
  const removedTasks = await prisma.$transaction(async (tx) => {
    const result = await tx.reportTask.deleteMany({
      where: { orgId: org.id, title: { startsWith: TEST_PREFIX } },
    });
    if (result.count > 0) {
      await tx.reportTaskCollection.upsert({
        where: { orgId: org.id },
        update: { version: { increment: 1 } },
        create: { orgId: org.id, version: 1 },
      });
    }
    return result.count;
  });
  console.log(`ลบงานทดสอบ ${removedTasks} รายการ`);

  // ── สิ่งที่ต้องทำ ──
  type TodoRow = { title: string };
  const todoRow = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId: org.id, key: "todos" } } });
  const todos = (todoRow?.data as TodoRow[] | null) ?? [];
  const keptTodos = todos.filter((t) => !t.title.startsWith(TEST_PREFIX));
  if (keptTodos.length !== todos.length) {
    await prisma.reportTaskStore.update({
      where: { orgId_key: { orgId: org.id, key: "todos" } },
      data: { data: keptTodos as unknown as object, version: { increment: 1 } },
    });
  }
  console.log(`ลบสิ่งที่ต้องทำทดสอบ ${todos.length - keptTodos.length} รายการ`);

  // ── ห้องรายงาน (+ โพสต์ในห้องนั้น ถ้ามี) ──
  type TopicRow = { id: string; name: string };
  type PostRow = { topicId: string };
  const feedRow = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId: org.id, key: "report-feed" } } });
  const feed = (feedRow?.data as { topics?: TopicRow[]; posts?: PostRow[]; albums?: { topicId: string }[] } | null) ?? null;
  if (feed) {
    const removedTopicIds = new Set(
      (feed.topics ?? []).filter((t) => t.name.startsWith(TEST_PREFIX)).map((t) => t.id)
    );
    const keptTopics = (feed.topics ?? []).filter((t) => !removedTopicIds.has(t.id));
    const keptPosts = (feed.posts ?? []).filter((p) => !removedTopicIds.has(p.topicId));
    const keptAlbums = (feed.albums ?? []).filter((a) => !removedTopicIds.has(a.topicId));
    if (removedTopicIds.size > 0) {
      await prisma.reportTaskStore.update({
        where: { orgId_key: { orgId: org.id, key: "report-feed" } },
        data: {
          data: { topics: keptTopics, posts: keptPosts, albums: keptAlbums } as unknown as object,
          version: { increment: 1 },
        },
      });
    }
    console.log(`ลบห้องรายงานทดสอบ ${removedTopicIds.size} ห้อง (พร้อมโพสต์ในห้องนั้น ${(feed.posts ?? []).length - keptPosts.length} รายการ)`);
  } else {
    console.log("ไม่มีข้อมูลห้องรายงานให้ลบ");
  }

  console.log("\nลบข้อมูลทดสอบทั้งหมดเรียบร้อย");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
