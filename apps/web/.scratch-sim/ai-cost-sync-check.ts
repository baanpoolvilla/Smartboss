// ยอดจริงจาก OpenAI (จำลอง Costs API) — ดึงหลายหน้า รวมยอด เก็บไว้ · เพดานยึดค่าที่สูงกว่า · คืนค่าเดิมตอนจบ
process.env.TENANT_GUARD = "strict";
process.env.OPENAI_ADMIN_KEY = "sk-admin-test";
process.env.OPENAI_BRIEF_PROJECT_ID = "proj_test123";
import { prisma } from "@smartboss/database";
import { syncActualCost } from "@/modules/report_task/lib/boss-brief/ai-billing";
import { readUsage } from "@/modules/report_task/lib/boss-brief/server";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} | ${n}${x ? " | " + x : ""}`); };

(async () => {
  const org = (await prisma.organization.findMany({ where: { code: { not: "TENANT-AI-B" } }, orderBy: { createdAt: "asc" }, take: 1 }))[0]!;
  const orgId = org.id;
  const before = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId, key: "ai-billing-actual" } } });
  const month = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push(url);
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    if (auth !== "Bearer sk-admin-test") return new Response("no", { status: 401 });
    const page2 = url.includes("page=p2");
    const body = page2
      ? { data: [{ results: [{ amount: { value: 0.05, currency: "usd" } }] }], has_more: false, next_page: null }
      : { data: [{ results: [{ amount: { value: 0.4, currency: "usd" } }] }, { results: [{ amount: { value: 0.25, currency: "usd" } }] }], has_more: true, next_page: "p2" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const a = await syncActualCost(orgId);
    globalThis.fetch = realFetch;
    ok("ดึงยอดจริง 2 หน้า รวมถูก ($0.70)", !!a && Math.abs(a.usd - 0.7) < 1e-9, a ? `$${a.usd}` : "null");
    ok("ส่ง projectId + ต้นเดือน + รายวัน", seen[0]!.includes("project_ids=proj_test123") && seen[0]!.includes("bucket_width=1d") && seen[0]!.includes("start_time="));
    const u = await readUsage(orgId, month);
    ok("เพดานยึดค่าที่สูงกว่า", u.thb === Math.max(u.trackedThb ?? 0, 0.7 * 36), `นับเอง ฿${(u.trackedThb ?? 0).toFixed(2)} · จริง ฿${(0.7 * 36).toFixed(2)} → ใช้ ฿${u.thb.toFixed(2)}`);
    process.env.OPENAI_ADMIN_KEY = "";
    ok("ไม่มี admin key → ข้ามเงียบ ๆ", (await syncActualCost(orgId)) === null);
  } finally {
    globalThis.fetch = realFetch;
    if (before) await prisma.reportTaskStore.update({ where: { orgId_key: { orgId, key: "ai-billing-actual" } }, data: { data: before.data as never, version: { increment: 1 } } });
    else await prisma.reportTaskStore.deleteMany({ where: { orgId, key: "ai-billing-actual" } });
  }
  console.log(`${pass} PASS / ${fail} FAIL`);
  await prisma.$disconnect();
  process.exit(0);
})();
