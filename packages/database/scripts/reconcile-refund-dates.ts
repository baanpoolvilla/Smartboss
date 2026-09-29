import { PrismaClient } from "@prisma/client";

/**
 * ย้ายวันที่ของ "การคืนคะแนน" ให้ตรงกับวันที่ของรายการที่ถูกหัก — ทุกหมวด ทุกบริษัท
 *
 * ปัญหา: การคืนคะแนน 3 ทางเคยบันทึก occurredAt เป็น "วันที่กดคืน" แทนวันที่หัก
 *   - report_round_undo จาก sweep รายงาน (ส่งช้าหลังโดน "ไม่ส่ง" / วันลา/หยุดใส่ทีหลัง)
 *   - report_round_undo จากการอนุมัติคำร้องขอแก้ไขคะแนน
 *   - report_post_reaction_undo (เอาสติกเกอร์บนโพสต์รายงานออก)
 * คะแนนนับตามเดือนของ occurredAt ⇒ หักเดือน ส.ค. คืนเดือน ก.ย. = ส.ค. ยังติดลบค้าง ส่วน ก.ย.
 * ได้ +คะแนนลอย ๆ ขึ้นเป็นแถว "0 ครั้ง +2" (โค้ดแก้แล้ว สคริปต์นี้ซ่อมของเก่า)
 * แบบเดียวกับที่ reconcile-wrong-attendance-events.ts เคยซ่อมฝั่งลงเวลา
 *
 * จับคู่: `<refType>_undo` ↔ รายการเดิม (หมวดเดียวกัน refType ไม่มี _undo, refId เดียวกัน)
 *         `<refType>_correction` ↔ รายการเดิมที่ id = refId
 * แตะแค่ occurredAt ของรายการคืนคะแนน — ยอดแต้มไม่เปลี่ยน รันซ้ำได้ (ครั้งที่สองไม่มีอะไรต้องย้าย)
 *
 * ⚠ ย้ายแล้วคะแนนของ "เดือนที่หัก" จะดีขึ้น และเดือนที่เคยได้ +ลอย ๆ จะลดลงเท่ากัน —
 * ถ้าเดือนไหนปิดยอดค่าคอม/เกรดไปแล้ว ตัวเลขย้อนหลังของเดือนนั้นจะเปลี่ยน ดู preview ก่อน
 *
 * รัน (บนเซิร์ฟเวอร์ source env ก่อนเหมือนตอนรัน db:deploy):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/reconcile-refund-dates.ts --dry-run
 *   ตัด --dry-run ออกเพื่อเขียนจริง · เติม --org=<orgId> เพื่อจำกัดบริษัทเดียว
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const orgArg = process.argv.find((a) => a.startsWith("--org="))?.slice("--org=".length);

const day = (d: Date) => d.toISOString().slice(0, 10);
const month = (d: Date) => d.toISOString().slice(0, 7);

async function main() {
  const refunds = await prisma.performanceEvent.findMany({
    where: {
      ...(orgArg ? { orgId: orgArg } : {}),
      OR: [{ refType: { endsWith: "_undo" } }, { refType: { endsWith: "_correction" } }],
    },
    select: { id: true, orgId: true, userId: true, category: true, refType: true, refId: true, occurredAt: true, points: true, note: true },
  });
  if (refunds.length === 0) {
    console.log("ไม่มีรายการคืนคะแนนเลย");
    return;
  }

  const originals = await prisma.performanceEvent.findMany({
    where: {
      ...(orgArg ? { orgId: orgArg } : {}),
      OR: [
        { id: { in: refunds.filter((r) => r.refType!.endsWith("_correction")).map((r) => r.refId!).filter(Boolean) } },
        { refId: { in: refunds.filter((r) => r.refType!.endsWith("_undo")).map((r) => r.refId!).filter(Boolean) } },
      ],
    },
    select: { id: true, orgId: true, category: true, refType: true, refId: true, occurredAt: true },
  });
  const byId = new Map(originals.map((o) => [o.id, o]));
  const byRef = new Map(originals.map((o) => [`${o.orgId}|${o.category}|${o.refType}|${o.refId}`, o]));

  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const moves: { id: string; to: Date; line: string }[] = [];
  const orphans: string[] = [];
  for (const r of refunds) {
    const original = r.refType!.endsWith("_undo")
      ? byRef.get(`${r.orgId}|${r.category}|${r.refType!.slice(0, -"_undo".length)}|${r.refId}`)
      : byId.get(r.refId ?? "");
    const who = nameOf.get(r.userId) ?? r.userId;
    if (!original) {
      orphans.push(`  ${day(r.occurredAt)}  ${who}  ${r.category} ${Number(r.points)}  ${r.refType} ${r.refId}  ${r.note ?? ""}`);
      continue;
    }
    if (original.occurredAt.getTime() === r.occurredAt.getTime()) continue;
    const crossMonth = month(original.occurredAt) !== month(r.occurredAt) ? "  ⚠ ข้ามเดือน" : "";
    moves.push({
      id: r.id,
      to: original.occurredAt,
      line: `  ${who}  ${r.category} ${Number(r.points) > 0 ? "+" : ""}${Number(r.points)}  ${day(r.occurredAt)} → ${day(original.occurredAt)}${crossMonth}  ${r.note ?? ""}`,
    });
  }

  console.log(`รายการคืนคะแนนทั้งหมด ${refunds.length} · ต้องย้ายวันที่ ${moves.length} · ข้ามเดือน ${moves.filter((m) => m.line.includes("ข้ามเดือน")).length}`);
  if (moves.length > 0) console.log(moves.map((m) => m.line).join("\n"));
  if (orphans.length > 0) {
    console.log(`\nคืนคะแนนที่หารายการเดิมไม่เจอ ${orphans.length} รายการ (ไม่แตะ — ดูเองว่าควรมีอยู่ไหม):`);
    console.log(orphans.join("\n"));
  }

  if (dryRun || moves.length === 0) {
    if (dryRun) console.log("\n(--dry-run: ยังไม่ได้เขียนอะไร)");
    return;
  }
  for (const m of moves) {
    await prisma.performanceEvent.update({ where: { id: m.id }, data: { occurredAt: m.to } });
  }
  console.log(`\nย้ายวันที่แล้ว ${moves.length} รายการ`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
