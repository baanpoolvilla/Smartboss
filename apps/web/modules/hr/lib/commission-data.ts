import "server-only";
import { prisma } from "@smartboss/database";
import { buildPeriodScorecards } from "@/lib/performance";
import { bangkokDay, scorePeriodRange } from "@/lib/score-period";
import { wfTry, type Employment, type Paged, type Person } from "@/modules/hr/lib/api";
import {
  commissionGradeOrder,
  formatSatang,
  isCommissionEligible,
  parseBahtToSatang,
  parseGradeValue,
  parseGradeWeight,
  resolveGradeValues,
  resolveGradeWeights,
  formatExact,
  parseGradeShare,
  parseTierScore,
  splitCommissionPool,
  splitGradeTier,
  toCommissionMethod,
  type CommissionEligibility,
  type CommissionFor,
  type CommissionMethod,
  type CommissionSplit,
  type GradeTierSplit,
} from "./commission";
import { loadScorePeriodConfig } from "@/lib/score-period-config";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface CommissionMonth {
  month: string;
  pool: { satang: number; note: string | null; updatedAt: Date } | null;
  /** เรียงจากเกรดดีสุด ต่อท้ายด้วย F */
  gradeOrder: string[];
  weights: Record<string, number>;
  /** บริษัทเคยตั้งตัวคูณเองแล้วหรือยัง — ยัง = ใช้ค่าตั้งต้น */
  weightsCustomized: boolean;
  /** แบ่ง Pool เฉพาะคนที่ได้ค่าคอม (วิธี pool) */
  split: CommissionSplit;
  method: CommissionMethod;
  /** % หรือบาทต่อเกรด (วิธี percent/fixed) */
  values: Record<string, number>;
  eligibility: CommissionEligibility;
  /** ทุกคนที่มีเกรดเดือนนั้น พร้อมว่าได้ค่าคอมไหม */
  members: { userId: string; name: string; email: string; grade: string; score: number; departmentId: string | null; eligible: boolean }[];
  departments: { id: string; name: string }[];
  /**
   * registry = เฉพาะคนในทะเบียนพนักงานที่ทำงานอยู่ในเดือนนั้น
   * all-users = อ่านทะเบียนไม่ได้ (ไม่มีสิทธิ์/ระบบบุคคลล่ม) จึงนับผู้ใช้ที่เปิดใช้งานทุกคน
   */
  registry: "registry" | "all-users";
  /** วิธี grade_tier: % ก้อน Grade */
  gradeShare: number;
  /** คะแนน Tier ที่บันทึกของเดือนนี้ (ไม่มีคีย์ = ยังไม่ใส่) */
  tierScores: Record<string, number>;
  /** วิธี grade_tier: ผลแบ่งของเดือนนี้ (เฉพาะคนที่ได้ค่าคอม) */
  gradeTier: GradeTierSplit;
}

/** { userId: number } จาก JSON — ทิ้งค่าที่ไม่ใช่ตัวเลข ≥ 0 */
function toTierScores(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(toObject(value))) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
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
 * อีเมลของพนักงานที่ทำงานอยู่ในรอบเกรดนั้น (เริ่มงานก่อนวันตัดรอบ และไม่พ้นสภาพก่อนวันเริ่มรอบ)
 * เดิมใช้เดือนปฏิทิน ⇒ คนเริ่มงาน 27 ต.ค. (หลังรอบเกรด ต.ค. ปิด) ได้เกรดเต็มและหาร Pool ต.ค. ด้วย ทั้งที่ไม่อยู่ในงวดเงินเดือนนั้น
 * คะแนนผูกกับ core.users ส่วนทะเบียนอยู่ฝั่ง workforce — จับคู่ด้วยอีเมลแบบเดียวกับหน้าทะเบียน
 */
async function employedEmails(first: string, last: string): Promise<Set<string> | null> {
  const [employments, people] = await Promise.all([
    fetchAll<Employment>("/employments"),
    fetchAll<Person>("/people"),
  ]);
  if (employments === null || people === null) return null;

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
  // เกรดของค่าคอม = รอบเกรดเดียวกับหน้าคะแนน (ตัดวันที่ 25 — score-period.ts)
  const period = await loadScorePeriodConfig(orgId);
  const range = scorePeriodRange(period, month);
  const [scores, setting, pool, emails, departments] = await Promise.all([
    buildPeriodScorecards(orgId, period, month),
    prisma.commissionSetting.findUnique({ where: { orgId } }),
    prisma.commissionPool.findUnique({ where: { orgId_month: { orgId, month } } }),
    employedEmails(bangkokDay(range.from), bangkokDay(range.to)),
    prisma.department.findMany({ where: { orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const gradeNames = scores.settings.gradeThresholds.map(([grade]) => grade);
  const saved = toObject(setting?.gradeWeights);
  const weights = resolveGradeWeights(gradeNames, saved);

  const method = toCommissionMethod(setting?.method);
  const order = commissionGradeOrder(gradeNames);
  // ค่าแยกตามวิธี ({ percent: {...}, fixed: {...} }) — สลับวิธีไปมาแล้วตัวเลขไม่ปนกัน (3,000 บาท ไม่กลายเป็น 3,000%)
  const values = resolveGradeValues(order, toObject(toObject(setting?.gradeValues)[method]), method);
  const eligibility: CommissionEligibility = { departmentIds: setting?.eligibleDepartmentIds ?? [], excludedUserIds: setting?.excludedUserIds ?? [] };

  const cards = scores.cards.filter((c) => emails === null || emails.has(c.email.toLowerCase()));
  const deptOf = new Map(
    (await prisma.user.findMany({ where: { orgId, id: { in: cards.map((c) => c.userId) } }, select: { id: true, departmentId: true } })).map((u) => [u.id, u.departmentId]),
  );
  const all = cards.map((c) => {
    const departmentId = deptOf.get(c.userId) ?? null;
    return { userId: c.userId, name: c.name, email: c.email, grade: c.grade, score: c.score, departmentId, eligible: isCommissionEligible({ userId: c.userId, departmentId }, eligibility) };
  });
  const members = all.filter((m) => m.eligible).map(({ userId, name, email, grade, score }) => ({ userId, name, email, grade, score }));

  const poolSatang = pool === null ? 0 : Math.round(Number(pool.amount.toString()) * 100);
  const gradeShare = setting ? Number(setting.gradeShare.toString()) : 70;
  const tierScores = toTierScores(pool?.tierScores);

  return {
    gradeShare,
    tierScores,
    gradeTier: splitGradeTier(poolSatang, gradeShare, members, weights, tierScores),
    month,
    pool: pool === null ? null : { satang: poolSatang, note: pool.note, updatedAt: pool.updatedAt },
    gradeOrder: order,
    weights,
    weightsCustomized: Object.keys(saved).length > 0,
    split: splitCommissionPool(poolSatang, members, weights),
    method,
    values,
    eligibility,
    members: all,
    departments,
    registry: emails === null ? "all-users" : "registry",
  };
}

/**
 * ค่าคอมของคนหนึ่งในเดือนนั้นตามวิธีที่บริษัทเลือก — ใช้ทั้งแท็บค่าคอมและงวดเงินเดือน
 * null = ไม่ได้ (ไม่คิดจากเกรด · ไม่อยู่ในกลุ่มที่ได้ · เกรดได้ 0 · Pool ยังไม่ใส่)
 */
export function commissionForUser(data: CommissionMonth, userId: string, label: string): CommissionFor {
  const m = data.members.find((x) => x.userId === userId);
  if (!m || !m.eligible || data.method === "off") return null;
  if (data.method === "grade_tier") {
    const g = data.gradeTier;
    if (!data.pool) return { kind: "blocked", reason: `ยังไม่ได้ใส่ค่าคอมรวมของรอบ ${label} (ระบบบุคคล › พนักงาน › ค่าคอม) — รอบนี้ไม่มีค่าคอมให้ใส่ 0` };
    if (g.poolSatang <= 0) return null;
    if (g.problems.length > 0) return { kind: "blocked", reason: `ค่าคอม ${label}: ${g.problems.join(" · ")}` };
    const s = g.shares.find((x) => x.userId === userId);
    if (!s || s.totalSatang <= 0) return null;
    const gradeTxt = `Grade ${s.grade} (${s.weight}) × ${formatSatang(g.gradePoolSatang)} ÷ ${g.totalGrade} = ${formatExact(s.gradeExact)}`;
    const tierTxt = `Tier ${s.tier} × ${formatSatang(g.tierPoolSatang)} ÷ ${g.totalTier} = ${formatExact(s.tierExact)}`;
    return {
      kind: "amount",
      satang: s.totalSatang,
      detail: `${gradeTxt} + ${tierTxt} · ยอดรวม ${label} ${formatSatang(g.poolSatang)} (Grade ${g.gradeShare}% / Tier ${Math.round((100 - g.gradeShare) * 100) / 100}%)`,
      parts: {
        grade: s.grade,
        gradeScore: s.weight,
        gradeExact: s.gradeExact,
        tier: s.tier ?? 0,
        tierExact: s.tierExact,
        gradePool: g.gradePoolSatang,
        tierPool: g.tierPoolSatang,
        totalGrade: g.totalGrade,
        totalTier: g.totalTier,
      },
    };
  }
  if (data.method === "pool") {
    const share = data.split.shares.find((x) => x.userId === userId);
    if (!data.pool || !share || share.amountSatang <= 0) return null;
    const unit = data.split.perUnitSatang !== null ? ` × ${formatSatang(Math.round(data.split.perUnitSatang))} บาทต่อหน่วย` : "";
    return { kind: "amount", satang: share.amountSatang, detail: `เกรด ${m.grade} (ตัวคูณ ${share.weight})${unit} · Pool ${label}` };
  }
  const v = data.values[m.grade] ?? 0;
  if (v <= 0) return null;
  if (data.method === "fixed") return { kind: "amount", satang: Math.round(v * 100), detail: `เกรด ${m.grade} ได้ ${formatSatang(Math.round(v * 100))} บาท · เกรด ${label}` };
  return { kind: "percent", percent: v, detail: `เกรด ${m.grade} ได้ ${v}% ของเงินเดือน · เกรด ${label}` };
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

/**
 * วิธี grade_tier: บันทึกยอดรวมประจำรอบ + คะแนน Tier รายคนพร้อมกัน (ฟอร์มเดียว)
 * ยอดรวมต้องใส่เสมอ (ไม่มีค่าคอม = 0) · คะแนนว่าง = ยังไม่ใส่ (ระบบไม่ให้สรุปรอบจนกว่าจะครบ)
 * รับเฉพาะ id ผู้ใช้ของบริษัทนี้
 */
export async function saveCommissionRound(input: {
  orgId: string;
  userId: string;
  month: string;
  amount: string;
  note: string;
  tierUserIds: string[];
  tierValues: string[];
}): Promise<void> {
  if (!MONTH.test(input.month)) throw new Error("เดือนไม่ถูกต้อง");
  const satang = parseBahtToSatang(input.amount.trim());
  if (satang === null) throw new Error("ยอดค่าคอมรวมไม่ถูกต้อง — ใส่ตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง (รอบนี้ไม่มีค่าคอม ใส่ 0)");
  const known = new Set(
    (await prisma.user.findMany({ where: { orgId: input.orgId, id: { in: input.tierUserIds } }, select: { id: true } })).map((u) => u.id),
  );
  const tierScores: Record<string, number> = {};
  input.tierUserIds.forEach((id, i) => {
    if (!known.has(id)) return;
    const v = parseTierScore(input.tierValues[i] ?? "");
    if (v === null) throw new Error(`คะแนน Tier ช่องที่ ${i + 1} ไม่ถูกต้อง — ใส่ตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง`);
    if (v !== undefined) tierScores[id] = v;
  });
  const data = {
    amount: (satang / 100).toFixed(2),
    note: input.note.trim().slice(0, 500) || null,
    tierScores,
    updatedBy: input.userId,
  };
  await prisma.commissionPool.upsert({
    where: { orgId_month: { orgId: input.orgId, month: input.month } },
    update: data,
    create: { orgId: input.orgId, month: input.month, ...data },
  });
}

/** วิธี grade_tier: % ก้อน Grade (ที่เหลือเป็นก้อน Tier) */
export async function saveCommissionGradeShare(input: { orgId: string; userId: string; gradeShare: string }): Promise<void> {
  const v = parseGradeShare(input.gradeShare);
  if (v === null) throw new Error("% ก้อน Grade ต้องเป็น 0–100");
  await prisma.commissionSetting.upsert({
    where: { orgId: input.orgId },
    update: { gradeShare: v, updatedBy: input.userId },
    create: { orgId: input.orgId, gradeShare: v, updatedBy: input.userId },
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

/** เลือกวิธีคิดค่าคอม */
export async function saveCommissionMethod(input: { orgId: string; userId: string; method: string }): Promise<void> {
  const method = toCommissionMethod(input.method);
  await prisma.commissionSetting.upsert({
    where: { orgId: input.orgId },
    update: { method, updatedBy: input.userId },
    create: { orgId: input.orgId, method, updatedBy: input.userId },
  });
}

/** % หรือบาทต่อเกรด (วิธี percent/fixed) — คู่ gradeName[i] กับ value[i] จากฟอร์ม */
export async function saveCommissionValues(input: { orgId: string; userId: string; grades: string[]; values: string[] }): Promise<void> {
  const setting = await prisma.commissionSetting.findUnique({ where: { orgId: input.orgId }, select: { method: true, gradeValues: true } });
  const method = toCommissionMethod(setting?.method);
  const gradeValues: Record<string, number> = {};
  input.grades.forEach((grade, i) => {
    const name = grade.trim();
    if (!name) return;
    const value = parseGradeValue(input.values[i] ?? "", method);
    if (value === null) throw new Error(method === "percent" ? `% ของเกรด ${name} ไม่ถูกต้อง — ใส่ 0 ถึง 100` : `จำนวนเงินของเกรด ${name} ไม่ถูกต้อง`);
    gradeValues[name] = value;
  });
  const all = { ...toObject(setting?.gradeValues), [method]: gradeValues };
  await prisma.commissionSetting.upsert({
    where: { orgId: input.orgId },
    update: { gradeValues: all, updatedBy: input.userId },
    create: { orgId: input.orgId, gradeValues: all, updatedBy: input.userId },
  });
}

/** ใครได้ค่าคอม: แผนกที่ได้ (ว่าง = ทุกแผนก) + ยกเว้นรายคน — รับเฉพาะ id ของบริษัทนี้ */
export async function saveCommissionEligibility(input: { orgId: string; userId: string; departmentIds: string[]; excludedUserIds: string[] }): Promise<void> {
  const [depts, users] = await Promise.all([
    prisma.department.findMany({ where: { orgId: input.orgId, id: { in: input.departmentIds } }, select: { id: true } }),
    prisma.user.findMany({ where: { orgId: input.orgId, id: { in: input.excludedUserIds } }, select: { id: true } }),
  ]);
  const data = { eligibleDepartmentIds: depts.map((d) => d.id), excludedUserIds: users.map((u) => u.id), updatedBy: input.userId };
  await prisma.commissionSetting.upsert({ where: { orgId: input.orgId }, update: data, create: { orgId: input.orgId, ...data } });
}
