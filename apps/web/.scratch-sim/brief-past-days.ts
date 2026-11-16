// สร้างสรุปของวันก่อนหน้าให้ห้องทดสอบ (เดินรอบตรวจด้วยเวลา 23:00 ของวันนั้น) — ใช้ทดสอบ "วันอื่นๆ ของคนนี้" / เลือกวัน
import { prisma } from "@smartboss/database";
import { runBossBriefSweep } from "@/modules/report_task/lib/boss-brief/server";
(async () => {
  const [org] = await prisma.organization.findMany({ select: { id: true } });
  const back = (process.argv[2] ?? "1,2,3").split(",").map(Number);
  for (const n of back) {
    const day = new Date(Date.now() + 7 * 3600e3 - n * 86_400_000).toISOString().slice(0, 10);
    const r = await runBossBriefSweep(org!.id, new Date(`${day}T23:00:00+07:00`));
    console.log(day, JSON.stringify(r));
  }
  await prisma.$disconnect();
})();
