// PM แบบนับรอบ — จำลองบนฐานข้อมูลในเครื่องเท่านั้น (ไม่แตะเซิร์ฟเวอร์)
// รัน: npx tsx --require ./modules/__tests__/tenant-isolation/server-only-stub.cjs .scratch-sim/pm-rounds-sim.ts [setup|run|cleanup]
import { prisma } from "@smartboss/database";
import {
  dockOverdueMaintenance,
  generateWorkOrdersForDuePms,
  notifyDuePmSchedules,
} from "@/modules/maintenance/data/cron";
import { closeAutoWorkOrdersOfPm, completePmSchedule, skipPmSchedule } from "@/modules/maintenance/data/pm";

const TAG = "PMRND";
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ymd = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : null);
let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`);
}

async function org() {
  return (await prisma.user.findUniqueOrThrow({ where: { id: "t-admin" }, select: { orgId: true } })).orgId;
}

async function cleanup(orgId: string) {
  const pms = await prisma.pmSchedule.findMany({ where: { orgId, title: { startsWith: TAG } }, select: { id: true } });
  const ids = pms.map((p) => p.id);
  const wos = await prisma.workOrder.findMany({
    where: { orgId, OR: [{ pmScheduleId: { in: ids } }, { title: { startsWith: TAG } }] },
    select: { id: true },
  });
  const woIds = wos.map((w) => w.id);
  await prisma.performanceEvent.deleteMany({ where: { orgId, refId: { in: woIds } } });
  await prisma.notification.deleteMany({ where: { orgId, referenceId: { in: woIds } } }).catch(() => {});
  await prisma.workOrderComment.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.chatMessage.deleteMany({ where: { orgId, clientId: { in: woIds.map((id) => `wo-${id}`) } } }).catch(() => {});
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await prisma.pmSchedule.deleteMany({ where: { id: { in: ids } } });
  await prisma.performanceSetting.deleteMany({ where: { orgId } });
}

async function setup(orgId: string) {
  await cleanup(orgId);
  // วันเริ่มใช้ 25 ต.ค. — รอบ 1 พ.ย. (เมื่อวาน) ต้องเปิดและโดนหัก, รอบก่อน 25 ต.ค. ไม่หักย้อนหลัง
  await prisma.performanceSetting.create({ data: { orgId, pmRoundsFrom: d("2026-10-25"), pmLeadDays: 14 } });
  const prop = await prisma.property.findFirstOrThrow({ where: { orgId, archivedAt: null }, select: { id: true } });
  const base = { orgId, propertyId: prop.id, frequency: "monthly", assignedTo: "t-ton", createdBy: "t-admin", requiresExpense: false };
  const mk = (title: string, due: string) =>
    prisma.pmSchedule.create({ data: { ...base, title: `${TAG} ${title}`, nextDueDate: d(due), anchorDate: d(due) } });
  const A = await mk("A ล้างแอร์ (ครบ 10 พ.ย.)", "2026-11-10");
  const B = await mk("B เช็คปั๊ม (ครบ 20 ธ.ค.)", "2026-12-20");
  const C = await mk("C ล้างถังเก็บน้ำ (ค้างหลายรอบ)", "2026-12-01");
  const D = await mk("D เช็คตู้ไฟ (ครบ 1 พ.ย.)", "2026-11-01");
  const E = await mk("E วัดค่าน้ำ (ใบเดิมค้าง)", "2026-10-20");
  // G: ราย 3 เดือน ครบ 20 ก.ย. (ก่อนวันเริ่มใช้) ไม่มีใบเลย รอบถัดไป 20 ธ.ค. ยังไม่ถึงเวลาเปิด → ต้องได้ใบรอบที่ค้าง 1 ใบ
  const G = await prisma.pmSchedule.create({ data: { ...base, title: `${TAG} G ล้างแอร์ราย 3 เดือน (ค้างไม่มีใบ)`, frequency: "quarterly", nextDueDate: d("2026-09-20"), anchorDate: d("2026-09-20") } });
  // C: ใบรอบที่ค้างอยู่ 2 รอบ (ก.ย. ต.ค.) + ต.ค. ที่หลังวันเริ่มใช้ไม่ได้ — ใช้ทดสอบหน้า CEO
  for (const [i, r] of ["2026-08-01", "2026-09-01", "2026-10-01"].entries()) {
    await prisma.workOrder.create({
      data: {
        orgId, code: `${TAG}-C${i + 1}`, propertyId: prop.id, assignedTo: "t-ton", title: `${TAG} C ล้างถังเก็บน้ำ`,
        status: "open", priority: "medium", pmScheduleId: C.id, pmRoundDate: d(r),
        dueDate: new Date(`${r}T23:59:59.999+07:00`), autoCreated: true, requiresExpense: false,
      },
    });
  }
  // E: ใบอัตโนมัติแบบเดิม (ไม่มีรอบ ไม่มีกำหนดส่ง) ที่ค้างตั้งแต่ก่อนเปิดใช้
  await prisma.workOrder.create({
    data: {
      orgId, code: `${TAG}-E0`, propertyId: prop.id, assignedTo: "t-ton", title: `${TAG} E วัดค่าน้ำ`,
      status: "open", priority: "medium", pmScheduleId: E.id, autoCreated: true, requiresExpense: false,
    },
  });
  return { A, B, C, D, E, G };
}

async function roundWos(pmId: string) {
  return prisma.workOrder.findMany({ where: { pmScheduleId: pmId }, orderBy: { pmRoundDate: "asc" } });
}

async function run(orgId: string) {
  const { A, B, C, D, E, G } = await setup(orgId);

  const g1 = await generateWorkOrdersForDuePms();
  const g2 = await generateWorkOrdersForDuePms();
  console.log("cron work-orders", g1, g2);

  const a = await roundWos(A.id);
  check("A: ก่อนครบกำหนด 14 วัน เปิดใบรอบ 10 พ.ย. มีกำหนดส่ง", a.length === 1 && ymd(a[0]!.pmRoundDate) === "2026-11-10" && a[0]!.dueDate?.toISOString() === "2026-11-10T16:59:59.999Z", `${a.length} ใบ`);
  check("A: แผนเดินไปรอบถัดไป 10 ธ.ค.", ymd((await prisma.pmSchedule.findUnique({ where: { id: A.id } }))!.nextDueDate) === "2026-12-10");
  const b = await roundWos(B.id);
  check("B: ยังไม่ถึง 14 วันก่อนครบ ไม่เปิดใบ", b.length === 0 && ymd((await prisma.pmSchedule.findUnique({ where: { id: B.id } }))!.nextDueDate) === "2026-12-20");
  const dw = await roundWos(D.id);
  check("D: รอบ 1 พ.ย. เปิดแล้ว", dw.length === 1 && ymd(dw[0]!.pmRoundDate) === "2026-11-01");
  const e = await roundWos(E.id);
  check("E: ใบเดิมที่ค้างถูกนับเป็นรอบ 20 ต.ค. ไม่เปิดซ้อน", e.length === 1 && e[0]!.code === `${TAG}-E0` && ymd(e[0]!.pmRoundDate) === "2026-10-20" && !!e[0]!.dueDate, `${e.length} ใบ`);
  check("E: แผนเดินไป 20 พ.ย.", ymd((await prisma.pmSchedule.findUnique({ where: { id: E.id } }))!.nextDueDate) === "2026-11-20");
  check("cron รันซ้ำไม่เปิดซ้ำ", g2.created === 0);
  const g = await roundWos(G.id);
  check("G: ค้างก่อนวันเริ่มใช้ ไม่มีใบ → เปิดรอบที่ค้างให้ 1 ใบ", g.length === 1 && ymd(g[0]!.pmRoundDate) === "2026-09-20", `${g.length} ใบ`);
  const fW = await roundWos(D.id);
  check("D: มีรอบปัจจุบัน → ไม่เปิดรอบค้างเพิ่ม", fW.length === 1);

  // หักคะแนน
  await dockOverdueMaintenance();
  const allWo = [...dw, ...e, ...(await roundWos(C.id))].map((w) => w.id);
  const docks = (await prisma.performanceEvent.findMany({ where: { orgId, source: "maintenance" } })).filter((x) => allWo.some((id) => (x.refId ?? "").endsWith(id)));
  const dDock = docks.find((x) => (x.refId ?? "").endsWith(dw[0]!.id));
  check("D: หักในหัวข้อ 'ไม่ทำบำรุงรักษาตามรอบ' (−5)", dDock?.category === "pm_missed" && dDock.refType === "pm_schedule" && Number(dDock.points) === -5 && dDock.refId === `${D.id}:2026-11-01:${dw[0]!.id}`, `${dDock?.category} ${dDock?.points} ${dDock?.refId}`);
  check("ไม่มี 'ใบงานเกินกำหนด' ซ้อน", docks.every((x) => x.category !== "workorder_overdue"));
  check("D: เลยกำหนด 1 พ.ย. → หักทันที (ไม่รอ 7 วัน)", !!dDock, dDock ? `${dDock.points} คะแนน ${dDock.userId}` : "ไม่หัก");
  check("E/C: รอบก่อนวันเริ่มใช้ ไม่หักย้อนหลัง", docks.filter((x) => !(x.refId ?? "").endsWith(dw[0]!.id)).length === 0);
  check("G: ใบรอบค้างไม่โดนหัก", (await prisma.performanceEvent.count({ where: { orgId, refId: { endsWith: g[0]?.id ?? "x" } } })) === 0);
  const pmMissed = await prisma.performanceEvent.count({ where: { orgId, category: "pm_missed", refId: { startsWith: D.id } } });
  check("D: หักรอบเดียว ไม่มี 'ไม่ทำตามรอบ' แบบเดิม (แผน:รอบ) ซ้อน", pmMissed === 1, `${pmMissed} รายการ`);

  // ปิดงาน/ยกเลิก ไม่เลื่อนแผน
  await completePmSchedule(orgId, D.id);
  const dPm = (await prisma.pmSchedule.findUnique({ where: { id: D.id } }))!;
  check("D: ปิดงานแล้วรอบถัดไปยังเป็น 1 ธ.ค. ตามแผน", ymd(dPm.nextDueDate) === "2026-12-01" && !!dPm.lastCompletedDate);
  await skipPmSchedule(orgId, E.id);
  check("E: ยกเลิกใบรอบ ไม่เลื่อนแผน", ymd((await prisma.pmSchedule.findUnique({ where: { id: E.id } }))!.nextDueDate) === "2026-11-20");
  await closeAutoWorkOrdersOfPm(orgId, A.id, "done");
  check("A: ปิดรอบจากที่อื่น ไม่ปิดใบรอบ", (await roundWos(A.id))[0]!.status === "open");

  // CEO ยกเว้นคะแนน → คืน
  await prisma.workOrder.update({ where: { id: dw[0]!.id }, data: { overdueScore: "waived" } });
  await dockOverdueMaintenance();
  check("D: CEO ไม่หัก → คืนคะแนน และไม่หักซ้ำ", (await prisma.performanceEvent.count({ where: { orgId, category: "pm_missed", refId: { endsWith: dw[0]!.id } } })) === 0);
  await prisma.workOrder.update({ where: { id: dw[0]!.id }, data: { overdueScore: null } });
  await dockOverdueMaintenance();
  await prisma.workOrder.update({ where: { id: dw[0]!.id }, data: { status: "cancelled", overdueScore: "kept" } });
  await dockOverdueMaintenance();
  check("D: CEO ไม่ต้องทำแต่หักไว้ → คะแนนยังอยู่", (await prisma.performanceEvent.count({ where: { orgId, category: "pm_missed", refId: { endsWith: dw[0]!.id } } })) === 1);
  await prisma.workOrder.update({ where: { id: dw[0]!.id }, data: { status: "open", overdueScore: null } });

  // คะแนน "ใบงานเกินกำหนด" เก่าบนใบรอบ (ก่อนเปลี่ยนหัวข้อ) ต้องถูกคืน
  await prisma.performanceEvent.create({ data: { orgId, userId: "t-ton", source: "maintenance", category: "workorder_overdue", points: -3, occurredAt: new Date(), refType: "work_order", refId: dw[0]!.id } });
  await dockOverdueMaintenance();
  check("คะแนนหัวข้อเก่าบนใบรอบ ถูกคืนเอง", (await prisma.performanceEvent.count({ where: { orgId, category: "workorder_overdue", refId: dw[0]!.id } })) === 0);

  // แจ้งเตือน
  const before = await prisma.notification.count({ where: { referenceId: dw[0]!.id } }).catch(() => -1);
  await notifyDuePmSchedules();
  const after = await prisma.notification.count({ where: { referenceId: dw[0]!.id } }).catch(() => -1);
  check("D: เลยกำหนด 1 วัน → เตือนช่างจากใบรอบ", after > before, `${before} → ${after}`);

  console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL`);
}

(async () => {
  const orgId = await org();
  const mode = process.argv[2] ?? "run";
  if (mode === "cleanup") await cleanup(orgId);
  else if (mode === "setup") await setup(orgId);
  else await run(orgId);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error("CRASH", e);
  process.exit(1);
});
