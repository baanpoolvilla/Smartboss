/**
 * PM กติกาใหม่ (10/11/2569) — ทดสอบกับฐานข้อมูลบนเครื่อง ด้วยฟังก์ชันจริง แล้วลบข้อมูลทดสอบทิ้ง
 * 1 ใบเปิดก่อนวัน (ยังไม่รับ) → ปิดไปก่อน + แผนถอยกลับมารอบนั้น
 * 2 ใบถึงวันแล้ว (กำหนดส่ง = วันของรอบ เลยแล้ว + โดนหัก) → ขยายเป็น +14 + คืนคะแนน
 * 3 ใบรอบในอนาคตที่รับงานแล้ว → ขยาย ไม่ปิด
 * 4 ทำรอบล่วงหน้า: คนตั้งได้ · คนอื่นไม่ได้ · ซ้ำไม่ได้ · ตัวปรับกติกาไม่ไปปิดใบล่วงหน้า · ถึงวันระบบไม่เปิดซ้ำ
 * 5 แผนที่รอบแรก = วันนี้ → เปิดใบทันที กำหนดส่ง = วันนี้ + 14
 */
import { prisma } from "@smartboss/database";
import { applyWindowTransition, generateRoundWorkOrders, loadRoundOrg, openEarlyRound } from "@/modules/maintenance/data/pm-rounds";
import { roundDueAt, roundDockRefId, todayBkkDate, ymd } from "@/modules/maintenance/lib/pm-rounds";

let fail = 0;
const ok = (c: unknown, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fail++; };
const DAY = 86_400_000;

async function main() {
  const orgId = (await prisma.user.findUnique({ where: { id: "t-admin" }, select: { orgId: true } }))!.orgId!;
  const prop = (await prisma.property.findFirst({ where: { orgId }, select: { id: true } }))!;
  const st = (await loadRoundOrg(orgId))!;
  const today = todayBkkDate();
  const at = (n: number) => new Date(today.getTime() + n * DAY);
  const pmIds: string[] = [];
  const woIds: string[] = [];
  const mkPm = async (title: string, next: Date, freq = "weekly") => {
    const pm = await prisma.pmSchedule.create({
      data: { orgId, propertyId: prop.id, title, frequency: freq, nextDueDate: next, anchorDate: next, isActive: true, createdBy: "t-admin", assignedTo: "t-staff" },
    });
    pmIds.push(pm.id);
    return pm;
  };
  const mkWo = async (pmId: string, round: Date, status: string, due: Date) => {
    const wo = await prisma.workOrder.create({
      data: { orgId, code: `TPMW-${Date.now() % 1e7}-${woIds.length}`, propertyId: prop.id, title: "ทดสอบ PM รอบ", status, priority: "medium", pmScheduleId: pmId, pmRoundDate: round, dueDate: due, autoCreated: true, assignedTo: "t-staff" },
    });
    woIds.push(wo.id);
    return wo;
  };
  try {
    // ---- 1-3 เปลี่ยนกติกา ----
    const pmA = await mkPm("TPMW ปิดก่อน", at(14)); // แผนเดินไปไกลแล้ว (เปิดรอบ +7 ไปตามกติกาเดิม)
    const woA = await mkWo(pmA.id, at(7), "open", roundDueAt(at(7), 0));
    const woB = await mkWo(pmA.id, at(-3), "open", roundDueAt(at(-3), 0));
    const woC = await mkWo(pmA.id, at(5), "in_progress", roundDueAt(at(5), 0));
    const dockRef = roundDockRefId(pmA.id, at(-3), woB.id);
    await prisma.performanceEvent.create({
      data: { orgId, userId: "t-staff", source: "maintenance", category: "pm_missed", points: -1, occurredAt: new Date(), refType: "pm_schedule", refId: dockRef, note: "ทดสอบ" },
    });

    // บนเซิร์ฟเวอร์จริงช่องรูปของใบอัตโนมัติเป็น NULL — จำลองให้เหมือน
    await prisma.$executeRawUnsafe(`UPDATE maintenance.work_orders SET photo_urls = NULL, after_photo_urls = NULL WHERE id IN ('${woA.id}','${woB.id}','${woC.id}')`);
    const r1 = await applyWindowTransition(new Map([[orgId, st]]), [pmA.id]);
    ok(r1.closed === 1 && r1.extended === 2, `ปรับใบเก่า: ปิด ${r1.closed} ขยาย ${r1.extended}`);
    const a = await prisma.workOrder.findFirst({ where: { orgId, id: woA.id } });
    ok(a?.status === "cancelled" && a.pmRoundDate === null, "1 ใบเปิดก่อนวัน (ยังไม่รับ) → ปิดไปก่อน");
    const pmA2 = await prisma.pmSchedule.findFirst({ where: { orgId, id: pmA.id } });
    ok(ymd(pmA2!.nextDueDate) === ymd(at(7)), `1 แผนถอยรอบถัดไปกลับมาที่ ${ymd(at(7))} (ถึงวันระบบเปิดใหม่)`);
    const b = await prisma.workOrder.findFirst({ where: { orgId, id: woB.id } });
    ok(b?.dueDate?.getTime() === roundDueAt(at(-3), 14).getTime(), `2 ใบถึงวันแล้ว → กำหนดส่ง ${b?.dueDate?.toISOString()}`);
    ok((await prisma.performanceEvent.count({ where: { orgId, refId: dockRef } })) === 0, "2 คืนคะแนนที่หักไปก่อนครบเวลาใหม่");
    const c = await prisma.workOrder.findFirst({ where: { orgId, id: woC.id } });
    ok(c?.status === "in_progress" && c.dueDate?.getTime() === roundDueAt(at(5), 14).getTime(), "3 ใบในอนาคตที่รับงานแล้ว → ไม่ปิด ขยายเวลา");
    const r2 = await applyWindowTransition(new Map([[orgId, st]]), [pmA.id]);
    ok(r2.closed === 0 && r2.extended === 0, "รันซ้ำไม่เปลี่ยนอะไร");
    const before = await prisma.workOrder.count({ where: { orgId, pmScheduleId: pmA.id } });
    await generateRoundWorkOrders(new Map([[orgId, st]]), [pmA.id]);
    ok((await prisma.workOrder.count({ where: { orgId, pmScheduleId: pmA.id } })) === before, "ยังไม่ถึงวัน ระบบยังไม่เปิดใบใหม่");

    // ---- 3b เคสเพิ่ม: ใบกลุ่มวันรายคน · การ์ดในแชท · ใบที่เริ่มทำแล้ว ----
    const pmG = await mkPm("TPMW กลุ่ม", at(21));
    const woG = await mkWo(pmG.id, at(-2), "open", roundDueAt(at(-2), 0));
    await prisma.workOrder.update({ where: { id: woG.id, orgId }, data: { groupMemberIds: ["t-caretaker"], memberDueDates: { "t-caretaker": ymd(at(-2)), "t-staff": ymd(at(30)) } } });
    const woS = await mkWo(pmG.id, at(9), "open", roundDueAt(at(9), 0)); // ยังไม่ถึงวัน แต่มีคอมเมนต์แล้ว
    await prisma.workOrderComment.create({ data: { orgId, workOrderId: woS.id, userId: "t-staff", content: "เริ่มทำแล้ว (ทดสอบ)" } });
    const woK = await mkWo(pmG.id, at(12), "open", roundDueAt(at(12), 0)); // ยังไม่ถึงวัน มีการ์ดในแชท
    const { postWorkOrderCard } = await import("@/modules/chat/data/task-cards");
    await postWorkOrderCard(orgId, { assignerId: "t-admin", assigneeId: "t-staff", workOrderId: woK.id, title: "การ์ดปิด", dueDate: woK.dueDate });
    await postWorkOrderCard(orgId, { assignerId: "t-admin", assigneeId: "t-staff", workOrderId: woG.id, title: "การ์ดขยาย", dueDate: woG.dueDate });
    await applyWindowTransition(new Map([[orgId, st]]), [pmG.id]);
    const g = await prisma.workOrder.findFirst({ where: { orgId, id: woG.id } });
    const md = g?.memberDueDates as Record<string, string>;
    const newDay = ymd(new Date(roundDueAt(at(-2), 14).getTime() + 7 * 3600e3));
    ok(md["t-caretaker"] === newDay && md["t-staff"] === ymd(at(30)), `ใบกลุ่ม: วันรายคนที่เร็วกว่า ขยายเป็น ${newDay} · คนที่ได้วันไกลกว่าไม่แตะ`);
    const sx = await prisma.workOrder.findFirst({ where: { orgId, id: woS.id } });
    ok(sx?.status === "open" && sx.dueDate?.getTime() === roundDueAt(at(9), 14).getTime(), "ใบยังไม่ถึงวันแต่มีคอมเมนต์แล้ว: ไม่ปิด ขยายเวลาแทน");
    const kCard = await prisma.chatMessage.findFirst({ where: { orgId, clientId: `wo-${woK.id}` } });
    ok(!!kCard?.deletedAt, "ใบที่ปิดไปก่อน: การ์ดในแชทถูกซ่อน");
    const gCard = await prisma.chatMessage.findFirst({ where: { orgId, clientId: `wo-${woG.id}` } });
    ok((gCard?.meta as { dueDate?: string })?.dueDate === roundDueAt(at(-2), 14).toISOString() && !gCard?.deletedAt, "ใบที่ขยาย: การ์ดในแชทแสดงกำหนดส่งใหม่");
    const pmG2 = await prisma.pmSchedule.findFirst({ where: { orgId, id: pmG.id } });
    ok(ymd(pmG2!.nextDueDate) === ymd(at(12)) && ymd(pmG2!.anchorDate!) === ymd(at(21)), "ถอยรอบถัดไปของแผน แต่วันตั้งต้น (anchor) ไม่เปลี่ยน");
    await prisma.chatMessage.deleteMany({ where: { orgId, clientId: { in: [`wo-${woK.id}`, `wo-${woG.id}`] } } });
    await prisma.workOrderComment.deleteMany({ where: { orgId, workOrderId: woS.id } });

    // ---- 4 ทำรอบล่วงหน้า ----
    const notCreator = await openEarlyRound(orgId, pmA.id, ymd(at(7)), "t-staff");
    ok("error" in notCreator, `คนที่ไม่ใช่คนตั้ง PM ทำล่วงหน้าไม่ได้: ${"error" in notCreator ? notCreator.error : ""}`);
    const early = await openEarlyRound(orgId, pmA.id, ymd(at(7)), "t-admin");
    ok("id" in early, "คนตั้ง PM เปิดรอบล่วงหน้าได้");
    if ("id" in early) {
      woIds.push(early.id);
      const e = await prisma.workOrder.findFirst({ where: { orgId, id: early.id } });
      ok(e?.status === "open" && ymd(e.pmRoundDate!) === ymd(at(7)) && e.dueDate?.getTime() === roundDueAt(at(7), 14).getTime() && !e.autoCreated, "ใบล่วงหน้า: รอบ +7 กำหนดส่ง = รอบ + 14 ไม่ใช่ใบอัตโนมัติ");
      const again = await openEarlyRound(orgId, pmA.id, ymd(at(7)), "t-admin");
      ok("error" in again, "รอบเดียวกันเปิดซ้ำไม่ได้");
      const r3 = await applyWindowTransition(new Map([[orgId, st]]), [pmA.id]);
      ok(r3.closed === 0, "ตัวปรับกติกาไม่ไปปิดใบล่วงหน้า");
      // จำลองว่าถึงวันของรอบ: แผนชี้รอบ +7 อยู่แล้ว → ตัวเปิดรอบเห็นว่ามีใบ ไม่เปิดซ้ำ
      await prisma.pmSchedule.update({ where: { id: pmA.id, orgId }, data: { nextDueDate: today, anchorDate: today } });
      await prisma.workOrder.update({ where: { id: early.id, orgId }, data: { pmRoundDate: today } });
      const n1 = await prisma.workOrder.count({ where: { orgId, pmScheduleId: pmA.id, pmRoundDate: today } });
      await generateRoundWorkOrders(new Map([[orgId, st]]), [pmA.id]);
      const n2 = await prisma.workOrder.count({ where: { orgId, pmScheduleId: pmA.id, pmRoundDate: today } });
      ok(n1 === 1 && n2 === 1, "ถึงวันของรอบที่ทำล่วงหน้าแล้ว ระบบไม่เปิดซ้ำ");
    }

    // ---- 5 รอบแรก = วันนี้ ----
    const pmD = await mkPm("TPMW วันนี้", today, "monthly");
    await generateRoundWorkOrders(new Map([[orgId, st]]), [pmD.id]);
    const d1 = await prisma.workOrder.findFirst({ where: { orgId, pmScheduleId: pmD.id } });
    if (d1) woIds.push(d1.id);
    ok(!!d1 && ymd(d1.pmRoundDate!) === ymd(today) && d1.dueDate?.getTime() === roundDueAt(today, 14).getTime(), `รอบแรกวันนี้ → เปิดทันที กำหนดส่ง ${d1?.dueDate?.toISOString()}`);
    ok(!!d1?.description?.includes("ทำให้เสร็จภายใน"), `รายละเอียดใบ: ${d1?.description?.replace(/\n/g, " | ")}`);
  } finally {
    const all = await prisma.workOrder.findMany({ where: { orgId, OR: [{ id: { in: woIds } }, { pmScheduleId: { in: pmIds } }] }, select: { id: true } });
    const ids = all.map((w) => w.id);
    await prisma.notification.deleteMany({ where: { orgId, referenceId: { in: ids } } });
    await prisma.chatMessage.deleteMany({ where: { orgId, clientId: { in: ids.map((i) => `wo-${i}`) } } });
    await prisma.workOrderComment.deleteMany({ where: { orgId, workOrderId: { in: ids } } });
    await prisma.maintenanceActivity.deleteMany({ where: { orgId, entityId: { in: ids } } });
    await prisma.performanceEvent.deleteMany({ where: { orgId, refId: { startsWith: pmIds[0] ?? "none" } } });
    await prisma.workOrder.deleteMany({ where: { orgId, id: { in: ids } } }).catch((e) => console.log("ลบใบไม่ได้", String(e).slice(0, 200)));
    await prisma.pmSchedule.deleteMany({ where: { orgId, id: { in: pmIds } } });
    console.log(`ลบข้อมูลทดสอบ: ใบ ${ids.length} แผน ${pmIds.length}`);
    console.log(fail ? `${fail} FAIL` : "ALL PASS");
    process.exit(fail ? 1 : 0);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
