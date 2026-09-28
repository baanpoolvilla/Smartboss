import { PrismaClient } from "@prisma/client";

/**
 * อ่านอย่างเดียว — ตรวจว่าทำไมวันลา/Day-Off ของคนหนึ่งในวันหนึ่ง ไม่ถูกนับเป็น
 * วันยกเว้นการส่งรายงาน (ตัวหักคะแนนรายงานอ่านเฉพาะใบลา status = APPROVED และ
 * ต้องโยงกลับมาเป็น core.users.id ได้ผ่าน employments → principals.subject —
 * ดู apps/web/modules/report_task/lib/db/workforce-calendar.ts listLeaveEvents)
 *
 * รัน:
 *   sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a; \
 *     pnpm --filter @smartboss/database exec tsx scripts/diagnose-report-exemption.ts \
 *     --email=pacharapol@baanpoolvilla.com --date=2026-09-27'
 */

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

interface LeaveRow {
  id: string;
  starts_on: Date;
  ends_on: Date;
  status: string;
  leave_type: string | null;
  display_label: string | null;
  employment_id: string | null;
  subject: string | null;
}

async function main() {
  const email = arg("email");
  const date = arg("date");
  if (!email || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("ต้องระบุ --email=... --date=YYYY-MM-DD");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, name: true, orgId: true },
  });
  if (!user?.orgId) {
    console.log(`ไม่พบผู้ใช้ ${email} (หรือไม่สังกัดบริษัท)`);
    return;
  }
  console.log(`ผู้ใช้: ${user.name}  id=${user.id}  org=${user.orgId}\n`);

  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
    await tx.$executeRaw`SELECT set_config('workforce.tenant_id', ${user.orgId}, true)`;
    return tx.$queryRaw<LeaveRow[]>`
      SELECT lr.id, lr.starts_on, lr.ends_on, lr.status,
             lt.name AS leave_type, lr.display_label,
             lr.employment_id, p.subject
      FROM workforce.leave_requests lr
      LEFT JOIN workforce.employments e ON e.id = lr.employment_id
      LEFT JOIN workforce.principals  p ON p.person_id = e.person_id
      LEFT JOIN workforce.leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.starts_on <= ${date}::date AND lr.ends_on >= ${date}::date
      ORDER BY lr.status, lr.starts_on
    `;
  });

  console.log(`ใบลาทั้งบริษัทที่ครอบวันที่ ${date}: ${rows.length} ใบ\n`);
  const d = (x: Date) => new Date(x).toISOString().slice(0, 10);
  for (const r of rows) {
    const mine = r.subject === user.id;
    const label = (r.display_label ?? "").trim() || r.leave_type || "-";
    const verdict =
      r.status !== "APPROVED"
        ? "✗ ยังไม่อนุมัติ — ไม่นับเป็นวันยกเว้น"
        : r.subject === null
          ? "✗ โยงกลับเป็นบัญชี SmartBoss ไม่ได้ (principal ไม่มี subject)"
          : mine
            ? "✓ ยกเว้นให้คนนี้ได้"
            : "- ของคนอื่น";
    console.log(
      `${mine ? "→" : " "} ${label}  ${d(r.starts_on)}..${d(r.ends_on)}  status=${r.status}  subject=${r.subject ?? "null"}  ${verdict}`,
    );
  }
  if (!rows.some((r) => r.subject === user.id)) {
    console.log(`\n⚠ ไม่มีใบลาไหนโยงกับบัญชีนี้ (id=${user.id}) เลยในวันนั้น`);
  }

  // ตัวหักคะแนนรายงานดูเฉพาะวันที่ >= enabledSince (วันที่เปิดสวิตช์ครั้งล่าสุด)
  // ทั้งตอนหักและตอนคืน — ถ้าวันที่ที่ถามเก่ากว่านี้ จะไม่ถูกแตะอีกเลย
  const stores = await prisma.reportTaskStore.findMany({
    where: { orgId: user.orgId, key: { in: ["report-penalty-enabled-since", "report-penalty-settings"] } },
    select: { key: true, data: true, updatedAt: true },
  });
  console.log("\nตั้งค่าหักคะแนนรายงาน:");
  for (const s of stores) {
    console.log(`  ${s.key} = ${JSON.stringify(s.data)}  (แก้ล่าสุด ${s.updatedAt.toISOString()})`);
  }
  const since = stores.find((s) => s.key === "report-penalty-enabled-since")?.data;
  if (typeof since === "string" && since > date) {
    console.log(`  ⚠ enabledSince (${since}) ใหม่กว่าวันที่ ${date} — ตัวหักคะแนนจะไม่หักและไม่คืนของวันนี้อีกแล้ว`);
  }

  const events = await prisma.performanceEvent.findMany({
    where: {
      orgId: user.orgId,
      userId: user.id,
      source: "report_task",
      refId: { startsWith: `${date}:` },
    },
    select: { category: true, refType: true, refId: true, points: true, note: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\nคะแนนรายงานของคนนี้วันที่ ${date}: ${events.length} รายการ`);
  for (const e of events) {
    console.log(
      `  ${e.createdAt.toISOString()}  ${e.refType}  ${e.category}  ${Number(e.points)}  ${e.refId}${e.note ? `  (${e.note})` : ""}`,
    );
  }
}

main()
  .catch((err) => {
    console.error("[diagnose-report-exemption] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
