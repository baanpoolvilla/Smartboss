// แยกข้อมูลบริษัท — สรุปให้ Boss + ถาม AI ทั้งบริษัท (13/11/2569)
// สร้างบริษัท B ชั่วคราว (มีผู้ใช้ 1 คน + สรุป 1 แถวที่ id ซ้ำกับของบริษัท A) แล้วตรวจว่า:
//  • เครื่องมือ AI ทุกตัวในนาม B ไม่เห็นข้อมูลของ A เลย (และในนาม A ไม่เห็นของ B)
//  • ตารางสรุป: id เดียวกันคนละบริษัทไม่ทับกัน อ่านได้เฉพาะของตัวเอง
//  • ทุก query ผ่านตัวกันแบบ strict (TENANT_GUARD=strict — ลืมกรอง orgId = พังทันที)
// ลบบริษัท B ทิ้งตอนจบ (cascade)
process.env.TENANT_GUARD = "strict";
import { prisma } from "@smartboss/database";
import { runCompanyToolForTest } from "@/modules/report_task/lib/boss-brief/company-ai";
import { listBriefs } from "@/modules/report_task/lib/boss-brief/server";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} | ${n}${x ? " | " + x : ""}`); };
const TOOLS: [string, Record<string, unknown>][] = [
  ["people", {}],
  ["search_reports", { from: "2026-01-01" }],
  ["count_mentions", { keyword: "HS2", from: "2024-01-01" }],
  ["report_summaries", { from: "2026-01-01" }],
  ["search_group_chat", { from: "2026-01-01" }],
  ["tasks", {}],
  ["work_orders", { from: "2026-01-01" }],
  ["purchases_expenses", { from: "2026-01-01" }],
  ["money_requests", { from: "2026-01-01" }],
  ["salary", {}],
  ["scores", { from: "2026-01-01" }],
];

(async () => {
  const orgA = (await prisma.organization.findMany({ where: { code: { not: "TENANT-AI-B" } }, select: { id: true, name: true }, orderBy: { createdAt: "asc" }, take: 1 }))[0]!;
  await prisma.organization.deleteMany({ where: { code: "TENANT-AI-B" } });
  const orgB = await prisma.organization.create({ data: { name: "บริษัททดสอบแยกข้อมูล", code: "TENANT-AI-B", slug: "tenant-ai-b" } });
  try {
    const userB = await prisma.user.create({ data: { orgId: orgB.id, email: `tenant-ai-b-${Date.now()}@example.com`, name: "คนของบริษัท B", passwordHash: "x" } });
    const aBrief = (await listBriefs(orgA.id, { isRange: false, take: 1 }))[0];
    const aBriefOk = !!aBrief;
    if (aBrief) {
      await prisma.reportBossBrief.create({
        data: { orgId: orgB.id, id: aBrief.id, topicId: aBrief.topicId, day: aBrief.day, isRange: false, generatedAt: new Date(), data: { ...aBrief, headline: "ของบริษัท B เท่านั้น", people: [], qa: [], items: { stuck: [], late: [], ask: [], done: [] }, detail: undefined } as never },
      });
    }
    // ตารางสรุป
    const aList = await listBriefs(orgA.id, { take: 500 });
    const bList = await listBriefs(orgB.id, { take: 500 });
    ok("ตารางสรุป: บริษัท B เห็นแค่แถวของตัวเอง", bList.length === (aBrief ? 1 : 0) && bList.every((b) => b.headline === "ของบริษัท B เท่านั้น"), `B ${bList.length} แถว`);
    ok("ตารางสรุป: บริษัท A ไม่เห็นแถวของ B (id ซ้ำกันได้ ไม่ทับกัน)", aList.every((b) => b.headline !== "ของบริษัท B เท่านั้น"), `A ${aList.length} แถว`);

    // เครื่องมือ AI ในนามบริษัท A vs B
    const aNames = (await prisma.user.findMany({ where: { orgId: orgA.id }, select: { name: true } })).map((u) => u.name).filter((n) => n && n.length >= 3);
    for (const [tool, args] of TOOLS) {
      let outA = "", outB = "";
      try { outA = await runCompanyToolForTest(orgA.id, tool, args); } catch (e) { ok(`${tool}: บริษัท A ผ่านตัวกันแบบ strict`, false, (e as Error).message.slice(0, 160)); continue; }
      try { outB = await runCompanyToolForTest(orgB.id, tool, args); } catch (e) { ok(`${tool}: บริษัท B ผ่านตัวกันแบบ strict`, false, (e as Error).message.slice(0, 160)); continue; }
      const leaked = aNames.filter((n) => outB.includes(n));
      ok(`${tool}: บริษัท B ไม่เห็นชื่อคนของบริษัท A`, leaked.length === 0, leaked.length ? `หลุด: ${leaked.slice(0, 3).join(", ")}` : `A ${outA.length} ตัวอักษร · B ${outB.length} ตัวอักษร`);
      if (tool === "report_summaries") ok("report_summaries: บริษัท B ได้แค่สรุปของตัวเอง", (!aBriefOk || outB.includes("ของบริษัท B เท่านั้น")) && !outA.includes("ของบริษัท B เท่านั้น"));
      if (tool === "people") ok("people: บริษัท B เห็นแค่คนของตัวเอง", outB.includes("คนของบริษัท B") && !outA.includes("คนของบริษัท B"));
    }
    void userB;
  } finally {
    await prisma.reportBossBrief.deleteMany({ where: { orgId: orgB.id } });
    await prisma.user.deleteMany({ where: { orgId: orgB.id } });
    await prisma.organization.delete({ where: { id: orgB.id } });
    console.log("ลบบริษัท B แล้ว");
  }
  console.log(`${pass} PASS / ${fail} FAIL`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error("CRASH", e); process.exit(1); });
