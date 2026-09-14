import "server-only";
import { prisma } from "@smartboss/database";
import { buildScorecards } from "@/lib/performance";
import { monthRange } from "@/lib/performance-month";
import { wfTry, type Employment, type Paged, type Person } from "@/modules/hr/lib/api";
import {
  commissionGradeOrder,
  parseBahtToSatang,
  parseGradeWeight,
  resolveGradeWeights,
  splitCommissionPool,
  type CommissionSplit,
} from "./commission";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface CommissionMonth {
  month: string;
  pool: { satang: number; note: string | null; updatedAt: Date } | null;
  /** เรียงจากเกรดดีสุด ต่อท้ายด้วย F */
  gradeOrder: string[];
  weights: Record<string, number>;
  /** บริษัทเคยตั้งตัวคูณเองแล้วหรือยัง — ยัง = ใช้ค่าตั้งต้น */
  weightsCustomized: boolean;
  split: CommissionSplit;
  /**
   * registry = เฉพาะคนในทะเบียนพนักงานที่ทำงานอยู่ในเดือนนั้น
   * all-users = อ่านทะเบียนไม่ได้ (ไม่มีสิทธิ์/ระบบบุคคลล่ม) จึงนับผู้ใช้ที่เปิดใช้งานทุกคน
   */
  eligibility: "registry" | "all-users";
}

/** อ่านทุกหน้าของรายการ — ทะเบียนเกิน 200 คนต้องไม่ถูกตัดทิ้งเงียบ ๆ */
async function fetchAll<T>(path: string): Promise<T[] | null> {
  const items: T[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < 50; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await wfTry<Paged<T>>(url);
    if (res === null) return null;
    items.push(...res.items);
    cursor = res.next_cursor;
    if (!cursor) break;
  }
  return items;
}

/**
 * อีเมลของพนักงานที่ทำงานอยู่ในเดือนนั้น (เริ่มงานก่อนสิ้นเดือน และไม่พ้นสภาพก่อนต้นเดือน)
 * คะแนนผูกกับ core.users ส่วนทะเบียนอยู่ฝั่ง workforce — จับคู่ด้วยอีเมลแบบเดียวกับหน้าทะเบียน
 */
async function employedEmails(month: string): Promise<Set<string> | null> {
  const [employments, people] = await Promise.all([
    fetchAll<Employment>("/employments"),
    fetchAll<Person>("/people"),
  ]);
  if (employments === null || people === null) return null;

  const first = `${month}-01`;
  const last = monthRange(month).to.toISOString().slice(0, 10);
  const personIds = new Set(
    employments
      .filter((e) => e.hired_on <= last && (e.terminated_on === null || e.terminated_on >= first))
      .map((e) => e.person_id),
  );
  return new Set(
    people
      .filter((p) => p.email !== null && personIds.has(p.id))
      .map((p) => p.email!.toLowerCase()),
  );
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function loadCommissionMonth(orgId: string, month: string): Promise<CommissionMonth> {
  const { from, to } = monthRange(month);
  const [scores, setting, pool, emails] = await Promise.all([
    buildScorecards(orgId, from, to),
    prisma.commissionSetting.findUnique({ where: { orgId } }),
    prisma.commissionPool.findUnique({ where: { orgId_month: { orgId, month } } }),
    employedEmails(month),
  ]);

  const gradeNames = scores.settings.gradeThresholds.map(([grade]) => grade);
  const saved = toObject(setting?.gradeWeights);
  const weights = resolveGradeWeights(gradeNames, saved);

  const members = scores.cards
    .filter((c) => emails === null || emails.has(c.email.toLowerCase()))
    .map((c) => ({ userId: c.userId, name: c.name, email: c.email, grade: c.grade, score: c.score }));

  const poolSatang = pool === null ? 0 : Math.round(Number(pool.amount.toString()) * 100);

  return {
    month,
    pool: pool === null ? null : { satang: poolSatang, note: pool.note, updatedAt: pool.updatedAt },
    gradeOrder: commissionGradeOrder(gradeNames),
    weights,
    weightsCustomized: Object.keys(saved).length > 0,
    split: splitCommissionPool(poolSatang, members, weights),
    eligibility: emails === null ? "all-users" : "registry",
  };
}

/** ใส่/แก้ยอด Pool ของเดือน · ช่องยอดว่าง = ลบยอดของเดือนนั้น */
export async function saveCommissionPool(input: {
  orgId: string;
  userId: string;
  month: string;
  amount: string;
  note: string;
}): Promise<void> {
  if (!MONTH.test(input.month)) throw new Error("เดือนไม่ถูกต้อง");

  if (input.amount.trim() === "") {
    await prisma.commissionPool.deleteMany({ where: { orgId: input.orgId, month: input.month } });
    return;
  }
  const satang = parseBahtToSatang(input.amount.trim());
  if (satang === null) {
    throw new Error("ยอด Pool ไม่ถูกต้อง — ใส่เป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่เกิน 99,999,999.99 บาท");
  }

  const data = {
    amount: (satang / 100).toFixed(2),
    note: input.note.trim().slice(0, 500) || null,
    updatedBy: input.userId,
  };
  await prisma.commissionPool.upsert({
    where: { orgId_month: { orgId: input.orgId, month: input.month } },
    update: data,
    create: { orgId: input.orgId, month: input.month, ...data },
  });
}

/** บันทึกตัวคูณต่อเกรด — คู่ gradeName[i] กับ weight[i] จากฟอร์ม */
export async function saveCommissionWeights(input: {
  orgId: string;
  userId: string;
  grades: string[];
  weights: string[];
}): Promise<void> {
  const gradeWeights: Record<string, number> = {};
  input.grades.forEach((grade, i) => {
    const name = grade.trim();
    if (!name) return;
    const value = parseGradeWeight(input.weights[i] ?? "");
    if (value === null) {
      throw new Error(`ตัวคูณของเกรด ${name} ไม่ถูกต้อง — ใส่ 0 ถึง 100 ทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
    gradeWeights[name] = value;
  });

  await prisma.commissionSetting.upsert({
    where: { orgId: input.orgId },
    update: { gradeWeights, updatedBy: input.userId },
    create: { orgId: input.orgId, gradeWeights, updatedBy: input.userId },
  });
}
