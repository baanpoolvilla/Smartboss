/**
 * เบี้ยขยัน "ขั้นรอบก่อน = งวดก่อนหน้า" — เทสกับฐานข้อมูลจริงในเครื่อง (ผู้ใช้ 26/11/2569 "เทสทุกแบบที่จะเกิดได้")
 * เรียกฟังก์ชันเดียวกับหน้าจอ: computeRun / submitRun / decideRun / setExcluded / deleteRun
 * ใช้งวดปี 2031 (ไม่ชนข้อมูลเดิม) · ตั้งค่า/โปรไฟล์ที่แตะ คืนค่าเดิมตอนจบ · งวด/เหตุการณ์ที่สร้าง ลบทิ้ง
 *
 * รันเฉพาะเมื่อสั่ง (โหลด .env ก่อน): set -a; . ../../.env; set +a; SALARY_DB_TEST=1 npx vitest run modules/salary/lib/diligence-chain.db.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.SALARY_DB_TEST === "1";
const ORG = "a22927e8-2ff9-4e7a-b271-0cbb2eba56b6";
const ACTOR = { userId: "t-ceo", name: "เทสเบี้ยขยัน" };
const EMP = ["00000000-0000-0000-0000-0000000000c1", "00000000-0000-0000-0000-0000000000c2", "01a16271-6256-7000-b663-fd4de740448d", "01a16271-6275-7000-a2a1-bd56e96f776d"];
const [A, B, C, D] = EMP as [string, string, string, string];

describe.skipIf(!RUN)("เบี้ยขยัน: ขั้นรอบก่อนจากงวดก่อนหน้า (DB จริง)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, run: typeof import("./run"), db: typeof import("./db"), types: typeof import("./types");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let before: any, profilesBefore: any[] = [];
  const T0 = new Date();
  const created: string[] = [];

  /** เปิดงวดตรง ๆ (createRun กันงวดค้างของข้อมูลเดิมในเครื่อง) แล้วคำนวณด้วย computeRun จริง */
  async function open(period: string) {
    const d = types.periodDates(period, 25, 0);
    const id = randomUUID();
    await db.withSalaryTenant(ORG, (tx) =>
      tx.salaryRun.create({ data: { id, orgId: ORG, period, startsOn: new Date(`${d.startsOn}T00:00:00Z`), endsOn: new Date(`${d.endsOn}T00:00:00Z`), payDate: new Date(`${d.payDate}T00:00:00Z`), createdBy: ACTOR.userId, createdByName: ACTOR.name } }),
    );
    created.push(id);
    await run.computeRun(ORG, id, ACTOR);
    return id;
  }
  async function lines(runId: string) {
    const rows = await db.withSalaryTenant(ORG, (tx) => tx.salaryRunLine.findMany({ where: { orgId: ORG, runId }, select: { employmentId: true, info: true } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Map(rows.map((r: any) => [r.employmentId, r.info?.diligence as { amount: number; prev: number | null; how: string } | undefined]));
  }
  const amt = async (runId: string, emp: string) => (await lines(runId)).get(emp)?.amount;
  const setStatus = (runId: string, status: string) => db.withSalaryTenant(ORG, (tx) => tx.salaryRun.update({ where: { id: runId }, data: { status } }));
  /** ปรับยอดเบี้ยขยันรายคน (เหมือน HR กด "ปรับยอด") — ใช้จำลองงวดที่คนนั้นลา/สาย (ยอด 0) */
  async function override(runId: string, emp: string, amount: number) {
    await db.withSalaryTenant(ORG, async (tx) => {
      const l = (await tx.salaryRunLine.findFirst({ where: { orgId: ORG, runId, employmentId: emp } }))!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info = (l.info ?? {}) as any;
      info.overrides = { ...(info.overrides ?? {}), diligence: { amount, reason: "เทส", byName: ACTOR.name } };
      await tx.salaryRunLine.update({ where: { id: l.id }, data: { info } });
    });
    await run.computeRun(ORG, runId, ACTOR);
  }
  /** ใส่ค่าคอมเอง (ปี 2031 ยังไม่มีเกรด — ไม่งั้นติดค่าคอมก่อนถึงเรื่องเบี้ยขยัน) แล้วคำนวณใหม่ */
  async function settleCommission(runId: string) {
    await db.withSalaryTenant(ORG, async (tx) => {
      const ls = await tx.salaryRunLine.findMany({ where: { orgId: ORG, runId } });
      for (const l of ls) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info = (l.info ?? {}) as any;
        info.overrides = { ...(info.overrides ?? {}), commission: { amount: 0, reason: "เทส", byName: ACTOR.name } };
        await tx.salaryRunLine.update({ where: { id: l.id }, data: { info } });
      }
    });
    await run.computeRun(ORG, runId, ACTOR);
  }
  /** ข้อความที่ทำให้ส่งไม่ได้ — เฉพาะเรื่องเบี้ยขยัน (ค่าคอมที่เกรดยังไม่ปิดของปี 2031 ไม่เกี่ยว) */
  async function submitError(runId: string): Promise<string | null> {
    try {
      await run.submitRun(ORG, ACTOR, runId);
      return null;
    } catch (e) {
      return String((e as Error).message);
    }
  }
  async function blocksOf(runId: string): Promise<string[]> {
    const rows = await db.withSalaryTenant(ORG, (tx) => tx.salaryRunLine.findMany({ where: { orgId: ORG, runId }, select: { info: true } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return [...new Set(rows.flatMap((r: any) => (r.info?.blocks ?? []) as string[]))];
  }
  /** ล้างงวดทดสอบ — สิทธิ์เจ้าของตาราง (เฉพาะในเครื่อง) เพราะแอปไม่มีสิทธิ์ลบประวัติ (ตั้งใจ) */
  async function asOwner<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx: any) => {
      // ปิด trigger กันลบงวดที่จ่ายแล้วชั่วคราว (เฉพาะคำสั่งล้างข้อมูลทดสอบในเครื่อง)
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRaw`SELECT set_config('salary.org_id', ${ORG}, true)`;
      return fn(tx);
    });
  }
  async function cleanRuns() {
    await asOwner(async (tx) => {
      const ids = (await tx.salaryRun.findMany({ where: { orgId: ORG, period: { gte: "2031-01" } }, select: { id: true } })).map((r: { id: string }) => r.id);
      await tx.salaryEvent.deleteMany({ where: { orgId: ORG, OR: [{ runId: { in: ids } }, { at: { gte: T0 }, byName: ACTOR.name }] } });
      if (ids.length) {
        await tx.salaryRunLine.deleteMany({ where: { orgId: ORG, runId: { in: ids } } });
        await tx.salaryRun.deleteMany({ where: { orgId: ORG, id: { in: ids } } });
      }
    });
  }

  beforeAll(async () => {
    ({ prisma } = await import("@smartboss/database"));
    run = await import("./run");
    db = await import("./db");
    types = await import("./types");
    await cleanRuns();
    before = await prisma.salarySettings.findUnique({ where: { orgId: ORG } });
    await prisma.salarySettings.update({ where: { orgId: ORG }, data: { diligenceEnabled: true, diligenceSteps: [500, 800, 1000], diligencePartial: "none", diligenceFromPeriod: "2031-01" } });
    profilesBefore = await db.withSalaryTenant(ORG, (tx) => tx.salaryProfile.findMany({ where: { orgId: ORG, employmentId: { in: EMP } } }));
    await db.withSalaryTenant(ORG, async (tx) => {
      for (const e of EMP) {
        await tx.salaryProfile.upsert({ where: { orgId_employmentId: { orgId: ORG, employmentId: e } }, create: { orgId: ORG, employmentId: e, diligenceEligible: true, diligenceOpening: null }, update: { diligenceEligible: true, diligenceOpening: null } });
      }
    });
  }, 120_000);

  const leaveIds: string[] = [];
  /** ใบลากิจที่อนุมัติแล้วในระบบบุคคล — จำลองคนที่ลาในเดือนที่ลืมทำงวด */
  async function addLeave(emp: string, day: string) {
    const id = randomUUID();
    await prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('workforce.tenant_id', ${ORG}, true)`;
      const t = await tx.$queryRawUnsafe(
        `SELECT id::text FROM workforce.leave_types WHERE NOT auto_approve AND NOT requires_reports AND name !~* '(holiday|พักร้อน|annual|vacation|นักขัตฤกษ์)' ORDER BY (name ILIKE '%กิจ%') DESC LIMIT 1`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO workforce.leave_requests (id, tenant_id, company_id, employment_id, leave_type_id, starts_on, ends_on, total_minutes, paid_minutes, status, reason)
         SELECT $1::uuid, e.tenant_id, e.company_id, e.id, $3::uuid, $4::date, $4::date, 480, 480, 'APPROVED', 'เทสเบี้ยขยัน' FROM workforce.employments e WHERE e.id = $2::uuid`,
        id, emp, t[0].id, day,
      );
    });
    leaveIds.push(id);
  }

  afterAll(async () => {
    if (!prisma) return;
    // คืนค่าตั้งก่อนอย่างอื่น — เทสพังกลางทางก็ไม่ทิ้งค่าตั้งทดสอบไว้ (งวดเริ่มนับจริงของบริษัทในเครื่อง = 2026-11)
    const { orgId: _o, updatedAt: _u, ...restSettings } = before;
    await prisma.salarySettings.update({ where: { orgId: ORG }, data: { ...restSettings, diligenceFromPeriod: before.diligenceFromPeriod?.startsWith("2031") ? "2026-11" : before.diligenceFromPeriod } });
    await cleanRuns();
    if (leaveIds.length) {
      await prisma.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.$executeRaw`SELECT set_config('workforce.tenant_id', ${ORG}, true)`;
        await tx.$executeRawUnsafe(`DELETE FROM workforce.leave_requests WHERE id = ANY($1::uuid[])`, leaveIds);
      });
    }
    await asOwner(async (tx) => {
      await tx.salaryProfile.deleteMany({ where: { orgId: ORG, employmentId: { in: EMP } } });
      for (const p of profilesBefore) await tx.salaryProfile.create({ data: p });
    });
  }, 120_000);

  it("1. งวดแรกที่เริ่มนับ (ม.ค.) — ไม่ดูงวดก่อนหน้า ทุกคนเริ่มขั้นแรก 500", async () => {
    const jan = await open("2031-01");
    for (const e of EMP) expect(await amt(jan, e)).toBe(500);
    expect((await blocksOf(jan)).some((b) => b.includes("เบี้ยขยัน"))).toBe(false);
  }, 300_000);

  it("2. งวดก่อนหน้ายังเป็นร่าง — คิดต่อขั้นได้ (800) แต่ขึ้นข้อความกันส่ง", async () => {
    const jan = created[0]!;
    // B ลา/สายในเดือน ม.ค. (HR ปรับยอดเป็น 0)
    await override(jan, B, 0);
    const feb = await open("2031-02");
    await settleCommission(feb);
    expect(await amt(feb, A)).toBe(800);
    expect(await amt(feb, B)).toBe(500); // ม.ค. ได้ 0 → เริ่มใหม่
    expect((await lines(feb)).get(A)?.how).toContain("ยังไม่อนุมัติ");
    expect((await blocksOf(feb)).some((b) => b.includes("ม.ค.") && b.includes("ยังไม่อนุมัติ"))).toBe(true);
    const err = await submitError(feb);
    expect(err).toContain("ยังไม่อนุมัติ");
  }, 300_000);

  it("3. งวดก่อนหน้าอนุมัติแล้ว + ดึงข้อมูลใหม่ — ป้ายกันส่งหาย", async () => {
    const [jan, feb] = created as [string, string];
    await setStatus(jan, "approved");
    await run.computeRun(ORG, feb, ACTOR);
    expect((await blocksOf(feb)).some((b) => b.includes("ยังไม่อนุมัติ"))).toBe(false);
    expect(await amt(feb, A)).toBe(800);
    expect((await lines(feb)).get(A)?.how).not.toContain("ยังไม่อนุมัติ");
  }, 300_000);

  it("4. งวดก่อนหน้าถูกส่งกลับมาแก้หลังคำนวณ — ส่งงวดนี้ไม่ได้ (กันตัวเลขเก่า)", async () => {
    const [jan, feb] = created as [string, string];
    await setStatus(jan, "draft");
    await override(jan, A, 0); // ม.ค. แก้ให้ A ไม่ได้ (เช่น อนุมัติใบลาย้อนหลัง)
    const err = await submitError(feb);
    expect(err).toContain("ยังไม่อนุมัติ");
    await setStatus(jan, "approved");
    const err2 = await submitError(feb);
    expect(err2).toContain("เปลี่ยนหลังคำนวณ"); // ยอด ม.ค. ของ A เปลี่ยนหลังคำนวณ ก.พ. → ต้องดึงใหม่ก่อนส่ง
    expect(err2).toContain("ดึงข้อมูลใหม่");
    await run.computeRun(ORG, feb, ACTOR);
    expect(await amt(feb, A)).toBe(500); // ดึงใหม่แล้ว: ม.ค. 0 → ก.พ. เริ่มใหม่ 500
    expect(await submitError(feb)).toBeNull(); // ครบแล้ว ส่งได้
    await setStatus(feb, "paid");
  }, 300_000);

  it("5. ลืมทำงวด มี.ค. — งวด เม.ย. คิดเดือนที่หายจากการลงเวลาจริงแทน ขั้นไม่เพี้ยน", async () => {
    // ไม่มีงวด มี.ค. · ก.พ.: A 500, B 800, C 800, D 800 → มี.ค. (คิดจากลงเวลา ไม่ลาไม่สาย) A 800, B/C/D 1000 → เม.ย. A 1000, อื่น ๆ 1000 (คงขั้นสูงสุด)
    const apr = await open("2031-04");
    expect(await amt(apr, A)).toBe(1000);
    expect(await amt(apr, B)).toBe(1000);
    expect((await lines(apr)).get(A)?.how).toContain("ไม่ได้ทำในระบบ");
    expect((await blocksOf(apr)).some((b) => b.includes("ยังไม่อนุมัติ"))).toBe(false);
  }, 300_000);

  it("6. ลืมทำ 2 เดือนติด (พ.ค.–มิ.ย.) — นับซ้อนย้อนได้ถึงงวดที่มี", async () => {
    const apr = created[2]!;
    await override(apr, C, 0); // เม.ย. C ไม่ได้
    await setStatus(apr, "paid");
    const jul = await open("2031-07");
    // C: เม.ย. 0 → พ.ค. 500 → มิ.ย. 800 → ก.ค. 1000 · A: คงสูงสุด 1000
    expect(await amt(jul, C)).toBe(1000);
    expect(await amt(jul, A)).toBe(1000);
  }, 300_000);

  it("7. คนที่ถูก \"ไม่จ่ายงวดนี้\" — งวดหน้ายังนับขั้นต่อจากการลงเวลาจริง", async () => {
    const jul = created[3]!;
    await override(jul, D, 0); // D ไม่ได้ใน ก.ค. (สมมติลา)
    await run.setExcluded(ORG, ACTOR, jul, B, true, "เทส: ไม่จ่ายงวดนี้");
    const ex = await db.withSalaryTenant(ORG, (tx) => tx.salaryRun.findFirst({ where: { id: jul }, select: { excluded: true } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((ex!.excluded as any[]) ?? []).find((x) => x.employmentId === B)?.diligence).toBe(1000);
    await setStatus(jul, "paid");
    const aug = await open("2031-08");
    expect(await amt(aug, B)).toBe(1000); // ต่อจาก 1000 (คงสูงสุด) ไม่กลับไป 500
    expect(await amt(aug, D)).toBe(500); // ก.ค. 0 → เริ่มใหม่
  }, 300_000);

  it("8. ลบร่างงวดก่อนหน้าหลังคำนวณ — ส่งไม่ได้จนดึงข้อมูลใหม่ (ถ้ายอดเปลี่ยน) และคิดจากลงเวลาแทน", async () => {
    const aug = created[4]!;
    await setStatus(aug, "draft");
    const sep = await open("2031-09");
    expect(await amt(sep, D)).toBe(800); // ส.ค. 500 → ก.ย. 800
    await run.deleteRun(ORG, ACTOR, aug); // ลบร่าง ส.ค.
    created.splice(created.indexOf(aug), 1);
    await run.computeRun(ORG, sep, ACTOR);
    // ส.ค. หาย → คิดจากลงเวลา: ก.ค. D 0 → ส.ค. 500 → ก.ย. 800 (เท่าเดิม ไม่เพี้ยน)
    expect(await amt(sep, D)).toBe(800);
    expect((await lines(sep)).get(D)?.how).toContain("ไม่ได้ทำในระบบ");
  }, 300_000);

  it("9. คนใหม่ / ไม่มีชื่อในงวดก่อน — ใช้ขั้นยกมาของคนนั้น ไม่มีก็เริ่มขั้นแรก", async () => {
    const sep = created[created.length - 1]!;
    // จำลองว่า A ไม่อยู่ในงวด ก.ย. (เช่น เพิ่งใส่เงินเดือน) และ HR ตั้งขั้นยกมา 800 · C ไม่อยู่และไม่มีขั้นยกมา
    await db.withSalaryTenant(ORG, async (tx) => {
      await tx.salaryRunLine.deleteMany({ where: { orgId: ORG, runId: sep, employmentId: { in: [A, C] } } });
      await tx.salaryProfile.update({ where: { orgId_employmentId: { orgId: ORG, employmentId: A } }, data: { diligenceOpening: 800 } });
    });
    await setStatus(sep, "approved");
    const oct = await open("2031-10");
    expect(await amt(oct, A)).toBe(1000); // ยกมา 800 → 1000
    expect(await amt(oct, C)).toBe(500); // ไม่มีอะไร → ขั้นแรก
  }, 300_000);

  it("10. ตั้งงวดเริ่มนับใหม่กลางทาง — งวดก่อนหน้านั้นไม่ถูกนับ", async () => {
    const oct = created[created.length - 1]!;
    await prisma.salarySettings.update({ where: { orgId: ORG }, data: { diligenceFromPeriod: "2031-10" } });
    await run.computeRun(ORG, oct, ACTOR);
    for (const e of [B, D]) expect(await amt(oct, e)).toBe(500);
    await prisma.salarySettings.update({ where: { orgId: ORG }, data: { diligenceFromPeriod: "2031-01" } });
  }, 300_000);

  it("11. ลืมทำงวด พ.ย. และเดือนนั้นมีคนลากิจ — คิดลาจากข้อมูลจริง ขั้นรีเซ็ต ไม่ปล่อยผ่าน", async () => {
    const oct = created[created.length - 1]!;
    await setStatus(oct, "approved");
    await addLeave(C, "2031-11-10"); // C ลากิจ 10 พ.ย. (อยู่ในงวด พ.ย. 26 ต.ค.–25 พ.ย.)
    const dec = await open("2031-12");
    // ต.ค.: B 500 · C 500 → พ.ย. (ไม่มีงวด คิดจากข้อมูลจริง): B 800 · C ลา → 0 → ธ.ค.: B 1000 · C 500
    expect(await amt(dec, B)).toBe(1000);
    expect(await amt(dec, C)).toBe(500);
    expect((await lines(dec)).get(C)?.how).toContain("ไม่ได้ทำในระบบ");
  }, 300_000);

  it("12. HR ปรับยอดเบี้ยขยันเอง — งวดหน้านับต่อจากยอดที่ปรับ", async () => {
    const dec = created[created.length - 1]!;
    await override(dec, A, 500); // ธ.ค. ระบบคิด 1000 แต่ HR ปรับเป็น 500 (พร้อมเหตุผล)
    await setStatus(dec, "approved");
    const jan = await open("2032-01");
    expect(await amt(jan, A)).toBe(800); // ต่อจาก 500 ที่ปรับ ไม่ใช่ 1000
  }, 300_000);
});
