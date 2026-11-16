// วัดค่าใช้จ่ายต่อคำถามหลังลดข้อมูลที่ส่งให้ AI (13/11/2569)
process.env.TENANT_GUARD = "strict";
import { prisma } from "@smartboss/database";
import { askCompany } from "@/modules/report_task/lib/boss-brief/company-ai";
import { costThb } from "@/modules/report_task/lib/boss-brief/server";
(async () => {
  const org = (await prisma.organization.findMany({ orderBy: { createdAt: "asc" }, take: 1 }))[0]!;
  for (const model of ["gpt-6.1-terra"]) {
    for (const q of ["งานไหนเลยกำหนดแล้วบ้าง ขอ 3 อันที่สำคัญสุด พร้อมลิงก์ไปดู", "ภีมทำงานอะไรอยู่ ตามให้หน่อย"]) {
      const t0 = Date.now();
      const r = await askCompany({ orgId: org.id, question: q, model, brief: null, history: [], costOf: costThb });
      console.log(`\n### [${model}] ${q} · ฿${r.costThb.toFixed(2)} · ${Math.round((Date.now() - t0) / 1000)} วิ · ${r.tools.join(",")}\n${r.answer}`);
    }
  }
  await prisma.$disconnect();
  process.exit(0);
})();
