// Boss บันทึกงาน: งานส่วนตัวของคนอื่นที่ไม่ได้ส่งมา ต้องไม่ถูกลบ · ที่ส่งมาแก้ได้ (local DB, ลบของทดสอบตอนจบ)
import { prisma } from "@smartboss/database";
import { readTasks, writeTasks } from "@/modules/report_task/lib/db/task-repo";
import type { Task } from "@/modules/report_task/types";

async function main() {
  console.log("start");
  const { orgId } = (await prisma.user.findUnique({ where: { id: "t-hr" }, select: { orgId: true } }))!;
  const id = `task-bosssave-${Date.now()}`;
  const now = new Date().toISOString();
  const personal = { id, title: "BOSSSAVE งานส่วนตัวน้ำฝน", description: "", status: "todo", priority: "medium", taskMode: "individual", assigneeIds: ["t-hr"], assignedById: "t-hr", departmentIds: [], startDate: now, dueDate: now, originalDueDate: now, attachments: [], comments: [], revisions: [], reactions: [], checklist: [], showChecklistOnCard: false, createdAt: now, updatedAt: now } as unknown as Task;
  let ok = true;
  const check = (n: string, v: boolean) => { console.log(`${v ? "✅" : "❌"} ${n}`); if (!v) ok = false; };
  try {
    let cur = await readTasks(orgId);
    let r = await writeTasks(orgId, [...cur.tasks, personal], cur.version, "t-hr");
    check("น้ำฝนสร้างงานส่วนตัว", r.ok);
    // 1) Boss บันทึกรายการที่ไม่มีงานนี้ (แท็บเก่า) → ต้องไม่ลบ
    cur = await readTasks(orgId);
    const withoutIt = cur.tasks.filter((t) => t.id !== id);
    r = await writeTasks(orgId, withoutIt, cur.version, "t-ceo", true);
    cur = await readTasks(orgId);
    check("Boss บันทึกจากแท็บที่ไม่มีงานนี้ → งานยังอยู่", r.ok && cur.tasks.some((t) => t.id === id));
    // 2) Boss แก้งานนี้ (ส่งมาด้วย) → บันทึกได้
    const edited = cur.tasks.map((t) => (t.id === id ? { ...t, title: "BOSSSAVE แก้โดย Boss" } : t));
    r = await writeTasks(orgId, edited, cur.version, "t-ceo", true);
    cur = await readTasks(orgId);
    check("Boss แก้งานส่วนตัวแล้วบันทึกได้", r.ok && cur.tasks.find((t) => t.id === id)?.title === "BOSSSAVE แก้โดย Boss");
    // 3) คนอื่น (ไม่ใช่ Boss) ส่งงานนี้มาแก้ → ไม่รับ
    const hacked = cur.tasks.map((t) => (t.id === id ? { ...t, title: "BOSSSAVE ถูกคนอื่นแก้" } : t));
    r = await writeTasks(orgId, hacked, cur.version, "t-ton", false);
    cur = await readTasks(orgId);
    check("คนอื่นแก้งานส่วนตัวไม่ได้ (ของเดิมไม่เปลี่ยน)", cur.tasks.find((t) => t.id === id)?.title === "BOSSSAVE แก้โดย Boss");
  } finally {
    await prisma.reportTask.deleteMany({ where: { orgId, id } });
    console.log(ok ? "ALL PASS" : "SOME FAIL");
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
