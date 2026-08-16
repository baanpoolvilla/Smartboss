/**
 * ใส่ข้อมูลทดสอบให้โมดูล "รายงานและงาน" — งาน (Task) ครบทุกสถานะ/ความสำคัญ
 * กระจายให้ทุกคนรวมถึงเจ้าของ/CEO, สิ่งที่ต้องทำ (to-do) ของทุกคน, ห้องรายงาน
 * ตามแผนก + ห้องรวม (สลับ สตรีม/กระทู้) พร้อม "รอบส่ง" จริง และประวัติการส่ง
 * รายงานย้อนหลัง (ตรงเวลา/ส่งช้า/ไม่ส่ง ปนกัน ครบทุกแผนก ไม่มีอะไรว่างเปล่า)
 *
 * ทุกอย่างที่สร้างมีคำนำหน้า "[ทดสอบ] " เสมอ — ใช้เป็นตัวคั่นชัดๆ ให้ลบทิ้งทีหลัง
 * ได้ง่ายด้วย unseed-report-task-demo.ts (คู่กัน) โดยไม่ไปแตะข้อมูลจริงของบริษัท
 *
 * รัน (ต้องมี DATABASE_URL ชี้ไปฐานที่ต้องการ — บนเซิร์ฟเวอร์คือ source
 * /etc/smartboss/smartboss.env ก่อนเหมือนตอนรัน db:deploy):
 *   pnpm --filter web exec tsx scripts/seed-report-task-demo.ts --org=<slug ของบริษัท>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PREFIX = "[ทดสอบ] ";
const OWNER_ROLE_CODES = new Set(["SUPER_ADMIN", "ADMIN", "CEO"]);
const TOPIC_COLORS = [
  "var(--chart-blue)",
  "var(--chart-violet)",
  "var(--chart-orange)",
  "var(--chart-amber)",
  "var(--chart-green)",
  "var(--chart-pink)",
  "var(--chart-red)",
];
// "รอบส่ง" ของทุกห้องทดสอบ — เวลาเดียวกันหมดเพื่อให้คาดเดาผลได้ (โพสต์ก่อนเที่ยง
// = ตรงเวลา, หลังเที่ยง = ส่งช้า, ไม่โพสต์เลยของวันนี้หลังเที่ยงแล้ว = ยังไม่ส่ง)
const CUTOFF_HOUR = 12;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function ymdDaysFromNow(days: number): string {
  return isoDaysFromNow(days).slice(0, 10);
}

/** ISO ของวันที่ `dayYmd` เวลา `hh:mm` ตามเวลาเครื่องเซิร์ฟเวอร์ — ต้อง new Date()
 * จาก string เปล่าๆ ก่อนแล้วค่อย setHours ไม่งั้น Date parsing ของ "YYYY-MM-DDTHH:mm"
 * จะตีความเป็น UTC แทนเวลาท้องถิ่น ทำให้ชั่วโมงเพี้ยนไปตาม timezone offset */
function isoAtTime(dayYmd: string, hh: number, mm: number): string {
  const d = new Date(`${dayYmd}T00:00:00`);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}-test-${Date.now().toString(36)}-${seq}`;
}

async function main() {
  const slug = arg("org");
  if (!slug) {
    console.error("ใช้: pnpm --filter web exec tsx scripts/seed-report-task-demo.ts --org=<slug ของบริษัท>");
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) {
    console.error(`ไม่พบบริษัท slug="${slug}"`);
    process.exit(1);
  }

  const [users, departments] = await Promise.all([
    prisma.user.findMany({
      where: { orgId: org.id, isActive: true },
      select: { id: true, name: true, departmentId: true, roles: { select: { role: { select: { code: true } } } } },
    }),
    prisma.department.findMany({ where: { orgId: org.id }, select: { id: true, name: true } }),
  ]);

  if (users.length === 0) {
    console.error("บริษัทนี้ยังไม่มีผู้ใช้งาน — ใส่ข้อมูลทดสอบไม่ได้");
    process.exit(1);
  }

  const ownerTier = users.filter((u) => u.roles.some((r) => OWNER_ROLE_CODES.has(r.role.code)));
  const ceo = ownerTier[0] ?? users[0]!;
  const staff = users.filter((u) => u.id !== ceo.id);
  const pool = staff.length > 0 ? staff : users; // org เล็กมากมีแค่ CEO คนเดียวก็ยังรันได้

  console.log(`บริษัท: ${org.name} (${org.id})`);
  console.log(`CEO/เจ้าของที่ใช้: ${ceo.name}`);
  console.log(`พนักงานอื่น: ${staff.length} คน, แผนก: ${departments.length} แผนก`);

  // ── 1) งาน (Task) — ตาราง report_task.tasks ──
  const statuses = ["todo", "in_progress", "done"] as const;
  const priorities = ["critical", "high", "medium", "low"] as const;
  const now = new Date().toISOString();

  type TaskRow = {
    id: string;
    code: string;
    title: string;
    description: string;
    status: (typeof statuses)[number];
    priority: (typeof priorities)[number];
    taskMode: "individual" | "group";
    assigneeIds: string[];
    assignedById: string;
    departmentIds: string[];
    startDate: string;
    dueDate: string;
    originalDueDate: string;
    completedAt?: string;
    attachments: never[];
    comments: never[];
    revisions: never[];
    reactions: never[];
    checklist: never[];
    showChecklistOnCard: boolean;
    createdAt: string;
    updatedAt: string;
  };

  const tasks: TaskRow[] = [];
  let testCodeN = 0;
  function nextTestCode(): string {
    testCodeN += 1;
    return `TEST-${String(testCodeN).padStart(4, "0")}`;
  }

  function makeTask(opts: {
    title: string;
    status: (typeof statuses)[number];
    priority: (typeof priorities)[number];
    assigneeIds: string[];
    assignedById: string;
    departmentIds: string[];
    dueInDays: number; // ติดลบ = เลยกำหนดแล้ว
  }): TaskRow {
    const taskId = id("task");
    return {
      id: taskId,
      code: nextTestCode(),
      title: `${TEST_PREFIX}${opts.title}`,
      description: "งานทดสอบ สร้างโดยสคริปต์ seed-report-task-demo — ลบได้ด้วย unseed-report-task-demo",
      status: opts.status,
      priority: opts.priority,
      taskMode: opts.assigneeIds.length > 1 ? "group" : "individual",
      assigneeIds: opts.assigneeIds,
      assignedById: opts.assignedById,
      departmentIds: opts.departmentIds,
      startDate: ymdDaysFromNow(Math.min(0, opts.dueInDays) - 1),
      dueDate: isoDaysFromNow(opts.dueInDays),
      originalDueDate: isoDaysFromNow(opts.dueInDays),
      ...(opts.status === "done" ? { completedAt: now } : {}),
      attachments: [],
      comments: [],
      revisions: [],
      reactions: [],
      checklist: [],
      showChecklistOnCard: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  // งานรายคน — วน status/priority ให้ครบทุกแบบ, ครึ่งหนึ่งมอบหมายโดย CEO
  // (จำลอง "CEO สั่งงาน") อีกครึ่งมอบหมายกันเองในแผนก, มีเลยกำหนดปนด้วย
  pool.forEach((u, i) => {
    const status = statuses[i % statuses.length]!;
    const priority = priorities[i % priorities.length]!;
    const assignedByCeo = i % 2 === 0;
    const overdue = i % 5 === 0 && status !== "done";
    const mate = pool[(i + 1) % pool.length]!;
    tasks.push(
      makeTask({
        title: `${u.name} — งานประจำสัปดาห์ (${priority})`,
        status,
        priority,
        assigneeIds: [u.id],
        assignedById: assignedByCeo ? ceo.id : mate.id,
        departmentIds: u.departmentId ? [u.departmentId] : [],
        dueInDays: overdue ? -3 : 3 + (i % 5),
      })
    );
  });

  // เติมให้ "ทุกแผนก" มีงานครบทั้ง 3 สถานะอย่างน้อยแผนกละ 1 งาน — งานรายคน
  // ด้านบนกระจายตามลำดับพนักงานรวมทั้งบริษัท จึงมีโอกาสที่บางแผนกไม่มีงาน
  // "เสร็จแล้ว" เลยสักงาน (การ์ดสรุป/กราฟแยกตามแผนกเลยว่างเปล่าไปทั้งแท่ง) —
  // วนเติมเฉพาะสถานะที่แผนกนั้นยังไม่มีให้ครบ ไม่ให้มีแผนกไหน 0% ทุกช่อง
  for (const dept of departments) {
    const members = pool.filter((u) => u.departmentId === dept.id);
    if (members.length === 0) continue;
    const covered = new Set(
      tasks.filter((t) => t.departmentIds.includes(dept.id)).map((t) => t.status)
    );
    statuses.forEach((status, si) => {
      if (covered.has(status)) return;
      const member = members[si % members.length]!;
      tasks.push(
        makeTask({
          title: `${dept.name} — งานเสริมให้ครบทุกสถานะ (${status})`,
          status,
          priority: priorities[si % priorities.length]!,
          assigneeIds: [member.id],
          assignedById: ceo.id,
          departmentIds: [dept.id],
          dueInDays: status === "done" ? -2 : 4,
        })
      );
    });
  }

  // งานที่ CEO เป็น "ผู้รับ" เอง — ตอบคำถามว่า CEO ควรเห็นงานของตัวเองได้ด้วย
  // (dueInDays: 2 ตรงกับ leadDays เริ่มต้นของการแจ้งเตือน "ใกล้ถึงกำหนด" [3,1]
  // เลยควรมีแจ้งเตือนขึ้นให้ CEO เองด้วยเมื่อ sweep ทำงาน — ดู reminder-sweep.ts)
  tasks.push(
    makeTask({
      title: "CEO — อนุมัติงบประมาณไตรมาส",
      status: "todo",
      priority: "critical",
      assigneeIds: [ceo.id],
      assignedById: ceo.id,
      departmentIds: [],
      dueInDays: -1,
    })
  );
  tasks.push(
    makeTask({
      title: "CEO — ทบทวนแผนงานร่วมกับหัวหน้าแผนก",
      status: "in_progress",
      priority: "high",
      assigneeIds: [ceo.id],
      assignedById: staff[0]?.id ?? ceo.id,
      departmentIds: [],
      dueInDays: 2,
    })
  );
  tasks.push(
    makeTask({
      title: "CEO — เซ็นเอกสารที่เสร็จแล้ว",
      status: "done",
      priority: "low",
      assigneeIds: [ceo.id],
      assignedById: ceo.id,
      departmentIds: [],
      dueInDays: -7,
    })
  );

  // งานกลุ่ม (group) ให้เห็นความต่างจากงานเดี่ยวด้วย
  if (pool.length >= 2) {
    tasks.push(
      makeTask({
        title: "งานกลุ่ม — เตรียมงานอีเวนต์บริษัท",
        status: "in_progress",
        priority: "medium",
        assigneeIds: pool.slice(0, Math.min(3, pool.length)).map((u) => u.id),
        assignedById: ceo.id,
        departmentIds: [],
        dueInDays: 10,
      })
    );
  }

  await prisma.$transaction(async (tx) => {
    for (const t of tasks) {
      await tx.reportTask.create({
        data: {
          orgId: org.id,
          id: t.id,
          code: t.code,
          title: t.title,
          status: t.status,
          priority: t.priority,
          taskMode: t.taskMode,
          assignedById: t.assignedById,
          assigneeIds: t.assigneeIds,
          startDate: t.startDate,
          dueDate: t.dueDate,
          completedAt: t.completedAt ?? null,
          data: t as unknown as object,
        },
      });
    }
    await tx.reportTaskCollection.upsert({
      where: { orgId: org.id },
      update: { version: { increment: 1 } },
      create: { orgId: org.id, version: 1 },
    });
  });
  console.log(`สร้างงานทดสอบ ${tasks.length} รายการ (ครบทุกแผนก x ทุกสถานะ)`);

  // ── 2) สิ่งที่ต้องทำ (to-do) — report_task.stores คีย์ "todos" (data = array ตรงๆ) ──
  type TodoRow = { id: string; userId: string; date: string; title: string; done: boolean; createdAt: string; time?: string };
  const todos: TodoRow[] = [];
  users.forEach((u, i) => {
    todos.push({
      id: id("todo"),
      userId: u.id,
      date: ymdDaysFromNow(i % 3),
      title: `${TEST_PREFIX}โทรหาลูกค้า`,
      done: false,
      createdAt: now,
      time: "10:00",
    });
    todos.push({
      id: id("todo"),
      userId: u.id,
      date: ymdDaysFromNow(-1),
      title: `${TEST_PREFIX}สรุปงานเมื่อวาน`,
      done: true,
      createdAt: now,
    });
  });

  const todoRow = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId: org.id, key: "todos" } } });
  const existingTodos = (todoRow?.data as TodoRow[] | null) ?? [];
  await prisma.reportTaskStore.upsert({
    where: { orgId_key: { orgId: org.id, key: "todos" } },
    create: { orgId: org.id, key: "todos", data: [...existingTodos, ...todos] as unknown as object, version: 1 },
    update: { data: [...existingTodos, ...todos] as unknown as object, version: { increment: 1 } },
  });
  console.log(`สร้างสิ่งที่ต้องทำ ${todos.length} รายการ (คนละ 2)`);

  // ── 3) ห้องรายงาน + รอบส่ง — report_task.stores คีย์ "report-feed" ──
  type TopicRow = {
    id: string;
    name: string;
    color: string;
    createdAt: string;
    minImages: number;
    cutoffs: { id: string; label: string; time: string }[];
    feedViewMode?: "stream" | "threads";
    visibility?: { departmentIds?: string[] };
    description?: string;
  };
  type PostRow = {
    id: string;
    topicId: string;
    authorId: string;
    createdAt: string;
    editedAt: null;
    pinned: false;
    savedBy: never[];
    unreadFor: never[];
    reactions: Record<string, never>;
    replies: never[];
    title: string;
    sections: never[];
    images: never[];
  };

  // ห้องสร้างเมื่อ 5 วันก่อน ให้มีที่ว่างพอสำหรับประวัติย้อนหลัง 4 วัน + วันนี้
  const roomCreatedAt = isoDaysFromNow(-5);
  const topics: TopicRow[] = [];
  const posts: PostRow[] = [];

  function makePost(topicId: string, authorId: string, dayYmd: string, hh: number, mm: number): PostRow {
    return {
      id: id("post"),
      topicId,
      authorId,
      createdAt: isoAtTime(dayYmd, hh, mm),
      editedAt: null,
      pinned: false,
      savedBy: [],
      unreadFor: [],
      reactions: {},
      replies: [],
      title: `${TEST_PREFIX}รายงานประจำวัน`,
      sections: [],
      images: [],
    };
  }

  /**
   * ประวัติส่งรายงานของ `members` ในห้อง `topicId` — ผสมทั้งตรงเวลา/ส่งช้า/
   * ไม่ส่ง ทั้งย้อนหลัง 4 วันและวันนี้ ไม่ใช่สุ่มจริง (ใช้ index คำนวณ) เพื่อให้
   * รันซ้ำแล้วยังได้รูปแบบเดิม ตรวจสอบง่าย
   */
  function seedRoomHistory(topicId: string, members: { id: string }[]) {
    members.forEach((m, i) => {
      // 4 วันย้อนหลัง (ไม่รวมวันนี้)
      for (let d = -4; d <= -1; d++) {
        const day = ymdDaysFromNow(d);
        const bucket = (i + Math.abs(d)) % 5;
        if (bucket === 0) continue; // ไม่ส่งวันนั้น (ประวัติ "ไม่ส่ง")
        const late = bucket === 2;
        posts.push(makePost(topicId, m.id, day, late ? 15 : 9, 30));
      }
      // วันนี้ — 1 ใน 3 ยังไม่ส่งเลย (โชว์สถานะ "ยังไม่ส่ง" ของวันนี้จริงๆ),
      // 1 ใน 3 ส่งไปแล้วตอนเช้า (ตรงเวลา), ที่เหลือส่ง ณ เวลาที่รันสคริปต์นี้
      // จริงๆ (ถ้ารันหลังเที่ยงจะกลายเป็น "ส่งช้า" เองตามเวลาจริง)
      const todayBucket = i % 3;
      if (todayBucket === 0) return; // ยังไม่ส่งวันนี้
      const today = ymdDaysFromNow(0);
      if (todayBucket === 1) posts.push(makePost(topicId, m.id, today, 9, 15));
      else posts.push({ ...makePost(topicId, m.id, today, 0, 0), createdAt: new Date().toISOString() });
    });
  }

  departments.forEach((d, i) => {
    const topicId = id("topic");
    const members = pool.filter((u) => u.departmentId === d.id);
    topics.push({
      id: topicId,
      name: `${TEST_PREFIX}${d.name}`,
      color: TOPIC_COLORS[i % TOPIC_COLORS.length]!,
      createdAt: roomCreatedAt,
      minImages: 0,
      cutoffs: [{ id: id("cutoff"), label: "ประจำวัน", time: `${String(CUTOFF_HOUR).padStart(2, "0")}:00` }],
      feedViewMode: i % 2 === 0 ? "threads" : "stream",
      visibility: { departmentIds: [d.id] },
      description: `ห้องรายงานประจำแผนก${d.name} (ทดสอบ)`,
    });
    if (members.length > 0) seedRoomHistory(topicId, members);
  });

  const combinedTopicId = id("topic");
  topics.push({
    id: combinedTopicId,
    name: `${TEST_PREFIX}รวมทุกแผนก`,
    color: TOPIC_COLORS[topics.length % TOPIC_COLORS.length]!,
    createdAt: roomCreatedAt,
    minImages: 0,
    cutoffs: [{ id: id("cutoff"), label: "ประจำวัน", time: `${String(CUTOFF_HOUR).padStart(2, "0")}:00` }],
    feedViewMode: "stream",
    description: "ห้องรวมทั้งบริษัท เปิดให้ทุกคนเห็น (ทดสอบ)",
  });
  seedRoomHistory(combinedTopicId, users); // รวม CEO ด้วย — ห้องนี้เปิดให้ทุกคน

  const feedRow = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId: org.id, key: "report-feed" } } });
  const existingFeed = (feedRow?.data as { topics?: TopicRow[]; posts?: PostRow[]; albums?: unknown[] } | null) ?? {};
  const mergedFeed = {
    topics: [...(existingFeed.topics ?? []), ...topics],
    posts: [...(existingFeed.posts ?? []), ...posts],
    albums: existingFeed.albums ?? [],
  };
  await prisma.reportTaskStore.upsert({
    where: { orgId_key: { orgId: org.id, key: "report-feed" } },
    create: { orgId: org.id, key: "report-feed", data: mergedFeed as unknown as object, version: 1 },
    update: { data: mergedFeed as unknown as object, version: { increment: 1 } },
  });
  console.log(`สร้างห้องรายงาน ${topics.length} ห้อง (ตามแผนก ${departments.length} + รวม 1) พร้อมโพสต์ย้อนหลัง ${posts.length} รายการ (ตรงเวลา/ส่งช้า/ไม่ส่ง ปนกัน)`);

  console.log("\nเสร็จแล้ว — ทุกอย่างขึ้นต้นด้วย \"[ทดสอบ] \" ลบทิ้งทั้งหมดได้ด้วย:");
  console.log(`  pnpm --filter web exec tsx scripts/unseed-report-task-demo.ts --org=${slug}`);
  console.log("\nแจ้งเตือน \"ใกล้ถึงกำหนด\" ของงาน/รอบส่งรายงาน จะขึ้นเองในกระดิ่งอัตโนมัติภายใน 60 วิ หลังเปิดหน้าเว็บค้างไว้ (sweep ทำงานฝั่ง client เป็นระยะ) ไม่ต้องรันอะไรเพิ่ม");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
