import { PrismaClient } from "@prisma/client";

/**
 * อ่านอย่างเดียว — เช็คความพร้อมของข้อมูลก่อนเปิดใช้จริง (Chat / Report / Task / HR)
 *
 * รายคน (ผู้ใช้ที่ active ของบริษัท):
 *   HR     ผูกกับทะเบียนพนักงานที่ยัง ACTIVE (ไม่ผูก = ลงเวลา/วันลา/Day-Off ไม่ถูกนับเป็นของคนนี้)
 *   แผนก   มีแผนกใน SmartBoss (สิทธิ์หัวหน้า / ห้องรายงานแบบแผนก)
 *   กะ     มีกะที่เผยแพร่แล้วในช่วงวันที่ --from..--to (ไม่มี = ตัดสินสาย/ขาดไม่ได้)
 *   รายงาน อยู่ในรายชื่อผู้ต้องส่งของรอบรายวันอย่างน้อย 1 รอบ
 *   LINE / แอป / แจ้งเตือน  ผูก LINE · เคยเปิดจากแอปที่ติดตั้ง · เปิด Web Push ไว้อย่างน้อย 1 เครื่อง
 *
 * รัน:
 *   sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a; \
 *     pnpm --filter @smartboss/database exec tsx scripts/golive-readiness.ts --from=2026-10-01 --to=2026-10-07'
 */

const prisma = new PrismaClient();

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

type Round = {
  id: string;
  label: string;
  weekdays?: number[];
  dayOfMonth?: number;
  submitters?: {
    mode?: string;
    userIds?: string[];
    groupIds?: string[];
    departmentIds?: string[];
    addUserIds?: string[];
    removeUserIds?: string[];
  };
};
type Topic = { id: string; name: string; submissionRounds?: Round[] };
type Group = { id: string; userIds: string[] };

async function main() {
  const from = arg("from", "2026-10-01");
  const to = arg("to", "2026-10-07");

  const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true, name: true } });

  for (const org of orgs) {
    const users = await prisma.user.findMany({
      where: { orgId: org.id, isActive: true },
      select: { id: true, name: true, email: true, departmentId: true, lineUserId: true },
      orderBy: { name: "asc" },
    });
    if (users.length === 0) continue;

    // ── HR: ผูกทะเบียน + กะ + ประเภทลา (ต้องตั้ง tenant context ให้ RLS) ──
    type LinkRow = { subject: string; employment_id: string };
    type ShiftRow = { subject: string; days: number; published: number };
    type LeaveTypeRow = { name: string; auto_approve: boolean; requires_reports: boolean | null; paid: boolean };
    let links: LinkRow[] = [];
    let shifts: ShiftRow[] = [];
    let leaveTypes: LeaveTypeRow[] = [];
    let hrError: string | null = null;
    try {
      [links, shifts, leaveTypes] = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
        await tx.$executeRaw`SELECT set_config('workforce.tenant_id', ${org.id}, true)`;
        const l = await tx.$queryRaw<LinkRow[]>`
          SELECT p.subject, e.id AS employment_id
          FROM workforce.principals p
          JOIN workforce.employments e ON e.person_id = p.person_id
          WHERE p.subject IS NOT NULL AND e.status = 'ACTIVE' AND e.terminated_on IS NULL
        `;
        const s = await tx.$queryRaw<ShiftRow[]>`
          SELECT p.subject,
                 COUNT(DISTINCT sa.work_date)::int AS days,
                 COUNT(DISTINCT sa.work_date) FILTER (WHERE sa.status <> 'DRAFT')::int AS published
          FROM workforce.shift_assignments sa
          JOIN workforce.employments e ON e.id = sa.employment_id
          JOIN workforce.principals p ON p.person_id = e.person_id
          WHERE sa.work_date BETWEEN ${from}::date AND ${to}::date AND sa.shift_id IS NOT NULL
          GROUP BY p.subject
        `;
        const t = await tx.$queryRaw<LeaveTypeRow[]>`
          SELECT name, auto_approve, requires_reports, paid FROM workforce.leave_types ORDER BY name
        `;
        return [l, s, t] as const;
      });
    } catch (error) {
      hrError = (error as Error).message.split("\n")[0] ?? "error";
    }
    const linked = new Set(links.map((l) => l.subject));
    const shiftBy = new Map(shifts.map((s) => [s.subject, s]));

    // ── รายงาน: ใครอยู่ในรายชื่อผู้ต้องส่งของรอบรายวัน ──
    const feed = (
      await prisma.reportTaskStore.findUnique({
        where: { orgId_key: { orgId: org.id, key: "report-feed" } },
        select: { data: true },
      })
    )?.data as { topics?: Topic[]; submitterGroups?: Group[] } | undefined;
    const groups = feed?.submitterGroups ?? [];
    const reportRooms = new Map<string, string[]>();
    for (const topic of feed?.topics ?? []) {
      for (const r of topic.submissionRounds ?? []) {
        const daily = !r.dayOfMonth && !(r.weekdays && r.weekdays.length > 0);
        if (!daily) continue;
        const s = r.submitters ?? {};
        let ids: string[] = [];
        if (s.mode === "everyone") ids = users.map((u) => u.id);
        else if (s.mode === "people") ids = s.userIds ?? [];
        else if (s.mode === "groups") ids = groups.filter((g) => s.groupIds?.includes(g.id)).flatMap((g) => g.userIds);
        else if (s.mode === "departments") ids = users.filter((u) => u.departmentId && s.departmentIds?.includes(u.departmentId)).map((u) => u.id);
        const set = new Set([...ids, ...(s.addUserIds ?? [])]);
        for (const id of s.removeUserIds ?? []) set.delete(id);
        for (const id of set) reportRooms.set(id, [...(reportRooms.get(id) ?? []), topic.name]);
      }
    }

    // ── แอป / แจ้งเตือน ──
    let installs = new Set<string>();
    try {
      const rows = await prisma.$queryRaw<{ user_id: string }[]>`
        SELECT DISTINCT user_id FROM core.app_installs WHERE org_id = ${org.id}
      `;
      installs = new Set(rows.map((r) => r.user_id));
    } catch {
      installs = new Set(["__missing_table__"]);
    }
    const pushRows = await prisma.webPushSubscription.findMany({ where: { orgId: org.id }, select: { userId: true } });
    const push = new Set(pushRows.map((r) => r.userId));

    // ── ตั้งค่าระดับบริษัท ──
    const stores = await prisma.reportTaskStore.findMany({
      where: { orgId: org.id, key: { in: ["report-penalty-settings", "report-penalty-enabled-since"] } },
      select: { key: true, data: true },
    });

    console.log(`\n══ ${org.name} (${org.id}) · ผู้ใช้ active ${users.length} คน · กะช่วง ${from}..${to} ══`);
    if (hrError) console.log(`⚠ อ่านข้อมูลระบบบุคคลไม่ได้: ${hrError}`);
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    const mark = (ok: boolean) => (ok ? "✓" : "✗");

    const header = ["ชื่อ", "HR", "แผนก", `กะ(${days}วัน)`, "รายงาน", "LINE", "แอป", "แจ้งเตือน"];
    console.log(header.join(" | "));
    const problems = new Map<string, string[]>();
    for (const u of users) {
      const s = shiftBy.get(u.id);
      const shiftTxt = s ? (s.published < s.days ? `${s.published}/${s.days} ร่าง` : `${s.days}`) : "0";
      const row = [
        u.name,
        mark(linked.has(u.id)),
        mark(!!u.departmentId),
        shiftTxt,
        reportRooms.has(u.id) ? "✓" : "-",
        mark(!!u.lineUserId),
        installs.has("__missing_table__") ? "?" : mark(installs.has(u.id)),
        mark(push.has(u.id)),
      ];
      console.log(row.join(" | "));
      const add = (k: string) => problems.set(k, [...(problems.get(k) ?? []), u.name]);
      if (!linked.has(u.id)) add("ไม่ผูกทะเบียนพนักงาน (ลงเวลา/ลา/Day-Off ไม่นับเป็นของคนนี้)");
      if (!u.departmentId) add("ไม่มีแผนก");
      if (linked.has(u.id) && (!s || s.published === 0)) add(`ไม่มีกะที่เผยแพร่ในช่วง ${from}..${to} (ตัดสินสาย/ขาดไม่ได้)`);
      if (!reportRooms.has(u.id)) add("ไม่อยู่ในรอบรายงานรายวันใดเลย (ถ้าคนนี้ต้องส่ง = ตั้งห้องไม่ครบ)");
      if (!push.has(u.id)) add("ยังไม่เปิดแจ้งเตือนบนเครื่องไหนเลย");
    }

    console.log("\nสรุปที่ต้องจัดการ:");
    for (const [k, names] of problems) console.log(`  • ${k}: ${names.length} คน — ${names.join(", ")}`);

    console.log("\nตั้งค่าบริษัท:");
    for (const st of stores) console.log(`  ${st.key} = ${JSON.stringify(st.data)}`);
    if (!stores.some((s) => s.key === "report-penalty-enabled-since")) console.log("  report-penalty-enabled-since = (ไม่มี — ระบบจะตั้งเป็นวันที่ตัวหักคะแนนรันครั้งแรก)");
    console.log(`  ประเภทการลา: ${leaveTypes.map((t) => `${t.name}${t.auto_approve ? " [สิทธิ์]" : ""}${t.requires_reports ? " [ยังต้องส่งรายงาน]" : ""}${t.paid ? "" : " [ไม่ได้ค่าจ้าง]"}`).join(" · ") || "-"}`);
    const wfh = leaveTypes.find((t) => /work\s*from\s*home|wfh/i.test(t.name));
    if (!wfh) console.log("  ⚠ ยังไม่มีประเภท Work From Home");
    else if (!wfh.requires_reports) console.log(`  ⚠ "${wfh.name}" ไม่ได้ติ๊ก "ยังต้องส่งรายงาน" — วัน WFH จะถูกยกเว้นรายงานผิด ๆ`);
  }
}

main()
  .catch((err) => {
    console.error("[golive-readiness] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
