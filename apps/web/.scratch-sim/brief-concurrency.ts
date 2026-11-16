// ถามพร้อมกัน 3 คำถามตอนเงินเหลือน้อย → ยอดรวมต้องไม่เกินเพดาน (13/11/2569) · คืนค่าเดิมตอนจบ
process.env.TENANT_GUARD = "strict";
import { prisma } from "@smartboss/database";
import { askAssistant } from "@/modules/report_task/lib/boss-brief/assistant";

const KEYS = ["boss-brief-settings", "boss-brief-usage"];
(async () => {
  const org = (await prisma.organization.findMany({ where: { code: { not: "TENANT-AI-B" } }, orderBy: { createdAt: "asc" }, take: 1 }))[0]!;
  const orgId = org.id;
  const [ceo] = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT u.id FROM core.users u JOIN core.user_roles ur ON ur.user_id=u.id JOIN core.roles r ON r.id=ur.role_id WHERE r.code='CEO' AND u.is_active AND u.org_id=$1 LIMIT 1`, orgId);
  const backup = Object.fromEntries(await Promise.all(KEYS.map(async (k) => [k, await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: k } } })])));
  const month = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
  const usage = async () => (((await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "boss-brief-usage" } } }))?.data as Record<string, { thb: number }> | undefined)?.[month]?.thb ?? 0);
  let fails = 0;
  try {
    const u0 = await usage();
    const cap = Math.round((u0 + 1.0) * 100) / 100; // เหลือ ฿1.00 — พอแค่ราว 1 คำถาม
    const s = { ...((backup["boss-brief-settings"]?.data as object) ?? {}), enabled: false, topicIds: [], modelVersion: 2, detailModel: "gpt-6.1-terra", askModel: "gpt-6.1-terra", monthlyCapThb: cap };
    const cur = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "boss-brief-settings" } } });
    if (cur) await prisma.reportTaskStore.update({ where: { orgId_key: { orgId, key: "boss-brief-settings" } }, data: { data: s as never, version: cur.version + 1 } });
    else await prisma.reportTaskStore.create({ data: { orgId, key: "boss-brief-settings", data: s as never, version: 1 } });
    // เพดานคุมทั้งเดือน — ใช้เลขทศนิยมไม่ได้ในช่องตั้งค่า แต่ฟังก์ชันรับได้ (ทดสอบตรง ๆ)
    const qs = ["งานไหนเลยกำหนดแล้วบ้าง", "เดือนนี้ค่าซ่อมรวมเท่าไร", "ใครลาเยอะสุดเดือนนี้"];
    const t0 = Date.now();
    const rs = await Promise.all(qs.map((q) => askAssistant(orgId, ceo!.id, q, "/", [])));
    const u1 = await usage();
    const okCount = rs.filter((r) => r.ok).length;
    console.log(rs.map((r, i) => `${qs[i]} → ${r.ok ? "ตอบ" : "ปฏิเสธ: " + r.error}`).join("\n"));
    const over = u1 - cap;
    const pass = u1 <= cap + 0.01;
    if (!pass) fails++;
    console.log(`${pass ? "PASS" : "FAIL"} | ถามพร้อมกัน 3 อัน เหลือเงิน ฿1.00 → ตอบ ${okCount} อัน · ใช้ ฿${(u1 - u0).toFixed(2)} · ${over > 0 ? `เกินเพดาน ฿${over.toFixed(2)}` : "ไม่เกินเพดาน"} · ${Math.round((Date.now() - t0) / 1000)} วิ`);
  } finally {
    for (const k of KEYS) {
      const b = backup[k];
      const cur = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: k } } });
      if (b) await prisma.reportTaskStore.update({ where: { orgId_key: { orgId, key: k } }, data: { data: b.data as never, version: (cur?.version ?? 0) + 1 } });
      else if (cur) await prisma.reportTaskStore.delete({ where: { orgId_key: { orgId, key: k } } });
    }
    await prisma.reportTaskStore.deleteMany({ where: { orgId, key: `ai-assistant:${ceo!.id}` } });
    console.log("คืนค่าแล้ว");
  }
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(1); });
