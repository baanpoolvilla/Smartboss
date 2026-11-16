import { prisma } from "@smartboss/database";
import { loadPayCutoffDay, payPeriodRange } from "@/modules/hr/lib/attendance-export-data";

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  for (const o of orgs) {
    const c = await loadPayCutoffDay(o.id);
    const r = c === null ? "ทั้งเดือน 1 – สิ้นเดือน" : `${payPeriodRange("2026-11", c).from} → ${payPeriodRange("2026-11", c).to}`;
    console.log(`${o.name.padEnd(30)} cutoff=${c}  พ.ย. 2569 = ${r}`);
  }
  const fake = await loadPayCutoffDay("00000000-0000-0000-0000-00000000dead");
  console.log("บริษัทที่ไม่มีข้อมูลเงินเดือนเลย →", fake === null ? "ทั้งเดือน (PASS)" : `FAIL ${fake}`);
  const r12 = payPeriodRange("2027-01", 25);
  console.log("ข้ามปี ม.ค. 2570 →", r12.from, r12.to, r12.from === "2026-12-26" && r12.to === "2027-01-25" ? "PASS" : "FAIL");
  const r2 = payPeriodRange("2026-03", 30);
  console.log("ตัด 30 เดือน มี.ค. →", r2.from, r2.to);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
