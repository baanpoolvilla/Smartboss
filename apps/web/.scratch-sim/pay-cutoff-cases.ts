/**
 * ทดสอบกรณีที่ข้อมูลบนเครื่องไม่มี — แก้ข้อมูล "บนเครื่อง" ชั่วคราวแล้วคืนสภาพทุกครั้ง (finally)
 * 1) บริษัทเรา: ลบแถวตั้งค่าเงินเดือนชั่วคราว (= ไม่เคยกดบันทึก) แต่ยังมีรอบ/คนตั้งเงินเดือน → ต้องได้ 25
 * 2) บริษัททดสอบใหม่: ตัดวันที่ 20 → 21–20 · ตัด 31 → ทั้งเดือน · ไม่มีอะไรเลย → ทั้งเดือน
 */
import { prisma } from "@smartboss/database";
import { loadPayCutoffDay, payPeriodRange } from "@/modules/hr/lib/attendance-export-data";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fail++; };

async function main() {
  const ours = (await prisma.organization.findMany({ select: { id: true, name: true } }))[0]!;

  // ---------- 1) บริษัทเรา ไม่มีแถวตั้งค่า ----------
  const backup = await prisma.$queryRaw<{ j: unknown }[]>`SELECT row_to_json(s) AS j FROM salary.settings s WHERE org_id = ${ours.id}::text`;
  const usage = await prisma.$queryRaw<{ runs: bigint; profiles: bigint }[]>`
    SELECT (SELECT count(*) FROM salary.runs WHERE org_id = ${ours.id}::text) AS runs,
           (SELECT count(*) FROM salary.profiles WHERE org_id = ${ours.id}::text) AS profiles`;
  console.log(`${ours.name}: แถวตั้งค่า=${backup.length} รอบเงินเดือน=${usage[0]!.runs} คนตั้งเงินเดือน=${usage[0]!.profiles}`);
  ok((await loadPayCutoffDay(ours.id)) === 25, "มีแถวตั้งค่า → 25");
  if (backup.length) {
    try {
      await prisma.$executeRaw`DELETE FROM salary.settings WHERE org_id = ${ours.id}::text`;
      const c = await loadPayCutoffDay(ours.id);
      ok(c === 25, `ไม่เคยกดบันทึกตั้งค่า แต่ใช้เงินเดือนอยู่ → ${c} (ต้องได้ 25 ตรงกับระบบเงินเดือน)`);
    } finally {
      await prisma.$executeRaw`INSERT INTO salary.settings SELECT * FROM json_populate_record(NULL::salary.settings, ${JSON.stringify(backup[0]!.j)}::json)`;
      const back = await prisma.$queryRaw<{ j: unknown }[]>`SELECT row_to_json(s) AS j FROM salary.settings s WHERE org_id = ${ours.id}::text`;
      ok(JSON.stringify(back[0]?.j) === JSON.stringify(backup[0]!.j), "คืนแถวตั้งค่าเดิมครบทุกช่อง");
    }
  }

  // ---------- 2) บริษัทอื่น ----------
  const org = await prisma.organization.create({ data: { code: `TESTPAY${Date.now()}`, slug: `testpay-${Date.now()}`, name: "บริษัททดสอบรอบเงินเดือน" } });
  try {
    ok((await loadPayCutoffDay(org.id)) === null, "บริษัทใหม่ ไม่มีข้อมูลเงินเดือน → ทั้งเดือน");
    await prisma.$executeRaw`INSERT INTO salary.settings (org_id, cutoff_day, updated_at) VALUES (${org.id}, 20, now())`;
    const c20 = await loadPayCutoffDay(org.id);
    const r = c20 === null ? null : payPeriodRange("2026-11", c20);
    ok(c20 === 20 && r?.from === "2026-10-21" && r?.to === "2026-11-20", `ตัดวันที่ 20 → ${r?.from} – ${r?.to}`);
    ok((await loadPayCutoffDay(ours.id)) === 25, "บริษัทเรายังได้ 25 (ไม่ปนกับบริษัทอื่น)");
    await prisma.$executeRaw`UPDATE salary.settings SET cutoff_day = 28 WHERE org_id = ${org.id}`;
    const c28 = await loadPayCutoffDay(org.id);
    const r28 = c28 === null ? null : payPeriodRange("2026-11", c28);
    ok(c28 === 28 && r28?.from === "2026-10-29" && r28?.to === "2026-11-28", `ตัดวันที่ 28 → ${r28?.from} – ${r28?.to}`);
    await prisma.$executeRaw`UPDATE salary.settings SET cutoff_day = 31 WHERE org_id = ${org.id}`;
    ok((await loadPayCutoffDay(org.id)) === null, "ตัดสิ้นเดือน (31) → ทั้งเดือน ไม่มีปุ่มสลับ");
  } finally {
    await prisma.$executeRaw`DELETE FROM salary.settings WHERE org_id = ${org.id}`;
    await prisma.organization.delete({ where: { id: org.id } });
    console.log("ลบบริษัททดสอบแล้ว");
  }
  console.log(fail ? `${fail} FAIL` : "ALL PASS");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
