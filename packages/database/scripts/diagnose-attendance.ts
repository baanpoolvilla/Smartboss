import { PrismaClient } from "@prisma/client";

/**
 * อ่านอย่างเดียว — ทำไมคนนี้โดน "มาสาย/ขาดงาน" วันนั้น
 *
 * รายการหักลงเวลาแต่ละวันของคนหนึ่งคน + ผลคำนวณลงเวลาปัจจุบันของวันนั้น (กะ, เวลาเข้ากะ,
 * เวลาเข้าที่ระบบจับได้, นาทีที่สาย, คำนวณเมื่อไหร่) + การสแกนดิบทุกครั้งตั้งแต่ 00:00 ถึง
 * 23:59 ตามเวลาไทย (ช่องทาง, เจตนา IN/OUT, สถานะ) + คำขอแก้เวลาที่อนุมัติแล้ว
 *
 * รัน:
 *   sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a; \
 *     pnpm --filter @smartboss/database exec tsx scripts/diagnose-attendance.ts --user=soravee@baanpoolvilla.com'
 *   เลือกวันเดียวได้ด้วย --date=YYYY-MM-DD
 */

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const th = (d: Date | string | null) =>
  d
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(d))
    : "-";
const hm = (m: number | null) => (m == null ? "-" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

type ResultRow = {
  work_date: Date;
  shift_code: string | null;
  start_minutes: number | null;
  end_minutes: number | null;
  scheduled_in_at: Date | null;
  actual_in_at: Date | null;
  actual_out_at: Date | null;
  late_minutes: number;
  absence_minutes: number;
  is_on_leave: boolean;
  is_rest_day: boolean;
  is_holiday: boolean;
  calculated_at: Date;
  calculation_reason: string;
  result_version: number;
};
type EventRow = { captured_at: Date; event_intent: string; source_type: string; status: string; time_zone: string; received_at: Date };
type AdjRow = { adjustment_type: string; punch_at: Date | null; event_intent: string | null; status: string; reason: string };

async function main() {
  const who = arg("user");
  const onlyDate = arg("date");
  if (!who) {
    console.error("ต้องระบุ --user=<อีเมล>");
    process.exitCode = 1;
    return;
  }
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: { equals: who, mode: "insensitive" } }, { name: who }] },
    select: { id: true, name: true, orgId: true },
  });
  if (!user?.orgId) {
    console.error(`ไม่พบผู้ใช้ ${who}`);
    process.exitCode = 1;
    return;
  }

  const docks = await prisma.performanceEvent.findMany({
    where: {
      userId: user.id,
      source: "workforce",
      category: { in: ["attendance_late", "attendance_absent"] },
      refType: "attendance_day",
      ...(onlyDate
        ? { occurredAt: { gte: new Date(`${onlyDate}T00:00:00Z`), lte: new Date(`${onlyDate}T23:59:59Z`) } }
        : {}),
    },
    orderBy: { occurredAt: "asc" },
  });
  const corrections = await prisma.performanceEvent.findMany({
    where: { refType: "attendance_day_correction", refId: { in: docks.map((d) => d.id) } },
    select: { refId: true, note: true },
  });
  const corrected = new Map(corrections.map((c) => [c.refId, c.note]));

  const days = onlyDate ? [onlyDate] : [...new Set(docks.map((d) => d.occurredAt.toISOString().slice(0, 10)))];
  console.log(`\n${user.name} · หักลงเวลา ${docks.length} รายการ${onlyDate ? ` (วันที่ ${onlyDate})` : ""}`);
  if (days.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
    await tx.$executeRaw`SELECT set_config('workforce.tenant_id', ${user.orgId}, true)`;
    const emp = await tx.$queryRaw<{ id: string }[]>`
      SELECT e.id FROM workforce.principals p JOIN workforce.employments e ON e.person_id = p.person_id
      WHERE p.subject = ${user.id}
    `;
    const empIds = emp.map((e) => e.id);
    if (empIds.length === 0) {
      console.log("  ⚠ ไม่ได้ผูกกับทะเบียนพนักงาน");
      return;
    }

    for (const day of days) {
      const dayDocks = docks.filter((d) => d.occurredAt.toISOString().slice(0, 10) === day);
      console.log(`\n══ ${day} ══`);
      for (const d of dayDocks) {
        const label = d.category === "attendance_late" ? "มาสาย" : "ขาดงาน";
        const fix = corrected.get(d.id);
        console.log(`  หัก: ${label} ${Number(d.points)}${fix ? `  → คืนแล้ว (${fix})` : ""}`);
      }

      const results = await tx.$queryRaw<ResultRow[]>`
        SELECT ar.work_date, sd.code AS shift_code, sd.start_minutes, sd.end_minutes,
               ar.scheduled_in_at, ar.actual_in_at, ar.actual_out_at, ar.late_minutes, ar.absence_minutes,
               ar.is_on_leave, ar.is_rest_day, ar.is_holiday, ar.calculated_at, ar.calculation_reason, ar.result_version
        FROM workforce.attendance_results ar
        LEFT JOIN workforce.shift_definitions sd ON sd.id = ar.shift_id
        WHERE ar.employment_id = ANY(${empIds}::uuid[]) AND ar.work_date = ${day}::date AND ar.is_current
      `;
      for (const r of results) {
        console.log(
          `  ผลคำนวณ (v${r.result_version}, ${r.calculation_reason}, คำนวณ ${th(r.calculated_at)}): ` +
            `กะ ${r.shift_code ?? "ไม่มี"} ${hm(r.start_minutes)}-${hm(r.end_minutes)} · ` +
            `ต้องเข้า ${th(r.scheduled_in_at)} · เข้าจริง ${th(r.actual_in_at)} · ออก ${th(r.actual_out_at)} · ` +
            `สาย ${r.late_minutes} นาที · ขาด ${r.absence_minutes} นาที` +
            `${r.is_on_leave ? " · ลา" : ""}${r.is_rest_day ? " · วันหยุดกะ" : ""}${r.is_holiday ? " · วันหยุดบริษัท" : ""}`,
        );
      }
      if (results.length === 0) console.log("  ผลคำนวณ: ไม่มี");

      const events = await tx.$queryRaw<EventRow[]>`
        SELECT captured_at, event_intent, source_type, status, time_zone, received_at
        FROM workforce.raw_time_events
        WHERE employment_id = ANY(${empIds}::uuid[])
          AND captured_at >= (${day}::date - interval '1 day') + interval '17 hours'
          AND captured_at <  ${day}::date + interval '17 hours'
        ORDER BY captured_at
      `;
      console.log(`  สแกนวันนี้ (เวลาไทย) ${events.length} ครั้ง:`);
      for (const e of events) {
        console.log(
          `    ${th(e.captured_at)}  ${e.event_intent}  ${e.source_type}  ${e.status}  (tz ${e.time_zone}, ระบบรับ ${th(e.received_at)})`,
        );
      }

      const adjs = await tx.$queryRaw<AdjRow[]>`
        SELECT adjustment_type, punch_at, event_intent, status, reason
        FROM workforce.time_event_adjustments
        WHERE employment_id = ANY(${empIds}::uuid[]) AND work_date = ${day}::date
      `;
      for (const a of adjs) {
        console.log(`  คำขอแก้เวลา: ${a.adjustment_type} ${th(a.punch_at)} ${a.event_intent ?? ""} · ${a.status} · ${a.reason}`);
      }
    }
  });
}

main()
  .catch((err) => {
    console.error("[diagnose-attendance] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
