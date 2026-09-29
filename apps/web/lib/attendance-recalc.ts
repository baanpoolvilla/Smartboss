import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@smartboss/database";
import { signAccessToken } from "@smartboss/auth/jwt";

import { WORKFORCE_API_BASE } from "@/modules/hr/lib/api";

/**
 * คำนวณผลลงเวลา (มาไม่มา สายกี่นาที ขาดไหม) ของทุกคนทุกบริษัทให้เอง — เรียกจาก cron ก่อนหักคะแนน
 *
 * เดิมผลลงเวลาถูกคำนวณเฉพาะตอนมีคนเปิดแท็บ "วันนี้" ที่ /hr (modules/hr/lib/auto-recalculate.ts)
 * ไม่มีใครเปิด = ไม่มีผล = ไม่มีทั้งสาย/ขาดให้หักคะแนน และหน้าเงินเดือนก็ไม่อัปเดต
 *
 * ระบบ HR (workforce API) รับคำสั่งเฉพาะจากผู้ใช้ที่ยืนยันตัวตนแล้ว และตรวจสิทธิ์จากตารางของมันเอง
 * (ไม่ใช่จาก token) ⇒ ที่นี่หา "คนในบริษัทนั้นที่มีสิทธิ์ workforce.attendance.read.all อยู่แล้ว" (สิทธิ์
 * เดียวกับที่ปุ่มคำนวณในหน้า /hr ใช้) ออก token อายุสั้นในนามคนนั้น แล้วยิง endpoint เดียวกับที่หน้า /hr ยิง
 * ไม่มีทางลัดใหม่เข้าระบบ HR — ถ้าบริษัทไหนไม่มีใครมีสิทธิ์นั้น ก็ข้าม (เหมือนเดิม: ไม่มีใครคำนวณได้)
 *
 * คำนวณซ้ำได้ผลเท่าเดิม (เก็บเป็น version ใหม่เมื่อค่าเปลี่ยน) จึงรันทุกรอบ cron ได้
 */

/** ย้อนกี่วัน — เท่ากับที่หน้า /hr คำนวณ ครอบวันที่ cron หักคะแนนย้อนดู */
const RECALC_DAYS = 31;
/** ยิงพร้อมกันกี่คน — ต่ำกว่า pool ของ workforce API (10) เหมือน auto-recalculate.ts */
const MAX_PARALLEL = 3;

type OrgTarget = { subject: string | null; employmentIds: string[] };

async function targetsFor(orgId: string): Promise<OrgTarget> {
  return prisma.$transaction(async (tx) => {
    // ตาราง workforce เปิด FORCE RLS — ต้องสวมบทบาทแอปและตั้งบริษัทก่อน ไม่งั้นได้ 0 แถวเงียบ ๆ
    await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
    await tx.$executeRaw`SELECT set_config('workforce.tenant_id', ${orgId}, true)`;
    const who = await tx.$queryRaw<{ subject: string }[]>`
      SELECT p.subject
      FROM workforce.principals p
      JOIN workforce.principal_role_assignments a ON a.principal_id = p.id
      JOIN workforce.role_permissions rp ON rp.role_id = a.role_id
      WHERE p.status = 'ACTIVE'
        AND rp.permission = 'workforce.attendance.read.all'
        AND a.company_id IS NULL
        AND (a.expires_at IS NULL OR a.expires_at > now())
      ORDER BY p.created_at
      LIMIT 1
    `;
    const employments = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM workforce.employments WHERE terminated_on IS NULL AND status = 'ACTIVE'
    `;
    return { subject: who[0]?.subject ?? null, employmentIds: employments.map((e) => e.id) };
  });
}

function bangkokDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
}

export async function recalculateAttendanceAllOrgs(): Promise<{
  orgs: number;
  employments: number;
  failed: number;
  skippedOrgs: number;
}> {
  const result = { orgs: 0, employments: 0, failed: 0, skippedOrgs: 0 };
  const from = bangkokDay(-RECALC_DAYS);
  const to = bangkokDay(0);

  const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true } });
  for (const org of orgs) {
    let target: OrgTarget;
    try {
      target = await targetsFor(org.id);
    } catch (err) {
      // บริษัทที่ยังไม่มีข้อมูลฝั่ง HR เลย — ข้าม
      console.error("[attendance-recalc] lookup failed", org.id, err);
      result.skippedOrgs++;
      continue;
    }
    if (!target.subject || target.employmentIds.length === 0) {
      result.skippedOrgs++;
      continue;
    }

    const token = await signAccessToken({ sub: target.subject, orgId: org.id, roles: [], permissions: [] });
    result.orgs++;

    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const i = cursor++;
        const employmentId = target.employmentIds[i];
        if (employmentId === undefined) return;
        try {
          const res = await fetch(`${WORKFORCE_API_BASE}/attendance-results:recalculate`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              "idempotency-key": randomUUID(),
            },
            body: JSON.stringify({ employment_id: employmentId, from, to }),
            cache: "no-store",
          });
          if (res.ok) result.employments++;
          else result.failed++;
        } catch {
          result.failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, target.employmentIds.length) }, worker));
  }
  return result;
}
