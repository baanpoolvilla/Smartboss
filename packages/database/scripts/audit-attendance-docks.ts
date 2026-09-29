import { PrismaClient } from "@prisma/client";

/**
 * อ่านอย่างเดียว — "มาสายแต่ไม่โดนหักคะแนน" เพราะอะไร ไล่ทุกคนทุกวัน
 *
 * ไล่จากฝั่งผลลงเวลา (workforce.attendance_results) ทุกวันที่สาย/ขาดงาน แล้วบอกว่าวันนั้น
 * ถูกหักคะแนนแล้วหรือยัง ถ้ายัง เพราะอะไร — กลับทางกับ diagnose-attendance.ts ที่เริ่มจาก
 * รายการที่หักไปแล้ว (มองไม่เห็นวันที่ไม่เคยถูกหักเลย)
 *
 * เหตุผลที่เป็นไปได้ (ตรงกับเงื่อนไขของ cron dockAttendance + workforce.performance_attendance):
 *   ไม่ได้ผูกผู้ใช้    ทะเบียนพนักงานไม่ได้จับคู่กับบัญชี Smartboss (wf:sync จับคู่ด้วยอีเมล)
 *                     ⇒ ฟังก์ชันคืนแถวให้เฉพาะคนที่ผูกแล้ว คนนี้ถูกข้ามเงียบ ๆ ทุกวัน
 *   ต่ำกว่าเกณฑ์       สายไม่เกินเกณฑ์ของบริษัท (late_minutes หักเวลาผ่อนผันของกะออกแล้ว)
 *   ก่อนวันเริ่มนับ     ก่อน performance_settings.scoring_start_date
 *   ระบบคะแนนปิด      performance_settings.enabled = false
 *   ยังไม่ถึงรอบ       วันนี้/เมื่อวานที่ cron ยังไม่ได้เก็บ (cron เก็บวันที่จบแล้วเท่านั้น)
 *   ยังไม่คำนวณผล     มีสแกนแต่ไม่มีผลลงเวลาของวันนั้นเลย — ผลลงเวลาถูกคำนวณเฉพาะตอนมีคนเปิด
 *                     แท็บ "วันนี้" ที่ /hr (ย้อน 30 วัน) ไม่มี cron คำนวณให้ ⇒ ถ้าไม่มีใครเปิด
 *                     วันนั้นไม่มีทั้งสาย/ขาด ให้หัก (ส่วนนี้แยกแสดงต่างหาก เพราะไม่มีแถวผลให้ไล่)
 *   ❌ ควรหักแต่ไม่มี   ผ่านทุกเงื่อนไขแต่ไม่มีรายการหัก — cron ไม่ได้รัน หรือมีบั๊ก
 *
 * รัน:
 *   sudo -u smartboss bash -c 'cd /opt/smartboss && set -a && . /etc/smartboss/smartboss.env && set +a && \
 *     pnpm --filter @smartboss/database exec tsx scripts/audit-attendance-docks.ts'
 *   --days=30 (ค่าเริ่มต้น) ย้อนดูกี่วัน · --all แสดงทุกวันรวมที่หักแล้ว (ปกติแสดงเฉพาะที่ไม่ได้หัก)
 */

const prisma = new PrismaClient();
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const showAll = process.argv.includes("--all");
const days = Number(arg("days") ?? 30);
const ABSENCE_THRESHOLD_MINUTES = 240; // ตรงกับ lib/performance.ts

type Row = {
  employment_id: string;
  employee_code: string;
  name: string;
  person_email: string | null;
  subject: string | null;
  work_date: Date;
  late_minutes: number;
  absence_minutes: number;
  missing_punch: boolean;
};

const todayTh = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

async function main() {
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  // cron ยังรันอยู่ไหม — ดูจากรายการหักลงเวลาล่าสุดที่ระบบสร้าง
  const lastDock = await prisma.performanceEvent.findFirst({
    where: { source: "workforce", refType: "attendance_day" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const lastTh = lastDock
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }).format(lastDock.createdAt)
    : "ไม่เคยมีเลย";
  const staleDays = lastDock ? Math.floor((Date.now() - lastDock.createdAt.getTime()) / 86400_000) : Infinity;
  console.log(`รายการหักลงเวลาล่าสุดที่ cron สร้าง: ${lastTh}${staleDays >= 2 ? `  ⚠ ผ่านมา ${staleDays} วันแล้ว — cron performance อาจไม่ได้รัน` : ""}`);
  console.log(`ย้อนดู ${days} วัน (ตั้งแต่ ${from}) · วันนี้ ${todayTh}\n`);

  const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  for (const org of orgs) {
    const st = await prisma.performanceSetting.findUnique({ where: { orgId: org.id } });
    const enabled = st?.enabled ?? true;
    const lateThreshold = st?.lateThresholdMinutes ?? 0;
    const startDay = st?.scoringStartDate ? st.scoringStartDate.toISOString().slice(0, 10) : null;
    const missingAbsent = st?.missingPunchCountsAsAbsent ?? false;

    const { rows, lastCalc, uncalculated } = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
      await tx.$executeRaw`SELECT set_config('workforce.tenant_id', ${org.id}, true)`;
      const lastCalc = await tx.$queryRaw<{ at: Date | null }[]>`SELECT max(calculated_at) AS at FROM workforce.attendance_results`;
      // วันที่มีสแกนเข้ามา แต่ไม่มีผลลงเวลา (ฉบับปัจจุบัน) ของวันนั้นเลย — ยังไม่เคยถูกคำนวณ
      const uncalculated = await tx.$queryRaw<{ name: string; day: string }[]>`
        SELECT trim(p.first_name || ' ' || p.last_name) AS name, to_char(d.day, 'YYYY-MM-DD') AS day
        FROM (
          SELECT DISTINCT r.employment_id, (r.captured_at AT TIME ZONE 'Asia/Bangkok')::date AS day
          FROM workforce.raw_time_events r
          WHERE r.captured_at >= ${from}::date
        ) d
        JOIN workforce.employments e ON e.id = d.employment_id
        JOIN workforce.people p ON p.id = e.person_id
        WHERE d.day < ${todayTh}::date
          AND NOT EXISTS (
            SELECT 1 FROM workforce.attendance_results ar
            WHERE ar.employment_id = d.employment_id AND ar.work_date = d.day AND ar.is_current
          )
        ORDER BY d.day, name
      `;
      const rows = await tx.$queryRaw<Row[]>`
        SELECT e.id AS employment_id, e.employee_code,
               trim(p.first_name || ' ' || p.last_name || CASE WHEN p.preferred_name <> '' THEN ' (' || p.preferred_name || ')' ELSE '' END) AS name,
               p.email AS person_email,
               pr.subject,
               ar.work_date, ar.late_minutes, ar.absence_minutes,
               (ar.actual_in_at IS NULL) <> (ar.actual_out_at IS NULL) AS missing_punch
        FROM workforce.attendance_results ar
        JOIN workforce.employments e ON e.id = ar.employment_id
        JOIN workforce.people p ON p.id = e.person_id
        LEFT JOIN workforce.principals pr ON pr.person_id = e.person_id
        WHERE ar.is_current
          AND ar.work_date >= ${from}::date
          AND ar.is_on_leave = false AND ar.is_holiday = false AND ar.is_rest_day = false
          AND (ar.late_minutes > 0 OR ar.absence_minutes > ${ABSENCE_THRESHOLD_MINUTES})
        ORDER BY name, ar.work_date
      `;
      return { rows, lastCalc: lastCalc[0]?.at ?? null, uncalculated };
    });

    const lastCalcTh = lastCalc
      ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }).format(lastCalc)
      : "ไม่เคยเลย";
    const calcStale = lastCalc ? Math.floor((Date.now() - lastCalc.getTime()) / 86400_000) : Infinity;
    console.log(`══ ${org.name} ══`);
    console.log(`  คำนวณผลลงเวลาล่าสุด: ${lastCalcTh}${calcStale >= 2 ? `  ⚠ ผ่านมา ${calcStale} วัน — ผลลงเวลาคำนวณเฉพาะตอนมีคนเปิดแท็บ "วันนี้" ที่ /hr` : ""}`);
    if (uncalculated.length > 0) {
      console.log(`  ⚠ มีสแกนแต่ยังไม่มีผลลงเวลา ${uncalculated.length} วัน-คน (ไม่มีทางถูกหักจนกว่าจะคำนวณ):`);
      for (const u of uncalculated.slice(0, 40)) console.log(`    ${u.day}  ${u.name}`);
      if (uncalculated.length > 40) console.log(`    … อีก ${uncalculated.length - 40} รายการ`);
    }
    if (rows.length === 0) {
      console.log("");
      continue;
    }

    const refIds = rows.filter((r) => r.subject).map((r) => `${r.subject}:${r.work_date.toISOString().slice(0, 10)}`);
    const docks = await prisma.performanceEvent.findMany({
      where: { orgId: org.id, source: "workforce", refType: "attendance_day", refId: { in: refIds } },
      select: { id: true, refId: true, category: true },
    });
    const fixes = await prisma.performanceEvent.findMany({
      where: { refType: "attendance_day_correction", refId: { in: docks.map((d) => d.id) } },
      select: { refId: true, note: true },
    });
    const fixedIds = new Map(fixes.map((f) => [f.refId, f.note]));
    const dockByRef = new Map(docks.map((d) => [d.refId, d]));
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.subject).filter((s): s is string => !!s))] } },
      select: { id: true, orgId: true },
    });
    const userOrg = new Map(users.map((u) => [u.id, u.orgId]));

    const tally = new Map<string, number>();
    const lines: string[] = [];
    const unlinked = new Map<string, string>();
    for (const r of rows) {
      const day = r.work_date.toISOString().slice(0, 10);
      const absent = Number(r.absence_minutes) > ABSENCE_THRESHOLD_MINUTES && (!r.missing_punch || missingAbsent);
      const what = absent ? `ขาด ${Math.round(Number(r.absence_minutes) / 60)} ชม.` : `สาย ${r.late_minutes} นาที`;
      let status: string;
      if (!r.subject) {
        status = "ไม่ได้ผูกผู้ใช้";
        unlinked.set(r.employment_id, `${r.name} [${r.employee_code}] อีเมลในทะเบียน: ${r.person_email ?? "ไม่มี"}`);
      } else if (userOrg.get(r.subject) !== org.id) status = "ผูกกับบัญชีที่ไม่มีอยู่/คนละบริษัท";
      else if (!enabled) status = "ระบบคะแนนปิด";
      else if (startDay && day < startDay) status = "ก่อนวันเริ่มนับ";
      else if (day >= todayTh) status = "ยังไม่ถึงรอบ (วันนี้)";
      else if (!absent && Number(r.late_minutes) <= lateThreshold) status = "ต่ำกว่าเกณฑ์";
      else {
        const d = dockByRef.get(`${r.subject}:${day}`);
        if (!d) status = "❌ ควรหักแต่ไม่มี";
        else if (fixedIds.has(d.id)) status = `หักแล้ว·คืนแล้ว (${fixedIds.get(d.id)})`;
        else status = "หักแล้ว";
      }
      const key = status.startsWith("หักแล้ว·คืนแล้ว") ? "หักแล้ว·คืนแล้ว" : status;
      tally.set(key, (tally.get(key) ?? 0) + 1);
      if (showAll || !status.startsWith("หักแล้ว")) lines.push(`  ${day}  ${r.name.padEnd(28)} ${what.padEnd(14)} ${status}`);
    }

    console.log(`  ระบบคะแนน ${enabled ? "เปิด" : "ปิด"} · เกณฑ์สาย > ${lateThreshold} นาที · เริ่มนับ ${startDay ?? "ทั้งหมด"}`);
    console.log("  สรุป: " + [...tally.entries()].map(([k, v]) => `${k} ${v}`).join(" · "));
    if (unlinked.size > 0) {
      console.log(`\n  ⚠ ทะเบียนพนักงานที่ยังไม่ผูกกับบัญชี Smartboss (${unlinked.size} คน) — มาสาย/ขาดงานกี่วันก็ไม่ถูกหัก:`);
      for (const u of unlinked.values()) console.log(`    ${u}`);
    }
    if (lines.length > 0) {
      console.log(`\n  รายวัน${showAll ? "" : " (เฉพาะที่ไม่ได้หัก — เติม --all เพื่อดูทั้งหมด)"}:`);
      console.log(lines.join("\n"));
    }
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
