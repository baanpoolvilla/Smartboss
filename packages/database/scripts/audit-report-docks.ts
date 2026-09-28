import { PrismaClient } from "@prisma/client";
// วันหยุดราชการไทยชุดเดียวกับที่แอปใช้ (import type ในไฟล์นั้นถูกตัดทิ้งตอนรัน)
import { thaiHolidayEvents } from "../../../apps/web/modules/report_task/data/thai-holidays";

/**
 * อ่านอย่างเดียว — ไล่คะแนนหักรายงาน (report_missed / report_late) ที่ยัง active อยู่
 * ของ **ทุกคน** แล้วเทียบกับโพสต์จริงและวันลา หารายการที่น่าจะหักผิด:
 *
 *   ✗ "ไม่ส่ง" แต่มีโพสต์ของรอบนั้นในวันนั้น
 *   ✗ "ส่งสาย" แต่มีโพสต์ของรอบนั้นที่ส่งทันเวลา (หรือซ่อนป้ายสายไว้)
 *   ✗ วันนั้นเป็นวันหยุด/วันลาของคนนั้น (รอบรายวันเท่านั้น — รอบรายสัปดาห์/รายเดือน
 *     ไม่ยกเว้นให้วันหยุดโดยตั้งใจ ตามกติกาของแอป) ครอบคลุม: วันลาทุกประเภทที่อนุมัติแล้ว
 *     ในระบบบุคคล (ยกเว้นประเภท "ยังต้องส่งรายงาน" เช่น WFH), วันหยุดบริษัทในระบบ
 *     บุคคล, วันหยุดราชการ, และ "วันหยุดประจำ" ที่ตั้งไว้ในโมดูลรายงาน
 *   ? "ส่งสาย" แต่ไม่มีโพสต์รอบนั้นเลย (ควรเป็น "ไม่ส่ง" — ไม่ใช่หักเกิน แค่ผิดหมวด)
 *
 * จับคู่โพสต์กับรอบแบบเดียวกับแอป (apps/web/modules/report_task/lib/submission-rounds.ts
 * attributePostToRound): ใช้ roundId ที่ติดมากับโพสต์ถ้ามี ไม่งั้นรอบแรกที่เวลา >= เวลา
 * โพสต์ในบรรดารอบที่วิ่งวันนั้น — เวลาอ่านตามนาฬิกาเครื่อง (เซิร์ฟเวอร์ = Asia/Bangkok)
 *
 * รัน:
 *   sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a; \
 *     pnpm --filter @smartboss/database exec tsx scripts/audit-report-docks.ts [--days=45]'
 */

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

type Round = { id: string; label: string; time: string; weekdays?: number[]; dayOfMonth?: number };
type Topic = { id: string; name: string; submissionRounds?: Round[] };
type Post = { id: string; topicId: string; authorId: string; createdAt: string; roundId?: string; lateBadgeHidden?: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

function runsOnDay(r: Round, day: string): boolean {
  const d = new Date(`${day}T00:00:00`);
  if (r.dayOfMonth) {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === Math.min(r.dayOfMonth, last);
  }
  if (r.weekdays && r.weekdays.length > 0) return r.weekdays.includes(d.getDay());
  return true;
}

function attribute(post: Post, rounds: Round[]): Round | null {
  if (rounds.length === 0) return null;
  if (post.roundId) {
    const byId = rounds.find((r) => r.id === post.roundId);
    if (byId) return byId;
  }
  const created = new Date(post.createdAt);
  const day = localDay(created);
  const pool = rounds.filter((r) => runsOnDay(r, day));
  const sorted = [...(pool.length > 0 ? pool : rounds)].sort((a, b) => toMin(a.time) - toMin(b.time));
  return sorted.find((r) => toMin(r.time) >= minutesOf(created)) ?? sorted[sorted.length - 1]!;
}

async function main() {
  const days = Number(arg("days") ?? 45);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceDay = localDay(since);

  const orgs = await prisma.reportTaskStore.findMany({ where: { key: "report-feed" }, select: { orgId: true, data: true } });

  for (const { orgId, data } of orgs) {
    const feed = (data ?? {}) as { topics?: Topic[]; posts?: Post[] };
    const topicById = new Map((feed.topics ?? []).map((t) => [t.id, t]));
    const posts = feed.posts ?? [];

    const events = await prisma.performanceEvent.findMany({
      where: { orgId, source: "report_task", refId: { gte: sinceDay } },
      select: { userId: true, category: true, refType: true, refId: true, points: true },
    });
    const undone = new Set(
      events.filter((e) => e.refType === "report_round_undo").map((e) => `${e.refId}|${e.category}`),
    );
    const active = events.filter((e) => e.refType === "report_round" && !undone.has(`${e.refId}|${e.category}`));
    if (active.length === 0) continue;

    const users = await prisma.user.findMany({ where: { orgId }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));

    // วันลาที่อนุมัติแล้ว (workforce — ต้องตั้ง tenant context ให้ RLS)
    type LeaveRow = { subject: string | null; starts_on: Date; ends_on: Date; leave_type: string | null };
    type HolidayRow = { holiday_date: Date; name: string };
    let leaves: LeaveRow[] = [];
    let wfHolidays: HolidayRow[] = [];
    try {
      [leaves, wfHolidays] = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
        await tx.$executeRaw`SELECT set_config('workforce.tenant_id', ${orgId}, true)`;
        const l = await tx.$queryRaw<LeaveRow[]>`
          SELECT p.subject, lr.starts_on, lr.ends_on, lt.name AS leave_type
          FROM workforce.leave_requests lr
          LEFT JOIN workforce.employments e ON e.id = lr.employment_id
          LEFT JOIN workforce.principals  p ON p.person_id = e.person_id
          LEFT JOIN workforce.leave_types lt ON lt.id = lr.leave_type_id
          WHERE lr.status = 'APPROVED' AND lr.ends_on >= ${sinceDay}::date
            AND lt.requires_reports IS NOT TRUE
        `;
        const h = await tx.$queryRaw<HolidayRow[]>`
          SELECT holiday_date, name FROM workforce.holiday_dates WHERE holiday_date >= ${sinceDay}::date
        `;
        return [l, h] as const;
      });
    } catch (error) {
      console.warn(`[${orgId}] อ่านวันลา/วันหยุดจากระบบบุคคลไม่ได้ — ข้ามส่วนนี้:`, (error as Error).message);
    }
    const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);

    // วันหยุดบริษัท (ทุกคน): ระบบบุคคล + วันหยุดราชการ
    const companyHoliday = new Map<string, string>();
    for (const h of wfHolidays) companyHoliday.set(iso(h.holiday_date), h.name);
    for (const h of thaiHolidayEvents) {
      for (let d = new Date(`${h.start}T00:00:00`); localDay(d) < h.end; d.setDate(d.getDate() + 1)) {
        if (!companyHoliday.has(localDay(d))) companyHoliday.set(localDay(d), h.title);
      }
    }

    // "วันหยุดประจำ" ที่ตั้งในโมดูลรายงาน: วันที่เลือกเอง + กฎรายสัปดาห์ (มีข้อยกเว้นย้าย/ยกเลิก)
    const routineRow = await prisma.reportTaskStore.findUnique({
      where: { orgId_key: { orgId, key: "routine-dayoff" } },
      select: { data: true },
    });
    type Rule = { id: string; userId: string; weekday: number; startDate: string; endDate?: string };
    const routine = (routineRow?.data ?? {}) as {
      pickedDates?: Record<string, string[]>;
      rules?: Rule[];
      ruleExceptions?: Record<string, string>;
    };
    const routineOff = (userId: string, day: string): boolean => {
      if (routine.pickedDates?.[userId]?.includes(day)) return true;
      for (const r of routine.rules ?? []) {
        if (r.userId !== userId) continue;
        const cursor = new Date(`${r.startDate}T00:00:00`);
        cursor.setDate(cursor.getDate() + ((r.weekday - cursor.getDay() + 7) % 7));
        for (; localDay(cursor) <= day; cursor.setDate(cursor.getDate() + 7)) {
          const natural = localDay(cursor);
          if (r.endDate && natural >= r.endDate) break;
          const ex = routine.ruleExceptions?.[`${r.id}:${natural}`];
          const effective = ex === "cancelled" ? null : (ex ?? natural);
          if (effective === day) return true;
        }
        // ถูกย้ายมาลงวันนี้จากสัปดาห์หลังจากวันนี้
        for (const [key, moved] of Object.entries(routine.ruleExceptions ?? {})) {
          if (key.startsWith(`${r.id}:`) && moved === day) return true;
        }
      }
      return false;
    };

    const offReason = (userId: string, day: string): string | null => {
      const leave = leaves.find((l) => l.subject === userId && iso(l.starts_on) <= day && iso(l.ends_on) >= day);
      if (leave) return `วันลาอนุมัติแล้ว (${leave.leave_type ?? "ลา"})`;
      const hol = companyHoliday.get(day);
      if (hol) return `วันหยุดบริษัท (${hol})`;
      if (routineOff(userId, day)) return "วันหยุดประจำ (ตั้งในโมดูลรายงาน)";
      return null;
    };

    type Finding = { user: string; day: string; where: string; dock: string; why: string; wrong: boolean };
    const findings: Finding[] = [];

    for (const e of active) {
      const [day, topicId, roundId, userId] = (e.refId ?? "").split(":");
      if (!day || !topicId || !roundId || !userId) continue;
      const topic = topicById.get(topicId);
      const rounds = topic?.submissionRounds ?? [];
      const round = rounds.find((r) => r.id === roundId);
      const where = `${topic?.name ?? topicId} · ${round ? `${round.label} (${round.time})` : roundId}`;
      const dock = `${e.category === "report_missed" ? "ไม่ส่ง" : "ส่งสาย"} ${Number(e.points)}`;
      const user = nameOf.get(userId) ?? userId;

      // รอบรายวันเท่านั้นที่ยกเว้นวันหยุด (roundFrequencyOf ของแอป: ไม่มี weekdays และ dayOfMonth)
      const daily = round ? !round.dayOfMonth && !(round.weekdays && round.weekdays.length > 0) : true;
      const off = daily ? offReason(userId, day) : null;
      if (off) {
        findings.push({ user, day, where, dock, why: `วันนั้นเป็น${off}`, wrong: true });
        continue;
      }
      if (!round) {
        findings.push({ user, day, where, dock, why: "ไม่พบรอบนี้ในห้องแล้ว (ถูกลบ/เปลี่ยน)", wrong: false });
        continue;
      }

      const roundPosts = posts.filter(
        (p) =>
          p.authorId === userId &&
          p.topicId === topicId &&
          localDay(new Date(p.createdAt)) === day &&
          attribute(p, rounds)?.id === roundId,
      );
      const times = roundPosts.map((p) => {
        const d = new Date(p.createdAt);
        return `${pad(d.getHours())}:${pad(d.getMinutes())}${p.lateBadgeHidden ? "[ซ่อนป้าย]" : ""}`;
      });

      if (e.category === "report_missed" && roundPosts.length > 0) {
        findings.push({ user, day, where, dock, why: `มีโพสต์รอบนี้แล้ว เวลา ${times.join(", ")}`, wrong: true });
      } else if (e.category === "report_late") {
        const onTime = roundPosts.some((p) => minutesOf(new Date(p.createdAt)) <= toMin(round.time) || p.lateBadgeHidden);
        if (onTime) findings.push({ user, day, where, dock, why: `ส่งทันเวลา (${times.join(", ")})`, wrong: true });
        else if (roundPosts.length === 0) findings.push({ user, day, where, dock, why: "ไม่มีโพสต์รอบนี้เลย (ควรเป็น ไม่ส่ง)", wrong: false });
      }
    }

    const wrong = findings.filter((f) => f.wrong);
    const perUser = new Map<string, number>();
    for (const e of active) {
      const u = nameOf.get(e.userId) ?? e.userId;
      perUser.set(u, (perUser.get(u) ?? 0) + 1);
    }

    console.log(`\n══ บริษัท ${orgId} · ตรวจ ${active.length} รายการที่ยังหักอยู่ ตั้งแต่ ${sinceDay} ══`);
    console.log(`รายการหักที่ยัง active ต่อคน: ${[...perUser].map(([u, n]) => `${u} ${n}`).join(" · ")}`);
    console.log(`\n✗ น่าจะหักผิด: ${wrong.length} รายการ`);
    for (const f of wrong.sort((a, b) => a.user.localeCompare(b.user) || a.day.localeCompare(b.day))) {
      console.log(`  ${f.day}  ${f.user}  ${f.dock}  [${f.where}]  — ${f.why}`);
    }
    const info = findings.filter((f) => !f.wrong);
    if (info.length > 0) {
      console.log(`\n? ควรดูเพิ่ม (ไม่ได้หักเกิน): ${info.length} รายการ`);
      for (const f of info) console.log(`  ${f.day}  ${f.user}  ${f.dock}  [${f.where}]  — ${f.why}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("[audit-report-docks] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
