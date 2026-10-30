"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOrg, hasPermission, type OrgSession } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { putFile } from "@/lib/storage";
import { nextRequestCode } from "@/lib/document-code";
import { OT_KEY, updateStoreList } from "@/modules/daily_worker/lib/data";
import { insertAudit as insertDwAudit, logDw } from "@/modules/daily_worker/lib/db";
import type { OtEntry } from "@/modules/daily_worker/lib/types";
import { REQ_PERMS } from "./permissions";
import {
  approverLevelFor,
  canDecide,
  canSee,
  eligibleApprovers,
  employmentOf,
  monthlySalaryOn,
  workerCameOn,
  workerOtOn,
  workerRateOn,
  type Viewer,
} from "./lib/data";
import { dateOnly, insertEvent, loadRequests, pettyBalances, readSettings, withRequestsTenant, withRequestsTenantAfter, ymd, type RequestView, type Tx } from "./lib/db";
import { clearActionNotifications, notifyApprovers, notifyClear, notifyPayers, notifyPettyTopupApprovers, notifyPettyTopupResult, notifyResult } from "./lib/notify";
import { usersWithPermission } from "@/modules/maintenance/data/notify";
import { readReceipt } from "./lib/receipt-ai";
import { PAYROLL_METHOD_BLOCKED, payPrivacy, payrollHandoffBlock, usesSalaryModule } from "./lib/pay-privacy";
import {
  KIND_META,
  METHOD_LABEL,
  addDays,
  advanceCap,
  bangkokToday,
  baht,
  contractorBreakdown,
  hoursText,
  minutesBetween,
  normalizeDate,
  otCalc,
  PETTY_CATEGORIES,
  receiptFlags,
  round2,
  routeText,
  similarSlip,
  thaiDate,
  SIMILAR_SLIP_PREFIX,
  timesOverlap,
  type Attachment,
  type AttachmentRole,
  type BeneficiaryKind,
  type OtBaseKind,
  type PaymentMethod,
  type RequestKind,
  type RequestSettings,
} from "./lib/types";

type Result<T = object> = ({ ok: true } & T) | { ok?: false; error: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_FILE = 12 * 1024 * 1024;

function fail(error: unknown): { error: string } {
  console.error("[requests]", error);
  return { error: error instanceof Error ? error.message : "ทำไม่สำเร็จ" };
}

async function nameOf(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name ?? "";
}

function viewerOf(session: OrgSession): Viewer {
  return {
    userId: session.userId,
    canApprove: hasPermission(session, REQ_PERMS.approve),
    canApproveCeo: hasPermission(session, REQ_PERMS.approveCeo),
    canPay: hasPermission(session, REQ_PERMS.pay),
    isPettyHolder: hasPermission(session, REQ_PERMS.pettyCash),
    canViewAll: hasPermission(session, REQ_PERMS.viewAll),
    canFileOthers: hasPermission(session, REQ_PERMS.fileOthers),
  };
}

async function guard() {
  const session = await requireOrg();
  if (!hasPermission(session, REQ_PERMS.access)) throw new Error("ไม่มีสิทธิ์ใช้งานเบิกจ่าย & OT");
  return session;
}

async function loadOne(tx: Tx, orgId: string, id: string): Promise<RequestView | null> {
  const [r] = await loadRequests(tx, orgId, { id }, 1);
  return r ?? null;
}

/** ผู้ได้เงินที่ควรได้แจ้งเตือน — คนงานเปิดหน้าโมดูลนี้ไม่ได้ (เห็นยอดที่หน้าคนงานแทน) · ช่างภายนอกไม่มีบัญชี */
const staffOnly = (r: Pick<RequestView, "beneficiaryKind" | "beneficiaryUserId">) => (r.beneficiaryKind === "staff" ? r.beneficiaryUserId : null);

const brief = (r: Pick<RequestView, "id" | "code" | "kind" | "title" | "netAmount" | "beneficiaryName">) => ({
  id: r.id,
  code: r.code,
  kind: r.kind,
  title: r.title,
  netAmount: r.netAmount,
  beneficiaryName: r.beneficiaryName,
});

/** ใครอนุมัติใบนี้ ตามจริง — ใบสองขั้นบอกทั้ง HR และ CEO */
const approvedByText = (r: Pick<RequestView, "firstDecidedByName" | "decidedByName">) =>
  r.firstDecidedByName ? `อนุมัติโดย ${r.firstDecidedByName} (HR) → ${r.decidedByName ?? "—"} (CEO)` : `อนุมัติโดย ${r.decidedByName ?? "—"}`;

function refresh(id?: string) {
  revalidatePath("/requests");
  if (id) revalidatePath(`/requests/${id}`);
}

/* ═════════════════════════ ไฟล์แนบ ═════════════════════════ */

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/** ใช้ sha256 ไหนไปแล้วในใบไหน (ทั้งบริษัท) — กันเอาใบเสร็จ/สลิปเดิมมาเบิกซ้ำ */
async function usedHashes(tx: Tx, orgId: string, hashes: string[], exceptRequestId?: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (hashes.length === 0) return out;
  const rows = await tx.$queryRawUnsafe<{ code: string; sha: string }[]>(
    `SELECT r.code, a->>'sha256' AS sha
       FROM requests.requests r, jsonb_array_elements(r.attachments) a
      WHERE r.org_id = $1 AND r.status NOT IN ('rejected', 'cancelled') AND a->>'sha256' = ANY($2::text[])
        AND ($3::text IS NULL OR r.id <> $3::text)
     UNION ALL
     SELECT r.code, s->>'sha256' AS sha
       FROM requests.payments p JOIN requests.requests r ON r.id = p.request_id, jsonb_array_elements(p.slips) s
      WHERE p.org_id = $1 AND p.voided_at IS NULL AND s->>'sha256' = ANY($2::text[])`,
    orgId,
    hashes,
    exceptRequestId ?? null,
  );
  for (const row of rows) if (!out.has(row.sha)) out.set(row.sha, row.code);
  return out;
}

export interface UploadedFile extends Attachment {
  duplicateOf: string | null;
}

/**
 * อัปโหลดไฟล์แนบ (รูป/PDF) — คำนวณลายนิ้วมือไฟล์ (sha256) เช็คว่าเคยใช้เบิกแล้วไหม
 * ใบเสร็จที่เป็นรูป: ให้ AI อ่านยอด/วันที่/ร้าน มาช่วยกรอกและช่วยเตือน
 */
export async function uploadFilesAction(formData: FormData): Promise<Result<{ files: UploadedFile[] }>> {
  try {
    const session = await guard();
    const role = String(formData.get("role") ?? "evidence") as AttachmentRole;
    if (!["evidence", "receipt", "slip", "clearing"].includes(role)) return { error: "ชนิดไฟล์ไม่ถูกต้อง" };
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { error: "ยังไม่ได้เลือกไฟล์" };
    if (files.length > 10) return { error: "ครั้งละไม่เกิน 10 ไฟล์" };
    const byName = await nameOf(session.userId);
    const prepared: { file: File; buf: Buffer; mime: string; sha: string }[] = [];
    for (const file of files) {
      const mime = file.type || "application/octet-stream";
      if (!EXT[mime]) return { error: `${file.name}: รับเฉพาะรูป (JPG/PNG/WEBP/HEIC) หรือ PDF` };
      if (file.size > MAX_FILE) return { error: `${file.name}: ไฟล์ใหญ่เกิน 12MB` };
      const buf = Buffer.from(await file.arrayBuffer());
      prepared.push({ file, buf, mime, sha: createHash("sha256").update(buf).digest("hex") });
    }
    const used = await withRequestsTenant(session.orgId, (tx) => usedHashes(tx, session.orgId, prepared.map((p) => p.sha)));
    const out: UploadedFile[] = [];
    for (const p of prepared) {
      const url = await putFile(`${session.orgId}/requests/${session.userId}`, p.file, { ext: EXT[p.mime] });
      // ใบเสร็จ + สลิปโอน ให้ระบบอ่านยอด/วันที่/เลขอ้างอิง มาช่วยเทียบ (หลักฐานรูปงานไม่ต้องอ่าน)
      const ai = role === "receipt" || role === "clearing" || role === "slip" ? await readReceipt(p.buf, p.mime) : null;
      out.push({
        url,
        name: p.file.name.slice(0, 120),
        mime: p.mime,
        size: p.file.size,
        sha256: p.sha,
        role,
        by: byName,
        at: new Date().toISOString(),
        ai,
        duplicateOf: used.get(p.sha) ?? null,
      });
    }
    return { ok: true, files: out };
  } catch (error) {
    return fail(error);
  }
}

/** ไฟล์ที่ส่งมากับฟอร์ม — รับเฉพาะ URL ของบริษัทนี้ที่อัปโหลดผ่าน uploadFilesAction (ไม่เชื่อค่าอื่นจากหน้าเว็บ) */
function cleanAttachments(orgId: string, list: unknown, roles: AttachmentRole[]): Attachment[] {
  if (!Array.isArray(list)) return [];
  const prefix = `/api/files/${orgId}/requests/`;
  return list
    .filter((a): a is Attachment => !!a && typeof a === "object" && typeof (a as Attachment).url === "string")
    .filter((a) => a.url.startsWith(prefix) && roles.includes(a.role) && /^[a-f0-9]{64}$/.test(a.sha256))
    .slice(0, 20)
    .map((a) => ({
      url: a.url,
      name: String(a.name ?? "").slice(0, 120),
      mime: String(a.mime ?? ""),
      size: Number(a.size) || 0,
      sha256: a.sha256,
      role: a.role,
      by: String(a.by ?? "").slice(0, 80),
      at: String(a.at ?? new Date().toISOString()),
      ai: a.ai ?? null,
    }));
}

/* ═════════════════════════ ดูตัวเลขก่อนส่ง ═════════════════════════ */

export interface PreviewInput {
  kind: RequestKind;
  beneficiaryUserId: string | null;
  workDate: string;
  otStart?: string;
  otEnd?: string;
  otRateId?: string;
  amount?: number;
  /** กำลังแก้ใบนี้ — ไม่นับใบตัวเองเป็น OT ทับเวลา/ยอดเบิกล่วงหน้าที่ใช้ไปแล้ว */
  exceptRequestId?: string;
}

export interface Preview {
  beneficiaryKind: BeneficiaryKind | null;
  beneficiaryName: string | null;
  employmentId: string | null;
  /** OT */
  minutes: number | null;
  baseKind: OtBaseKind | null;
  base: number | null;
  percent: number | null;
  rateLabel: string | null;
  amount: number | null;
  formula: string | null;
  /** ทำไมคิดเองไม่ได้ (ไม่มีเงินเดือนในระบบ) — ให้กรอกเอง */
  needsManual: string | null;
  /** เบิกล่วงหน้า */
  cap: number | null;
  capUsed: number;
  /** ปัญหาที่ส่งไม่ได้ / ข้อเตือน */
  blocks: string[];
  warns: string[];
  approverLevel: "hr" | "ceo" | null;
  /** ยอดเกินเกณฑ์ — HR แล้วต่อ CEO */
  needCeo: boolean;
  approverNames: string[];
  ceoNames: string[];
  /** ยอด OT พนักงานประจำถูกซ่อนจากคนกรอก (บอกเงินเดือนได้ — lib/pay-privacy.ts) */
  payHidden: boolean;
}

async function beneficiaryOf(orgId: string, userId: string | null) {
  if (!userId) return null;
  const u = await prisma.user.findFirst({
    where: { orgId, id: userId, isActive: true },
    select: { id: true, name: true, email: true, roles: { select: { role: { select: { code: true } } } } },
  });
  if (!u) return null;
  const isWorker = u.roles.some((r) => r.role.code === "WORKER");
  return { userId: u.id, name: u.name, email: u.email, kind: (isWorker ? "worker" : "staff") as BeneficiaryKind };
}

/** เบิกล่วงหน้าเดือนนั้นของคนนี้ที่ยังมีผล (รออนุมัติ/อนุมัติ/จ่ายแล้ว) */
async function advanceUsed(tx: Tx, orgId: string, userId: string, month: string, exceptId?: string): Promise<number> {
  const from = dateOnly(`${month}-01`);
  const to = dateOnly(addDays(`${month}-28`, 4).slice(0, 7) + "-01");
  const rows = await tx.moneyRequest.findMany({
    where: { orgId, kind: "advance", beneficiaryUserId: userId, status: { in: ["pending", "approved", "paid"] }, workDate: { gte: from, lt: to }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { netAmount: true },
  });
  return round2(rows.reduce((s, r) => s + Number(r.netAmount), 0));
}

async function computePreview(session: OrgSession, input: PreviewInput, settings: RequestSettings): Promise<Preview> {
  const orgId = session.orgId;
  const p: Preview = {
    beneficiaryKind: null,
    beneficiaryName: null,
    employmentId: null,
    minutes: null,
    baseKind: null,
    base: null,
    percent: null,
    rateLabel: null,
    amount: null,
    formula: null,
    needsManual: null,
    cap: null,
    capUsed: 0,
    blocks: [],
    warns: [],
    approverLevel: null,
    needCeo: false,
    approverNames: [],
    ceoNames: [],
    payHidden: false,
  };
  const today = bangkokToday();
  const date = normalizeDate(input.workDate) || today;
  const who = await beneficiaryOf(orgId, input.beneficiaryUserId);
  if (who) {
    p.beneficiaryKind = who.kind;
    p.beneficiaryName = who.name;
    p.employmentId = await employmentOf(orgId, who.userId, who.email);
  }
  const selfOnly = input.kind === "ot" || input.kind === "advance";
  if (who && selfOnly && who.userId === session.userId) p.blocks.push(input.kind === "ot" ? "ลง OT ให้ตัวเองไม่ได้ — ให้แอดมินเป็นคนลง" : "ขอเบิกล่วงหน้าให้ตัวเองไม่ได้ — ให้ผู้ดูแลบ้านหรือ HR เป็นคนขอ");
  if (who && (input.kind === "expense" || input.kind === "cash_advance") && who.userId === session.userId && hasPermission(session, REQ_PERMS.approveCeo)) {
    p.blocks.push("CEO ไม่ต้องยื่นเบิกของตัวเอง");
  }

  if (input.kind === "ot" && who) {
    if (date > today) p.blocks.push("ลง OT ล่วงหน้าไม่ได้ — ลงหลังทำงานเสร็จแล้ว");
    const start = input.otStart ?? "";
    const end = input.otEnd ?? "";
    if (TIME_RE.test(start) && TIME_RE.test(end)) {
      const minutes = minutesBetween(start, end);
      p.minutes = minutes;
      if (minutes > 16 * 60) p.blocks.push("OT ยาวเกิน 16 ชั่วโมง — ตรวจเวลาอีกครั้ง");
      if (who.kind === "worker") {
        if (!p.employmentId) p.blocks.push("คนงานคนนี้ยังไม่ผูกกับทะเบียนพนักงาน — แจ้ง HR ก่อน");
        else {
          const existing = await workerOtOn(orgId, p.employmentId, date);
          if (existing) p.blocks.push(`มี OT วันนี้ในหน้าคนงานแล้ว (${existing.start}–${existing.end} โดย ${existing.byName}) — ไม่ต้องลงซ้ำ`);
          // ไม่ได้ลงเวลาเข้างาน = ไม่มีหลักฐานว่ามาทำ (บัญชีค่าแรงก็จ่าย OT เฉพาะวันที่มา) — ผู้ใช้ 30/10/2569
          else if (!(await workerCameOn(orgId, p.employmentId, date))) {
            p.blocks.push(`${who.name} ไม่ได้ลงเวลาเข้างานวันที่ ${thaiDate(date)} — ไม่มีหลักฐานว่ามาทำงาน ให้ผู้ดูแลกด "แก้เวลา" ใส่เวลาเข้า-ออกของวันนั้นที่หน้าคนงานรายวันก่อน แล้วค่อยลง OT`);
          }
          const rate = await workerRateOn(orgId, p.employmentId, date);
          p.percent = rate.otPercent;
          p.rateLabel = `% OT ของคนงาน (${rate.otPercent}%)`;
          if (rate.wage) {
            const c = otCalc("daily", rate.wage, rate.otPercent, minutes);
            Object.assign(p, { baseKind: "daily", base: rate.wage, amount: c.amount, formula: c.formula });
          } else {
            p.warns.push("ยังไม่ได้ตั้งค่าแรงของคนงานคนนี้ — ชั่วโมง OT เข้าบัญชีได้ ค่าเงินจะคิดเมื่อ HR ตั้งค่าแรง");
            p.baseKind = "daily";
            p.amount = 0;
          }
        }
      } else {
        const rate = settings.otRates.find((r) => r.id === input.otRateId) ?? settings.otRates[0]!;
        p.percent = rate.percent;
        p.rateLabel = rate.label;
        const salary = p.employmentId ? await monthlySalaryOn(orgId, p.employmentId, date) : null;
        if (salary) {
          const c = otCalc("monthly", salary, rate.percent, minutes);
          Object.assign(p, { baseKind: "monthly", base: salary, amount: c.amount, formula: c.formula });
        } else {
          p.baseKind = "manual";
          p.needsManual = p.employmentId ? "ยังไม่มีเงินเดือนในระบบบุคคล — กรอกค่า OT เอง" : "คนนี้ยังไม่อยู่ในทะเบียนพนักงาน — กรอกค่า OT เอง";
        }
      }
      // OT ใบอื่นของคนเดียวกันวันเดียวกัน เวลาทับกัน
      const others = await withRequestsTenant(orgId, (tx) =>
        tx.moneyRequest.findMany({
          where: { orgId, kind: "ot", beneficiaryUserId: who.userId, workDate: dateOnly(date), status: { in: ["pending", "approved", "paid"] }, ...(input.exceptRequestId ? { id: { not: input.exceptRequestId } } : {}) },
          select: { code: true, otStart: true, otEnd: true },
        }),
      );
      for (const o of others) {
        if (o.otStart && o.otEnd && timesOverlap(start, end, o.otStart, o.otEnd)) p.blocks.push(`เวลาทับกับ ${o.code} (${o.otStart}–${o.otEnd}) — ลงซ้ำไม่ได้`);
      }
    }
  }

  if (input.kind === "advance" && who) {
    let daily: number | null = null;
    if (p.employmentId) {
      if (who.kind === "worker") daily = (await workerRateOn(orgId, p.employmentId, date)).wage;
      else {
        const s = await monthlySalaryOn(orgId, p.employmentId, date);
        daily = s ? round2(s / 30) : null;
      }
    }
    p.cap = advanceCap(settings.advanceCapMode, settings.advanceCapValue, daily);
    if (settings.advanceCapMode === "days" && p.cap === null) p.warns.push("ยังไม่มีค่าแรง/เงินเดือนในระบบ — คิดเพดานแบบจำนวนวันไม่ได้");
    p.capUsed = await withRequestsTenant(orgId, (tx) => advanceUsed(tx, orgId, who.userId, date.slice(0, 7), input.exceptRequestId));
    const amt = Number(input.amount) || 0;
    if (p.cap !== null && p.capUsed + amt > p.cap + 0.005) {
      p.blocks.push(`เกินเพดานเบิกล่วงหน้าเดือนนี้ ${baht(p.cap)} (ใช้ไปแล้ว ${baht(p.capUsed)} เหลือ ${baht(Math.max(0, p.cap - p.capUsed))})`);
    }
  }

  if (who || input.kind === "contractor") {
    const amt = input.kind === "ot" ? (p.amount ?? (Number(input.amount) || 0)) : Number(input.amount) || 0;
    const route = await approverLevelFor(orgId, input.kind, session.userId, who?.userId ?? null, amt, settings.approvalRoutes);
    p.approverLevel = route.level;
    p.needCeo = route.needCeo;
    const ids = await eligibleApprovers(orgId, p.approverLevel, session.userId, who?.userId ?? null);
    const users = ids.length ? await prisma.user.findMany({ where: { orgId, id: { in: ids } }, select: { name: true } }) : [];
    p.approverNames = users.map((u) => u.name);
    if (route.needCeo) {
      const ceoIds = await eligibleApprovers(orgId, "ceo", session.userId, who?.userId ?? null);
      const ceos = ceoIds.length ? await prisma.user.findMany({ where: { orgId, id: { in: ceoIds } }, select: { name: true } }) : [];
      p.ceoNames = ceos.map((u) => u.name);
      if (ceoIds.length === 0) p.blocks.push("ยอดเกินเกณฑ์ต้องให้ CEO อนุมัติต่อ แต่ไม่มี CEO ที่อนุมัติใบนี้ได้");
    }
    if (ids.length === 0) p.blocks.push(p.approverLevel === "ceo" ? "ไม่มี CEO ที่อนุมัติใบนี้ได้ (คนยื่น/ผู้ได้เงินอนุมัติเองไม่ได้)" : "ไม่มี HR ที่อนุมัติใบนี้ได้ — ตั้งสิทธิ์ที่ /admin/roles");
  }
  return p;
}

export async function previewRequestAction(input: PreviewInput): Promise<Result<{ preview: Preview }>> {
  try {
    const session = await guard();
    const settings = await withRequestsTenant(session.orgId, (tx) => readSettings(tx, session.orgId));
    const preview = await computePreview(session, input, settings);
    // OT พนักงานประจำที่คิดจากเงินเดือน: คนกรอก (แอดมิน) เห็นชั่วโมงและ % แต่ไม่เห็นบาท/สูตรเงินเดือน
    if (input.kind === "ot" && preview.beneficiaryKind === "staff" && preview.baseKind === "monthly") {
      const privacy = await payPrivacy(session);
      if (!privacy.canSeeAll && input.beneficiaryUserId !== session.userId) {
        Object.assign(preview, { amount: null, base: null, formula: null, payHidden: true });
      }
    }
    return { ok: true, preview };
  } catch (error) {
    return fail(error);
  }
}

/* ═════════════════════════ ยื่นคำขอ ═════════════════════════ */

export interface CreateInput {
  kind: RequestKind;
  beneficiaryUserId: string | null;
  vendorId?: string | null;
  vendorName?: string;
  title: string;
  detail: string;
  workDate: string;
  otStart?: string;
  otEnd?: string;
  otRateId?: string;
  /** OT ที่คิดจากเงินเดือนไม่ได้ / ยอดเบิก */
  amount?: number;
  lines?: { item: string; amount: number }[];
  propertyId?: string | null;
  workOrderId?: string | null;
  vatOn?: boolean;
  whtPercent?: number;
  attachments: Attachment[];
}

/** ข้อมูลของใบที่ผ่านการตรวจแล้ว — ใช้ทั้งตอนยื่นและตอนแก้ไข (กติกาเดียวกันทุกข้อ) */
interface Prepared {
  fields: {
    title: string;
    detail: string;
    beneficiaryUserId: string | null;
    beneficiaryName: string;
    beneficiaryKind: BeneficiaryKind;
    employmentId: string | null;
    vendorId: string | null;
    propertyId: string | null;
    propertyName: string | null;
    workOrderId: string | null;
    workOrderCode: string | null;
    workDate: Date;
    otStart: string | null;
    otEnd: string | null;
    otMinutes: number | null;
    otPercent: number | null;
    otRateLabel: string | null;
    otBase: number | null;
    otBaseKind: string | null;
    amount: number;
    vatPercent: number;
    vatAmount: number;
    whtPercent: number;
    whtAmount: number;
    netAmount: number;
    lines: { item: string; amount: number }[] | null;
    attachments: Attachment[];
    approverLevel: "hr" | "ceo";
    needCeo: boolean;
  };
  workDate: string;
}

/**
 * advanceDate: วันที่เดิมของใบเบิกล่วงหน้าที่กำลังแก้ — เบิกล่วงหน้าไม่รับวันที่จากหน้าเว็บ
 * (ใบใหม่ = วันนี้เสมอ · แก้ไข = วันที่เดิม) กันย้อนวันไปเดือนก่อนเพื่อหลบเพดานของเดือนนี้
 */
async function prepareRequest(session: OrgSession, input: CreateInput, exceptRequestId?: string, advanceDate?: string): Promise<{ error: string } | Prepared> {
  const orgId = session.orgId;
  const kind = input.kind;
  if (!KIND_META[kind]) return { error: "ประเภทคำขอไม่ถูกต้อง" };
  const fileOthers = hasPermission(session, REQ_PERMS.fileOthers);
  if ((kind === "ot" || kind === "advance" || kind === "contractor") && !fileOthers) return { error: "ไม่มีสิทธิ์ลงรายการนี้ให้คนอื่น" };
  const beneficiaryUserId = kind === "contractor" ? null : (input.beneficiaryUserId || session.userId);
  if (beneficiaryUserId && beneficiaryUserId !== session.userId && !fileOthers) return { error: "ยื่นเบิกได้เฉพาะของตัวเอง" };

  const title = input.title.trim().slice(0, 160);
  if (!title) return { error: kind === "ot" ? "ใส่ว่าทำอะไร" : "ใส่รายการที่ขอเบิก" };
  const detail = input.detail.trim().slice(0, 2000);
  const today = bangkokToday();
  const workDate = kind === "advance" ? (advanceDate ?? today) : normalizeDate(input.workDate);
  if (!workDate) return { error: "วันที่ไม่ถูกต้อง" };
  if (workDate > today) return { error: "เลือกวันที่ในอนาคตไม่ได้" };

  const settings = await withRequestsTenant(orgId, (tx) => readSettings(tx, orgId));
  const preview = await computePreview(
    session,
    { kind, beneficiaryUserId, workDate, otStart: input.otStart, otEnd: input.otEnd, otRateId: input.otRateId, amount: input.amount, exceptRequestId },
    settings,
  );
  if (preview.blocks.length > 0) return { error: preview.blocks[0]! };
  if (kind !== "contractor" && !preview.beneficiaryKind) return { error: "ไม่พบคนที่ได้เงิน" };

  // ไฟล์แนบ
  const allowed: AttachmentRole[] = kind === "ot" || kind === "contractor" ? ["evidence", "receipt"] : kind === "expense" ? ["receipt", "evidence"] : ["evidence", "receipt"];
  const attachments = cleanAttachments(orgId, input.attachments, allowed);
  if (kind === "contractor" && attachments.length === 0) return { error: "แนบใบเสนอราคา/ใบแจ้งหนี้/รูปงาน อย่างน้อย 1 ไฟล์" };
  const receipts = attachments.filter((a) => a.role === "receipt");
  if (kind === "expense" && receipts.length === 0) return { error: "แนบใบเสร็จอย่างน้อย 1 ใบ" };

  // ยอดเงิน
  let amount = 0;
  let vat = { vatPercent: 0, vat: 0, whtPercent: 0, wht: 0, net: 0 };
  let lines: { item: string; amount: number }[] | null = null;
  let vendor: { id: string | null; name: string } | null = null;
  if (kind === "ot") {
    if (preview.baseKind === "manual") {
      amount = round2(Number(input.amount));
      if (!Number.isFinite(amount) || amount <= 0) return { error: "กรอกค่า OT (คิดจากเงินเดือนไม่ได้)" };
    } else amount = preview.amount ?? 0;
  } else if (kind === "contractor") {
    if (input.vendorId) {
      const v = await withRequestsTenant(orgId, (tx) => tx.moneyVendor.findFirst({ where: { orgId, id: input.vendorId!, active: true } }));
      if (!v) return { error: "ไม่พบช่าง/ร้านนี้ในทะเบียน" };
      vendor = { id: v.id, name: v.name };
    } else {
      const name = (input.vendorName ?? "").trim().slice(0, 120);
      if (!name) return { error: "เลือกหรือพิมพ์ชื่อช่าง/ร้าน" };
      vendor = { id: null, name };
    }
    const base = round2(Number(input.amount));
    if (!Number.isFinite(base) || base <= 0) return { error: "กรอกค่าจ้าง (ก่อน VAT)" };
    const whtPercent = Number(input.whtPercent ?? 0);
    if (!Number.isFinite(whtPercent) || whtPercent < 0 || whtPercent > 15) return { error: "% หัก ณ ที่จ่ายไม่ถูกต้อง" };
    const b = contractorBreakdown(base, input.vatOn ? settings.vatPercent : 0, whtPercent);
    amount = b.base;
    vat = { vatPercent: b.vatPercent, vat: b.vat, whtPercent: b.whtPercent, wht: b.wht, net: b.net };
  } else {
    const cleanLines = (input.lines ?? [])
      .map((l) => ({ item: String(l.item ?? "").trim().slice(0, 120), amount: round2(Number(l.amount)) }))
      .filter((l) => l.item && Number.isFinite(l.amount) && l.amount > 0)
      .slice(0, 30);
    amount = cleanLines.length > 0 ? round2(cleanLines.reduce((s, l) => s + l.amount, 0)) : round2(Number(input.amount));
    if (cleanLines.length > 0) lines = cleanLines;
    if (!Number.isFinite(amount) || amount <= 0) return { error: "กรอกจำนวนเงิน" };
    if (amount > 1_000_000) return { error: "จำนวนเงินสูงเกินไป ตรวจอีกครั้ง" };
  }
  const net = kind === "contractor" ? vat.net : amount;

  // ใบเสร็จ: วันที่ในอนาคต / ไฟล์ซ้ำกับใบอื่น (เช็คซ้ำฝั่งเซิร์ฟเวอร์ ไม่เชื่อธงจากหน้าเว็บ · ไม่นับใบตัวเอง)
  const used = await withRequestsTenant(orgId, (tx) => usedHashes(tx, orgId, attachments.map((a) => a.sha256), exceptRequestId));
  for (const a of attachments) {
    const flags = receiptFlags(a, { claimDate: workDate, today, maxAgeDays: settings.receiptMaxAgeDays, duplicateOf: used.get(a.sha256) ?? null });
    const block = flags.find((f) => f.level === "block");
    if (block) return { error: `${a.name}: ${block.text}` };
  }

  // บ้าน / ใบงาน
  let property: { id: string; name: string } | null = null;
  let workOrder: { id: string; code: string; propertyId: string } | null = null;
  if (input.workOrderId) {
    workOrder = await prisma.workOrder.findFirst({ where: { orgId, id: input.workOrderId }, select: { id: true, code: true, propertyId: true } });
    if (!workOrder) return { error: "ไม่พบใบงานที่เลือก" };
  }
  const propertyId = input.propertyId || workOrder?.propertyId || null;
  if (propertyId) {
    property = await prisma.property.findFirst({ where: { orgId, id: propertyId }, select: { id: true, name: true } });
  }

  // เส้นทางคิดจากยอดจริงที่จะบันทึก (ไม่ใช้ของ preview ที่คิดจากยอดตอนพิมพ์)
  // ช่างภายนอก: เทียบเกณฑ์ CEO กับยอดตามบิลร้าน (ค่าจ้าง + VAT ก่อนหัก ณ ที่จ่าย) — ผู้ใช้ 30/10/2569 "ตามยอดจริงก่อนหักลบ"
  const routeAmount = kind === "contractor" ? round2(amount + vat.vat) : net;
  const { level, needCeo } = await approverLevelFor(orgId, kind, session.userId, beneficiaryUserId, routeAmount, settings.approvalRoutes);
  const isOt = kind === "ot";
  return {
    workDate,
    fields: {
      title,
      detail,
      beneficiaryUserId,
      beneficiaryName: kind === "contractor" ? vendor!.name : preview.beneficiaryName!,
      beneficiaryKind: kind === "contractor" ? "vendor" : preview.beneficiaryKind!,
      employmentId: preview.employmentId,
      vendorId: vendor?.id ?? null,
      propertyId: property?.id ?? null,
      propertyName: property?.name ?? null,
      workOrderId: workOrder?.id ?? null,
      workOrderCode: workOrder?.code ?? null,
      workDate: dateOnly(workDate),
      otStart: isOt ? input.otStart! : null,
      otEnd: isOt ? input.otEnd! : null,
      otMinutes: isOt ? preview.minutes : null,
      otPercent: isOt ? preview.percent : null,
      otRateLabel: isOt ? preview.rateLabel : null,
      otBase: isOt ? preview.base : null,
      otBaseKind: isOt ? preview.baseKind : null,
      amount,
      vatPercent: vat.vatPercent,
      vatAmount: vat.vat,
      whtPercent: vat.whtPercent,
      whtAmount: vat.wht,
      netAmount: net,
      lines,
      attachments,
      approverLevel: level,
      needCeo,
    },
  };
}

export async function createRequestAction(input: CreateInput): Promise<Result<{ id: string; code: string }>> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const kind = input.kind;
    const prep = await prepareRequest(session, input);
    if ("error" in prep) return prep;
    const f = prep.fields;
    const byName = await nameOf(session.userId);
    const created = await withRequestsTenantAfter(
      orgId,
      (tx) => nextRequestCode(tx, orgId),
      async (tx, code) => {
        const { lines, attachments, ...rest } = f;
        const row = await tx.moneyRequest.create({
          data: {
            orgId,
            code,
            kind,
            ...rest,
            ...(lines ? { lines } : {}),
            attachments: attachments as unknown as object,
            createdBy: session.userId,
            createdByName: byName,
          },
        });
        const summary =
          kind === "ot"
            ? `ลง OT ให้ ${f.beneficiaryName} ${thai(prep.workDate)} ${f.otStart}–${f.otEnd} (${hoursText(f.otMinutes ?? 0)}) ${baht(f.netAmount)}`
            : `ยื่น${KIND_META[kind].label} ${baht(f.netAmount)} ให้ ${f.beneficiaryName}`;
        await insertEvent(tx, orgId, { requestId: row.id, byUserId: session.userId, byName, action: "create", summary });
        return { id: row.id, code: row.code };
      },
    );
    void notifyApprovers(orgId, { id: created.id, code: created.code, kind, title: f.title, netAmount: f.netAmount, beneficiaryName: f.beneficiaryName }, f.approverLevel, [session.userId, f.beneficiaryUserId ?? ""]);
    refresh();
    return { ok: true, ...created };
  } catch (error) {
    return fail(error);
  }
}

/**
 * แก้ไขใบที่ยังรออนุมัติ — เฉพาะคนยื่น และยังไม่มีใครตัดสิน (รวมถึงขั้นแรกของ HR ในใบสองขั้น)
 * ตรวจใหม่ทุกข้อเหมือนตอนยื่น (ไม่นับใบตัวเองเป็นของซ้ำ) · เส้นทางอนุมัติคิดใหม่จากยอดใหม่
 * ใบที่อนุมัติแล้วแก้ไม่ได้ (ผู้ใช้ตกลง 21/10/2569) — จ่ายน้อยกว่าทำตอนบันทึกจ่าย มากกว่าต้องยื่นใหม่
 */
export async function updateRequestAction(id: string, input: CreateInput): Promise<Result<{ id: string }>> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const old = await withRequestsTenant(orgId, (tx) => loadOne(tx, orgId, id));
    if (!old) return { error: "ไม่พบคำขอ" };
    if (old.createdBy !== session.userId) return { error: "แก้ได้เฉพาะคนที่ยื่นใบนี้" };
    if (old.status !== "pending" || old.firstDecidedAt) return { error: "ใบนี้มีคนตัดสินแล้ว แก้ไม่ได้ — ยกเลิกแล้วยื่นใหม่" };
    if (input.kind !== old.kind) return { error: "เปลี่ยนประเภทของใบไม่ได้ — ยกเลิกแล้วยื่นใหม่" };
    const prep = await prepareRequest(session, input, id, old.kind === "advance" ? old.workDate : undefined);
    if ("error" in prep) return prep;
    const f = prep.fields;

    // สรุปว่าแก้อะไร ให้ผู้อนุมัติเห็นในประวัติ
    const changes: string[] = [];
    if (Math.abs(old.netAmount - f.netAmount) > 0.005) changes.push(`ยอด ${baht(old.netAmount)} → ${baht(f.netAmount)}`);
    if (old.title !== f.title) changes.push(`รายการ "${old.title}" → "${f.title}"`);
    if (old.beneficiaryName !== f.beneficiaryName) changes.push(`ของ ${old.beneficiaryName} → ${f.beneficiaryName}`);
    if (old.workDate !== prep.workDate) changes.push(`วันที่ ${thai(old.workDate)} → ${thai(prep.workDate)}`);
    if (old.otStart !== f.otStart || old.otEnd !== f.otEnd) changes.push(`เวลา ${old.otStart ?? "—"}–${old.otEnd ?? "—"} → ${f.otStart ?? "—"}–${f.otEnd ?? "—"}`);
    const oldFiles = new Set(old.attachments.map((a) => a.sha256));
    const newFiles = new Set(f.attachments.map((a) => a.sha256));
    const added = [...newFiles].filter((x) => !oldFiles.has(x)).length;
    const removed = [...oldFiles].filter((x) => !newFiles.has(x)).length;
    if (added) changes.push(`แนบไฟล์เพิ่ม ${added}`);
    if (removed) changes.push(`เอาไฟล์ออก ${removed}`);
    if (old.detail !== f.detail) changes.push("แก้รายละเอียด");
    if ((old.propertyId ?? null) !== f.propertyId || (old.workOrderId ?? null) !== f.workOrderId) changes.push("แก้บ้าน/ใบงาน");
    if (old.approverLevel !== f.approverLevel || old.needCeo !== f.needCeo) {
      changes.push(f.needCeo ? "ยอดเกินเกณฑ์ ต้องผ่าน CEO ด้วย" : f.approverLevel === "ceo" ? "ผู้อนุมัติเปลี่ยนเป็น CEO" : "ผู้อนุมัติเปลี่ยนเป็น HR");
    }
    if (changes.length === 0) return { ok: true, id };

    const byName = await nameOf(session.userId);
    const saved = await withRequestsTenant(orgId, async (tx) => {
      const { lines, attachments, ...rest } = f;
      // แก้ได้เฉพาะตอนยังไม่มีใครตัดสิน — กันกดแก้พร้อมกับที่ HR กำลังอนุมัติ
      const res = await tx.moneyRequest.updateMany({
        where: { orgId, id, status: "pending", firstDecidedAt: null },
        data: { ...rest, lines: lines ?? [], attachments: attachments as unknown as object },
      });
      if (res.count === 0) return false;
      await insertEvent(tx, orgId, { requestId: id, byUserId: session.userId, byName, action: "edit", summary: `แก้ไข: ${changes.join(" · ")}` });
      return true;
    });
    if (!saved) return { error: "มีคนตัดสินใบนี้ไปก่อนแล้ว — แก้ไม่ได้" };

    // แจ้งเตือนเดิม (ยอดเก่า) หายไป แจ้งใหม่ด้วยยอดใหม่ — ผู้อนุมัติอาจเปลี่ยนตามยอด
    await clearActionNotifications(orgId, id, ["req_pending"]);
    void notifyApprovers(orgId, { id, code: old.code, kind: old.kind, title: f.title, netAmount: f.netAmount, beneficiaryName: f.beneficiaryName }, f.approverLevel, [session.userId, f.beneficiaryUserId ?? ""], "แก้ไขแล้ว รออนุมัติ");
    refresh(id);
    return { ok: true, id };
  } catch (error) {
    return fail(error);
  }
}

const thai = (d: string) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return `${day}/${m}/${y + 543}`;
};

/* ═════════════════════════ อนุมัติ / ไม่อนุมัติ / ยกเลิก ═════════════════════════ */

export async function decideRequestAction(input: { id: string; outcome: "approve" | "reject"; note: string; version?: string }): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const viewer = viewerOf(session);
    const note = input.note.trim().slice(0, 500);
    if (input.outcome === "reject" && !note) return { error: "ไม่อนุมัติต้องใส่เหตุผล" };
    const byName = await nameOf(session.userId);
    const r = await withRequestsTenant(orgId, (tx) => loadOne(tx, orgId, input.id));
    if (!r) return { error: "ไม่พบคำขอ" };
    if (!canDecide(r, viewer)) return { error: r.status !== "pending" ? "ใบนี้ตัดสินไปแล้ว" : "คุณอนุมัติใบนี้ไม่ได้ (ใบของตัวเอง หรือต้องเป็น CEO)" };
    // คนยื่นเพิ่งแก้ใบระหว่างที่เปิดดูอยู่ — ไม่ให้อนุมัติยอดเก่าที่เห็นบนจอ
    if (input.version && input.version !== r.updatedAt) return { error: "ใบนี้เพิ่งถูกแก้ไข — โหลดหน้าใหม่เพื่อดูยอดล่าสุดก่อนตัดสิน" };

    // ใบยอดเกินเกณฑ์: HR อนุมัติขั้นแรก → ส่งต่อ CEO (ยังไม่มีผล) · CEO กดเองตั้งแต่ขั้นแรก = จบทีเดียว
    if (input.outcome === "approve" && r.approverLevel === "hr" && r.needCeo && !viewer.canApproveCeo) {
      const moved = await withRequestsTenant(orgId, async (tx) => {
        const res = await tx.moneyRequest.updateMany({
          where: { orgId, id: r.id, status: "pending", approverLevel: "hr" },
          data: { approverLevel: "ceo", firstDecidedBy: session.userId, firstDecidedByName: byName, firstDecidedAt: new Date(), firstDecisionNote: note || null },
        });
        if (res.count === 0) return false;
        await insertEvent(tx, orgId, { requestId: r.id, byUserId: session.userId, byName, action: "approve", summary: `HR อนุมัติขั้นแรก → ส่งต่อ CEO (ยอดเกินเกณฑ์)${note ? ` · ${note}` : ""}` });
        return true;
      });
      if (!moved) return { error: "มีคนตัดสินใบนี้ไปก่อนแล้ว — รีเฟรช" };
      await clearActionNotifications(orgId, r.id, ["req_pending"]);
      void notifyApprovers(orgId, brief(r), "ceo", [r.createdBy, r.beneficiaryUserId ?? "", session.userId]);
      void notifyResult(orgId, brief(r), [r.createdBy, staffOnly(r)], "HR ผ่านแล้ว รอ CEO");
      refresh(r.id);
      return { ok: true };
    }

    // OT ของคนงาน: อนุมัติ = ลงชั่วโมง OT ในโมดูลคนงาน (ยอดเงินคิดที่บัญชีค่าแรงตามกติกาเดิม)
    let dwOtEntryId: string | null = null;
    const workerOt = input.outcome === "approve" && r.kind === "ot" && r.beneficiaryKind === "worker";
    if (workerOt) {
      if (!r.employmentId || !r.otStart || !r.otEnd || !r.otMinutes) return { error: "ข้อมูล OT ของคนงานไม่ครบ" };
      const existing = await workerOtOn(orgId, r.employmentId, r.workDate);
      if (existing) return { error: `มี OT วันนี้ในหน้าคนงานแล้ว (${existing.start}–${existing.end} โดย ${existing.byName}) — ไม่อนุมัติใบนี้เพื่อกันจ่ายซ้ำ` };
      // ตรวจซ้ำตอนอนุมัติ (ใบที่ยื่นไว้ก่อนมีกติกานี้ / ลงเวลาถูกยกเลิกทีหลัง) — อนุมัติไปแล้วบัญชีค่าแรงจะได้ 0 แต่ใบขึ้นว่าจ่ายแล้ว
      if (!(await workerCameOn(orgId, r.employmentId, r.workDate))) {
        return { error: `${r.beneficiaryName} ไม่ได้ลงเวลาเข้างานวันที่ ${thaiDate(r.workDate)} — ให้ผู้ดูแลกด "แก้เวลา" ใส่เวลาเข้า-ออกของวันนั้นที่หน้าคนงานรายวันก่อน แล้วค่อยอนุมัติ (หรือไม่อนุมัติพร้อมเหตุผล)` };
      }
      dwOtEntryId = randomUUID();
      const entry: OtEntry = {
        id: dwOtEntryId,
        employmentId: r.employmentId,
        date: r.workDate,
        start: r.otStart,
        end: r.otEnd,
        minutes: r.otMinutes,
        note: `${r.code} ${r.title}`.slice(0, 200),
        byUserId: session.userId,
        byName,
        at: new Date().toISOString(),
      };
      let clash = false;
      await updateStoreList<OtEntry>(orgId, OT_KEY, session.userId, (list) => {
        if (list.some((o) => o.employmentId === entry.employmentId && o.date === entry.date)) {
          clash = true;
          return list;
        }
        return [...list, entry];
      });
      if (clash) return { error: "มีคนเพิ่งลง OT วันนี้ให้คนงานคนนี้ในหน้าคนงาน — รีเฟรชแล้วตรวจอีกครั้ง" };
    }

    // ชั่วโมง OT ลงบัญชีคนงานไปก่อนแล้ว — ใบเปลี่ยนสถานะไม่สำเร็จ (มีคนกดไม่อนุมัติ/ยกเลิกพร้อมกัน หรือ error) ต้องถอนออก
    // ไม่งั้นคนงานได้ค่า OT ของใบที่ไม่ได้อนุมัติ
    const undoWorkerOt = async () => {
      if (!dwOtEntryId) return;
      await updateStoreList<OtEntry>(orgId, OT_KEY, session.userId, (list) => list.filter((o) => o.id !== dwOtEntryId)).catch((error: unknown) =>
        console.error("[requests] undo worker OT failed", dwOtEntryId, error),
      );
    };
    let changed: boolean;
    try {
      changed = await withRequestsTenant(orgId, async (tx) => {
        const res = await tx.moneyRequest.updateMany({
          where: { orgId, id: r.id, status: "pending" },
          data: {
            status: input.outcome === "reject" ? "rejected" : workerOt ? "paid" : "approved",
            decidedBy: session.userId,
            decidedByName: byName,
            decidedAt: new Date(),
            decisionNote: note || null,
            ...(dwOtEntryId ? { dwOtEntryId } : {}),
          },
        });
        if (res.count === 0) return false;
        if (workerOt && r.netAmount > 0) {
          await tx.moneyRequestPayment.create({
            data: { orgId, requestId: r.id, amount: r.netAmount, method: "worker_ledger", paidOn: dateOnly(r.workDate), note: "เข้าบัญชีค่าแรงคนงาน", byUserId: session.userId, byName },
          });
        }
        await insertEvent(tx, orgId, {
          requestId: r.id,
          byUserId: session.userId,
          byName,
          action: input.outcome === "reject" ? "reject" : "approve",
          summary: input.outcome === "reject" ? `ไม่อนุมัติ · ${note}` : `อนุมัติ${workerOt ? " · ลง OT ในบัญชีคนงานแล้ว" : ""}${note ? ` · ${note}` : ""}`,
        });
        return true;
      });
    } catch (error) {
      await undoWorkerOt();
      throw error;
    }
    if (!changed) {
      await undoWorkerOt();
      return { error: "มีคนตัดสินใบนี้ไปก่อนแล้ว — รีเฟรช" };
    }
    if (workerOt && r.employmentId) {
      await logDw(orgId, {
        byUserId: session.userId,
        byName,
        action: "ot",
        employmentIds: [r.employmentId],
        workDate: r.workDate,
        summary: `OT จากคำขอ ${r.code} ${r.otStart}–${r.otEnd} (${hoursText(r.otMinutes ?? 0)}) · อนุมัติโดย ${byName}`,
      });
    }

    await clearActionNotifications(orgId, r.id, ["req_pending"]);
    const b = brief(r);
    const people = [r.createdBy, staffOnly(r)];
    if (input.outcome === "reject") void notifyResult(orgId, b, people, "ไม่อนุมัติ", note);
    else {
      void notifyResult(orgId, b, people, workerOt ? "อนุมัติ OT แล้ว (เข้าบัญชีค่าแรงคนงาน)" : "อนุมัติแล้ว");
      if (!workerOt) void notifyPayers(orgId, b, [r.beneficiaryUserId ?? "", session.userId]);
    }
    refresh(r.id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelRequestAction(input: { id: string; reason: string }): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const viewer = viewerOf(session);
    const reason = input.reason.trim().slice(0, 300);
    if (!reason) return { error: "ใส่เหตุผลที่ยกเลิก" };
    const byName = await nameOf(session.userId);
    const r = await withRequestsTenant(orgId, (tx) => loadOne(tx, orgId, input.id));
    if (!r || !canSee(r, viewer)) return { error: "ไม่พบคำขอ" };
    const manager = viewer.canApprove || viewer.canApproveCeo || viewer.canPay;
    if (r.status === "rejected" || r.status === "cancelled") return { error: "ใบนี้จบไปแล้ว" };
    if (r.status === "pending" && r.createdBy !== session.userId && !manager) return { error: "ยกเลิกได้เฉพาะคนยื่น หรือ HR" };
    if (r.status !== "pending" && !manager) return { error: "ใบที่อนุมัติแล้ว ยกเลิกได้เฉพาะ HR/CEO" };
    const workerLedger = r.kind === "ot" && r.beneficiaryKind === "worker" && r.status === "paid";
    const realPaid = r.payments.some((p) => !p.voided && p.method !== "worker_ledger");
    if (realPaid) return { error: "ใบนี้จ่ายเงินไปแล้ว — ยกเลิกการจ่ายก่อน แล้วค่อยยกเลิกใบ" };

    if (workerLedger && r.dwOtEntryId && r.employmentId) {
      await updateStoreList<OtEntry>(orgId, OT_KEY, session.userId, (list) => list.filter((o) => o.id !== r.dwOtEntryId));
      await logDw(orgId, { byUserId: session.userId, byName, action: "ot_delete", employmentIds: [r.employmentId], workDate: r.workDate, summary: `ยกเลิก OT จากคำขอ ${r.code} · ${reason}` });
    }
    await withRequestsTenant(orgId, async (tx) => {
      await tx.moneyRequest.update({ where: { id: r.id }, data: { status: "cancelled", cancelledByName: byName, cancelledAt: new Date(), cancelReason: reason } });
      for (const p of r.payments.filter((x) => !x.voided && x.method === "worker_ledger")) {
        await tx.moneyRequestPayment.update({ where: { id: p.id }, data: { voidedAt: new Date(), voidedByName: byName, voidReason: `ยกเลิกใบ: ${reason}` } });
      }
      await insertEvent(tx, orgId, { requestId: r.id, byUserId: session.userId, byName, action: "cancel", summary: `ยกเลิก · ${reason}` });
    });
    await clearActionNotifications(orgId, r.id, ["req_pending", "req_to_pay", "req_clear"]);
    if (r.createdBy !== session.userId) void notifyResult(orgId, brief(r), [r.createdBy, staffOnly(r)], "ยกเลิกแล้ว", reason);
    refresh(r.id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ═════════════════════════ จ่ายเงิน ═════════════════════════ */

export interface PayInput {
  id: string;
  amount: number;
  method: PaymentMethod;
  paidOn: string;
  pettyHolderId?: string | null;
  payrollPeriod?: string | null;
  note: string;
  slips: Attachment[];
  /** จ่ายน้อยกว่ายอดแล้วปิดใบเลย (ไม่จ่ายส่วนที่เหลือ) */
  closeShort?: boolean;
  /** HR ยืนยันแล้วว่าสลิปที่คล้ายใบก่อนเป็นคนละรายการ */
  confirmSimilar?: boolean;
}

export async function recordPaymentAction(input: PayInput): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const viewer = viewerOf(session);
    const byName = await nameOf(session.userId);
    const r = await withRequestsTenant(orgId, (tx) => loadOne(tx, orgId, input.id));
    if (!r) return { error: "ไม่พบคำขอ" };
    if (r.status !== "approved") return { error: r.status === "pending" ? "ใบนี้ยังไม่อนุมัติ" : "ใบนี้จ่ายครบ/จบไปแล้ว" };
    if (r.kind === "ot" && r.beneficiaryKind === "worker") return { error: "OT ของคนงานจ่ายผ่านบัญชีค่าแรง" };
    if (r.beneficiaryUserId === session.userId) return { error: "บันทึกจ่ายเงินให้ตัวเองไม่ได้ — ให้ HR อีกคนหรือคนถือเงินสดย่อยเป็นคนจ่าย" };
    const method = input.method;
    if (!METHOD_LABEL[method] || method === "worker_ledger") return { error: "วิธีจ่ายไม่ถูกต้อง" };
    const pettyHolderId = method === "petty_cash" ? input.pettyHolderId || session.userId : null;
    const allowed = viewer.canPay || (method === "petty_cash" && viewer.isPettyHolder && pettyHolderId === session.userId);
    if (!allowed) return { error: "ไม่มีสิทธิ์บันทึกจ่ายเงิน (คนถือเงินสดย่อยจ่ายได้จากเงินสดย่อยของตัวเอง)" };
    if (method === "payroll" && r.beneficiaryKind !== "staff") return { error: "รวมกับเงินเดือนได้เฉพาะพนักงานประจำ" };
    if (method === "payroll" && r.kind === "advance") return { error: "เบิกล่วงหน้าต้องจ่ายเป็นเงินจริง (หักคืนทีหลังในเงินเดือน)" };
    if (method === "payroll" && (await usesSalaryModule(orgId))) return { error: PAYROLL_METHOD_BLOCKED };
    const paidOn = normalizeDate(input.paidOn);
    if (!paidOn || paidOn > bangkokToday()) return { error: "วันที่จ่ายไม่ถูกต้อง" };
    const amount = round2(Number(input.amount));
    const outstanding = round2(r.netAmount - r.paidTotal);
    if (!Number.isFinite(amount) || amount <= 0) return { error: "กรอกจำนวนเงินที่จ่าย" };
    if (amount > outstanding + 0.005) return { error: `จ่ายเกินยอดค้าง (${baht(outstanding)})` };
    const note = input.note.trim().slice(0, 300);
    const short = amount < outstanding - 0.005;
    if (short && !note) return { error: "จ่ายน้อยกว่ายอดที่อนุมัติ — ใส่เหตุผล" };
    const slips = cleanAttachments(orgId, input.slips, ["slip"]);
    if (method !== "payroll" && slips.length === 0) return { error: method === "transfer" ? "แนบสลิปโอน" : "แนบรูปหลักฐานรับเงิน (เช่นรูปเซ็นรับเงินสด)" };
    const payrollPeriod = method === "payroll" ? (input.payrollPeriod && /^\d{4}-\d{2}$/.test(input.payrollPeriod) ? input.payrollPeriod : paidOn.slice(0, 7)) : null;
    const settings = await withRequestsTenant(orgId, (tx) => readSettings(tx, orgId));
    const holderName = pettyHolderId ? await nameOf(pettyHolderId) : "";

    const result = await withRequestsTenant(orgId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`req-pay:${r.id}`}))`;
      const fresh = await loadOne(tx, orgId, r.id);
      if (!fresh || fresh.status !== "approved" || Math.abs(fresh.paidTotal - r.paidTotal) > 0.005) return "raced" as const;
      const used = await usedHashes(tx, orgId, slips.map((s) => s.sha256));
      const dup = slips.find((s) => used.has(s.sha256));
      if (dup) return `dup:${used.get(dup.sha256)}` as const;
      // เลขอ้างอิงสลิปเดียวกัน (ถ่ายใหม่/แคปใหม่ ไฟล์ไม่ซ้ำ แต่เป็นรายการโอนเดิม) — ใช้ซ้ำไม่ได้
      const refs = slips.map((x) => x.ai?.receiptNo?.replace(/\s+/g, "")).filter((x): x is string => !!x && x.length >= 6);
      if (refs.length > 0) {
        const rows = await tx.$queryRawUnsafe<{ code: string }[]>(
          `SELECT r.code FROM requests.payments p JOIN requests.requests r ON r.id = p.request_id, jsonb_array_elements(p.slips) s
            WHERE p.org_id = $1 AND p.voided_at IS NULL AND regexp_replace(s->'ai'->>'receiptNo', '[[:space:]]+', '', 'g') = ANY($2::text[]) LIMIT 1`,
          orgId,
          refs,
        );
        if (rows[0]) return `dup:${rows[0].code} (เลขอ้างอิงเดียวกัน)` as const;
      }
      // เลขอ้างอิงใกล้เคียง (AI อ่านพลาด 1–3 ตัว) + ยอดและวันเดียวกัน → ถาม HR ก่อน ไม่บล็อกตาย (เลขธนาคารที่เรียงติดกันก็ต่างกันน้อยได้)
      if (!input.confirmSimilar) {
        const reads = slips.map((x) => x.ai).filter((x): x is NonNullable<typeof x> => !!x?.receiptNo && x.amount !== null && !!x.date);
        if (reads.length > 0) {
          const old = await tx.$queryRawUnsafe<{ code: string; ai: Attachment["ai"] }[]>(
            `SELECT r.code, s->'ai' AS ai FROM requests.payments p JOIN requests.requests r ON r.id = p.request_id, jsonb_array_elements(p.slips) s
              WHERE p.org_id = $1 AND p.voided_at IS NULL AND s->'ai'->>'date' = ANY($2::text[])`,
            orgId,
            reads.map((x) => x.date!),
          );
          const hit = old.find((o) => reads.some((n) => similarSlip(n, o.ai)));
          if (hit) return `similar:${hit.code}` as const;
        }
      }
      if (method === "petty_cash") {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`petty:${orgId}:${pettyHolderId}`}))`;
        const bal = (await pettyBalances(tx, orgId)).get(pettyHolderId!) ?? 0;
        if (bal + 0.005 < amount) return `petty:${bal}` as const;
      }
      const pay = await tx.moneyRequestPayment.create({
        data: { orgId, requestId: r.id, amount, method, paidOn: dateOnly(paidOn), pettyHolderId, payrollPeriod, slips: slips as unknown as object, note, byUserId: session.userId, byName },
      });
      if (method === "petty_cash") {
        await tx.moneyPettyCashEntry.create({
          data: { orgId, holderUserId: pettyHolderId!, holderName: holderName || byName, kind: "spend", delta: -amount, requestId: r.id, paymentId: pay.id, note: `${r.code} ${r.title}`.slice(0, 200), byUserId: session.userId, byName },
        });
      }
      let dwPaymentId: string | null = null;
      if (r.kind === "advance" && r.beneficiaryKind === "worker" && r.employmentId) {
        // เบิกล่วงหน้าของคนงาน = รายการ "เบิกล่วงหน้า" ในบัญชีค่าแรง — ยอดติดลบ หักจากค่าแรงวันถัดไปเอง
        const dw = await tx.dailyWorkerPayment.create({
          data: { orgId, employmentId: r.employmentId, payDate: dateOnly(paidOn), amount, kind: "advance", note: `${r.code} เบิกล่วงหน้า: ${r.title}`.slice(0, 200), byUserId: session.userId, byName },
        });
        dwPaymentId = dw.id;
        await insertDwAudit(tx, orgId, { byUserId: session.userId, byName, action: "payment", employmentIds: [r.employmentId], workDate: paidOn, summary: `เบิกล่วงหน้า ${baht(amount, false)} บาท จากคำขอ ${r.code} (${approvedByText(r)})` });
      }
      const paidTotal = round2(r.paidTotal + amount);
      const full = paidTotal >= r.netAmount - 0.005 || (short && input.closeShort === true);
      await tx.moneyRequest.update({
        where: { id: r.id },
        data: {
          ...(full ? { status: "paid" } : {}),
          ...(short && input.closeShort ? { netAmount: paidTotal } : {}),
          ...(dwPaymentId ? { dwPaymentId } : {}),
          ...(r.kind === "advance" && r.beneficiaryKind === "staff" ? { deductAmount: round2(r.deductAmount + amount) } : {}),
          ...(r.kind === "cash_advance" && !r.clearDueDate ? { clearDueDate: dateOnly(addDays(paidOn, settings.clearDueDays)) } : {}),
        },
      });
      await insertEvent(tx, orgId, {
        requestId: r.id,
        byUserId: session.userId,
        byName,
        action: "pay",
        summary: `จ่าย ${baht(amount)} (${METHOD_LABEL[method]}${payrollPeriod ? ` งวด ${payrollPeriod}` : ""})${short ? ` · ${input.closeShort ? "ปิดยอดไม่จ่ายส่วนที่เหลือ" : "จ่ายบางส่วน"}: ${note}` : note ? ` · ${note}` : ""}`,
      });
      return full ? ("full" as const) : ("partial" as const);
    });
    if (result === "raced") return { error: "มีคนเพิ่งบันทึกจ่ายใบนี้ — รีเฟรชดูยอดล่าสุด" };
    if (typeof result === "string" && result.startsWith("dup:")) return { error: `สลิปนี้เคยใช้แล้วใน ${result.slice(4)}` };
    if (typeof result === "string" && result.startsWith("similar:")) {
      return { error: `${SIMILAR_SLIP_PREFIX}${result.slice(8)}|สลิปนี้คล้ายกับสลิปที่ใช้จ่ายใน ${result.slice(8)} (ยอดและวันเดียวกัน เลขอ้างอิงต่างกันนิดเดียว) — ถ้าแน่ใจว่าเป็นคนละรายการ กดยืนยัน` };
    }
    if (typeof result === "string" && result.startsWith("petty:")) return { error: `เงินสดย่อยเหลือ ${baht(Number(result.slice(6)))} ไม่พอจ่าย — เติมเงินก่อน` };

    if (result === "full") {
      await clearActionNotifications(orgId, r.id, ["req_to_pay"]);
      if (r.kind === "expense" || r.kind === "contractor") await linkMaintenanceExpense(orgId, r, session.userId, r.kind === "contractor" ? round2(r.amount + r.vatAmount) : r.netAmount);
    }
    if (r.kind === "cash_advance" && result === "full") {
      // แจ้งอันเดียว — บอกทั้งว่าได้เงินแล้ว และต้องส่งใบเสร็จ + เงินทอนเมื่อไหร่
      void notifyClear(orgId, brief(r), [staffOnly(r)], `จ่ายแล้ว ${baht(amount)} · ส่งใบเสร็จ + เงินทอนภายใน ${settings.clearDueDays} วัน`);
    } else if (method !== "payroll") {
      void notifyResult(orgId, brief(r), [staffOnly(r)], "จ่ายเงินแล้ว", `${baht(amount)} · ${METHOD_LABEL[method]} — กด "ได้รับเงินแล้ว" ในใบ`);
    }
    // ใบช่างภายนอก: ไม่มีผู้รับในระบบ — แจ้งคนที่ลงใบให้รู้ว่าจ่ายร้านแล้ว
    if (r.beneficiaryKind === "vendor" && r.createdBy !== session.userId) void notifyResult(orgId, brief(r), [r.createdBy], "จ่ายร้านแล้ว", `${baht(amount)} · ${METHOD_LABEL[method]}`);
    refresh(r.id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** ค่าใช้จ่ายที่ผูกใบงาน → ลงค่าใช้จ่ายของใบงานให้เอง (หน้าค่าใช้จ่ายงานซ่อมยอดตรง ไม่ต้องกรอกซ้ำ) */
async function linkMaintenanceExpense(orgId: string, r: RequestView, userId: string, amount: number) {
  if (!r.workOrderId || r.maintenanceExpenseId || amount <= 0) return;
  try {
    const receipt = r.attachments.find((a) => a.role === "receipt") ?? r.attachments[0];
    const exp = await prisma.expense.create({
      data: {
        orgId,
        workOrderId: r.workOrderId,
        propertyId: r.propertyId,
        amount,
        description: `${r.code} ${KIND_META[r.kind].short}: ${r.title}`.slice(0, 300),
        category: "เบิกจ่าย",
        receiptUrl: receipt?.url ?? null,
        expenseDate: dateOnly(r.workDate),
        createdBy: userId,
      },
    });
    await withRequestsTenant(orgId, (tx) => tx.moneyRequest.update({ where: { id: r.id }, data: { maintenanceExpenseId: exp.id } }));
  } catch (error) {
    console.error("[requests] link maintenance expense failed", error);
  }
}

export async function voidPaymentAction(input: { paymentId: string; reason: string }): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const viewer = viewerOf(session);
    const reason = input.reason.trim().slice(0, 300);
    if (!reason) return { error: "ใส่เหตุผลที่ยกเลิกการจ่าย" };
    const byName = await nameOf(session.userId);
    const res = await withRequestsTenant(orgId, async (tx) => {
      const p = await tx.moneyRequestPayment.findFirst({ where: { orgId, id: input.paymentId, voidedAt: null } });
      if (!p) return "missing" as const;
      if (p.method === "worker_ledger") return "ledger" as const;
      const own = p.byUserId === session.userId && ymd(p.createdAt) === new Date().toISOString().slice(0, 10);
      if (!viewer.canPay && !own) return "denied" as const;
      const r = await loadOne(tx, orgId, p.requestId);
      if (!r) return "missing" as const;
      if (r.kind === "advance" && r.beneficiaryKind === "staff" && r.deductedAt) return "deducted" as const;
      if (r.kind === "cash_advance" && r.clearStatus) return "cleared" as const;
      const now = new Date();
      await tx.moneyRequestPayment.update({ where: { id: p.id }, data: { voidedAt: now, voidedByName: byName, voidReason: reason } });
      await tx.moneyPettyCashEntry.updateMany({ where: { orgId, paymentId: p.id, voidedAt: null }, data: { voidedAt: now, voidedByName: byName, voidReason: `ยกเลิกการจ่าย ${r.code}: ${reason}` } });
      const amount = Number(p.amount);
      if (r.dwPaymentId) {
        await tx.dailyWorkerPayment.updateMany({ where: { orgId, id: r.dwPaymentId, voidedAt: null }, data: { voidedAt: now, voidedByName: byName, voidReason: `ยกเลิกการจ่ายคำขอ ${r.code}: ${reason}`.slice(0, 200) } });
        if (r.employmentId) await insertDwAudit(tx, orgId, { byUserId: session.userId, byName, action: "payment_void", employmentIds: [r.employmentId], workDate: ymd(p.paidOn), summary: `ยกเลิกเบิกล่วงหน้าจากคำขอ ${r.code} · ${reason}` });
      }
      await tx.moneyRequest.update({
        where: { id: r.id },
        data: {
          status: "approved",
          ...(r.dwPaymentId ? { dwPaymentId: null } : {}),
          ...(r.kind === "advance" && r.beneficiaryKind === "staff" ? { deductAmount: Math.max(0, round2(r.deductAmount - amount)) } : {}),
        },
      });
      await insertEvent(tx, orgId, { requestId: r.id, byUserId: session.userId, byName, action: "pay_void", summary: `ยกเลิกการจ่าย ${baht(amount)} · ${reason}` });
      return r;
    });
    if (res === "missing") return { error: "ไม่พบรายการจ่าย" };
    if (res === "ledger") return { error: "OT คนงานยกเลิกที่ตัวใบ (ปุ่มยกเลิกคำขอ)" };
    if (res === "denied") return { error: "ยกเลิกได้เฉพาะ HR หรือคนบันทึกเองภายในวันนั้น" };
    if (res === "deducted") return { error: "หักเงินเดือนไปแล้ว — ยกเลิกการจ่ายไม่ได้" };
    if (res === "cleared") return { error: "ส่งใบเสร็จแล้ว — ยกเลิกการจ่ายไม่ได้" };
    // คนรับเคยได้แจ้ง "จ่ายแล้ว" — ต้องรู้ว่าถูกยกเลิก · ใบกลับไปรอจ่าย HR ต้องรู้ด้วย
    void notifyResult(orgId, brief(res), [staffOnly(res), res.beneficiaryKind === "vendor" ? res.createdBy : null], "ยกเลิกการจ่าย", reason);
    void notifyPayers(orgId, brief(res), [res.beneficiaryUserId ?? "", session.userId]);
    if (res.maintenanceExpenseId) {
      await prisma.expense.deleteMany({ where: { orgId, id: res.maintenanceExpenseId } }).catch(() => null);
      await withRequestsTenant(orgId, (tx) => tx.moneyRequest.update({ where: { id: res.id }, data: { maintenanceExpenseId: null } }));
    }
    refresh(res.id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function confirmReceivedAction(input: { id: string }): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const byName = await nameOf(session.userId);
    const ok = await withRequestsTenant(orgId, async (tx) => {
      const r = await loadOne(tx, orgId, input.id);
      if (!r || r.beneficiaryUserId !== session.userId || r.paidTotal <= 0 || r.receivedAt) return false;
      await tx.moneyRequest.update({ where: { id: r.id }, data: { receivedAt: new Date() } });
      await insertEvent(tx, orgId, { requestId: r.id, byUserId: session.userId, byName, action: "receive", summary: `ยืนยันได้รับเงินแล้ว ${baht(r.paidTotal)}` });
      return true;
    });
    if (!ok) return { error: "ยืนยันไม่ได้ (ไม่ใช่ใบของคุณ หรือยังไม่ได้จ่าย)" };
    refresh(input.id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ═════════════════════════ เคลียร์เงินที่เบิกไปก่อน ═════════════════════════ */

export async function submitClearingAction(input: { id: string; spent: number; returned: number; note: string; receipts: Attachment[] }): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const byName = await nameOf(session.userId);
    const spent = round2(Number(input.spent));
    const returned = round2(Number(input.returned) || 0);
    if (!Number.isFinite(spent) || spent < 0 || !Number.isFinite(returned) || returned < 0) return { error: "จำนวนเงินไม่ถูกต้อง" };
    const receipts = cleanAttachments(orgId, input.receipts, ["clearing"]);
    if (spent > 0 && receipts.length === 0) return { error: "แนบใบเสร็จของที่ซื้อ" };
    const r = await withRequestsTenant(orgId, (tx) => loadOne(tx, orgId, input.id));
    if (!r || r.kind !== "cash_advance") return { error: "ไม่พบคำขอ" };
    if (r.beneficiaryUserId !== session.userId && r.createdBy !== session.userId) return { error: "ส่งใบเสร็จได้เฉพาะคนที่เบิก" };
    if (r.status !== "paid" || r.clearStatus) return { error: r.clearStatus ? "ส่งใบเสร็จไปแล้ว" : "ยังไม่ได้รับเงิน" };
    if (spent + returned > r.paidTotal + 0.005 && returned > 0) return { error: `ใช้จริง + เงินทอนเกินยอดที่ได้ไป ${baht(r.paidTotal)}` };
    const used = await withRequestsTenant(orgId, (tx) => usedHashes(tx, orgId, receipts.map((a) => a.sha256), r.id));
    const dup = receipts.find((a) => used.has(a.sha256));
    if (dup) return { error: `${dup.name}: ใบเสร็จนี้เคยใช้แล้วใน ${used.get(dup.sha256)}` };
    await withRequestsTenant(orgId, async (tx) => {
      await tx.moneyRequest.update({
        where: { id: r.id },
        data: { clearStatus: "submitted", clearSpent: spent, clearReturned: returned, clearNote: input.note.trim().slice(0, 500) || null, attachments: [...r.attachments, ...receipts] as unknown as object },
      });
      await insertEvent(tx, orgId, { requestId: r.id, byUserId: session.userId, byName, action: "clear_submit", summary: `ส่งใบเสร็จ · ใช้จริง ${baht(spent)} · คืนเงินทอน ${baht(returned)} · ใบเสร็จ ${receipts.length} ใบ` });
    });
    const payers = await prisma.user.findMany({ where: { orgId, isActive: true, roles: { some: { role: { permissions: { some: { permission: { code: REQ_PERMS.pay } } } } } } }, select: { id: true } });
    void notifyClear(orgId, brief(r), payers.map((p) => p.id).filter((id) => id !== session.userId), "ส่งใบเสร็จ + เงินทอนแล้ว รอตรวจ");
    refresh(r.id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * HR ตรวจเคลียร์ — ใช้จริงมากกว่าที่ให้ไป = บริษัทค้างจ่ายเพิ่ม (ใบกลับไปรอจ่ายส่วนต่าง)
 * ใช้จริง + เงินทอน น้อยกว่าที่ให้ไป = ส่วนที่ขาดต้องหักคืน (พนักงาน: งวดเงินเดือน · คนงาน: บัญชีค่าแรง)
 */
export async function confirmClearingAction(input: { id: string; returnedTo: string | null; note: string }): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const viewer = viewerOf(session);
    if (!viewer.canPay) return { error: "ตรวจใบเสร็จได้เฉพาะ HR" };
    const byName = await nameOf(session.userId);
    const r = await withRequestsTenant(orgId, (tx) => loadOne(tx, orgId, input.id));
    if (!r || r.kind !== "cash_advance" || r.clearStatus !== "submitted") return { error: "ใบนี้ยังไม่ได้ส่งใบเสร็จ" };
    if (r.beneficiaryUserId === session.userId) return { error: "ตรวจใบของตัวเองไม่ได้" };
    const spent = r.clearSpent ?? 0;
    const returned = r.clearReturned ?? 0;
    const shortage = round2(r.paidTotal - spent - returned);
    const owedMore = round2(spent - r.paidTotal);
    if (returned > 0 && input.returnedTo) {
      const holder = await prisma.user.findFirst({ where: { orgId, id: input.returnedTo, isActive: true }, select: { id: true, name: true } });
      if (!holder) return { error: "ไม่พบคนรับเงินทอน" };
    }
    const returnHolderName = returned > 0 && input.returnedTo ? await nameOf(input.returnedTo) : "";
    await withRequestsTenant(orgId, async (tx) => {
      if (returned > 0 && input.returnedTo) {
        const holderName = returnHolderName;
        await tx.moneyPettyCashEntry.create({ data: { orgId, holderUserId: input.returnedTo, holderName, kind: "return", delta: returned, requestId: r.id, note: `เงินทอนจาก ${r.code}`, byUserId: session.userId, byName } });
      }
      let dwPaymentId: string | null = null;
      if (shortage > 0.005 && r.beneficiaryKind === "worker" && r.employmentId) {
        const dw = await tx.dailyWorkerPayment.create({
          data: { orgId, employmentId: r.employmentId, payDate: dateOnly(bangkokToday()), amount: shortage, kind: "advance", note: `${r.code} เบิกไปก่อนแล้วไม่ได้คืน ${baht(shortage, false)} บาท`.slice(0, 200), byUserId: session.userId, byName },
        });
        dwPaymentId = dw.id;
        await insertDwAudit(tx, orgId, { byUserId: session.userId, byName, action: "payment", employmentIds: [r.employmentId], workDate: bangkokToday(), summary: `หักคืนเงินเบิกไปก่อนที่ไม่ได้คืน ${baht(shortage, false)} บาท (${r.code})` });
      }
      await tx.moneyRequest.update({
        where: { id: r.id },
        data: {
          clearStatus: "cleared",
          clearedAt: new Date(),
          clearedByName: byName,
          ...(owedMore > 0.005 ? { netAmount: spent, status: "approved" } : {}),
          ...(shortage > 0.005 && r.beneficiaryKind !== "worker" ? { deductAmount: shortage } : {}),
          ...(dwPaymentId ? { dwPaymentId } : {}),
        },
      });
      const parts = [`ตรวจใบเสร็จแล้ว · ใช้จริง ${baht(spent)}`];
      if (returned > 0) parts.push(`รับเงินทอน ${baht(returned)}${input.returnedTo ? " เข้าเงินสดย่อย" : ""}`);
      if (owedMore > 0.005) parts.push(`บริษัทค้างจ่ายเพิ่ม ${baht(owedMore)}`);
      if (shortage > 0.005) parts.push(r.beneficiaryKind === "worker" ? `ขาดคืน ${baht(shortage)} หักจากค่าแรง` : `ขาดคืน ${baht(shortage)} รอหักเงินเดือน`);
      if (input.note.trim()) parts.push(input.note.trim().slice(0, 200));
      await insertEvent(tx, orgId, { requestId: r.id, byUserId: session.userId, byName, action: "clear_confirm", summary: parts.join(" · ") });
    });
    await clearActionNotifications(orgId, r.id, ["req_clear"]);
    if (spent > 0) await linkMaintenanceExpense(orgId, r, session.userId, spent);
    if (owedMore > 0.005) void notifyPayers(orgId, { ...brief(r), netAmount: owedMore }, [r.beneficiaryUserId ?? "", session.userId]);
    void notifyResult(orgId, brief(r), [staffOnly(r)], "ตรวจใบเสร็จแล้ว", shortage > 0.005 ? `ขาดคืน ${baht(shortage)} — หักคืนทีหลัง` : owedMore > 0.005 ? `บริษัทจ่ายเพิ่ม ${baht(owedMore)}` : undefined);
    refresh(r.id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ═════════════════════════ ส่งเข้าเงินเดือน ═════════════════════════ */

/** OT พนักงานที่อนุมัติแล้ว → จ่ายรวมเงินเดือนงวดนี้ · ยอดที่ต้องหัก → หักในงวดนี้แล้ว */
export async function markPayrollAction(input: { period: string; payIds: string[]; deductIds: string[] }): Promise<Result<{ done: number }>> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    if (!hasPermission(session, REQ_PERMS.pay)) return { error: "เฉพาะ HR" };
    // ใช้โมดูลเงินเดือนแล้ว / ไม่ใช่ผู้ดูแลเงินเดือน — ห้ามทำที่นี่ (lib/pay-privacy.ts payrollHandoffBlock)
    const block = await payrollHandoffBlock(session);
    if (block) return { error: block };
    if (!/^\d{4}-\d{2}$/.test(input.period)) return { error: "งวดไม่ถูกต้อง" };
    const byName = await nameOf(session.userId);
    const today = bangkokToday();
    let done = 0;
    const told: { r: RequestView; title: string; body: string }[] = [];
    await withRequestsTenant(orgId, async (tx) => {
      const pays = await loadRequests(tx, orgId, { id: { in: input.payIds.slice(0, 500) }, status: "approved", beneficiaryKind: "staff" }, 500);
      for (const r of pays) {
        if (r.beneficiaryUserId === session.userId) continue;
        const amount = round2(r.netAmount - r.paidTotal);
        if (amount <= 0) continue;
        await tx.moneyRequestPayment.create({ data: { orgId, requestId: r.id, amount, method: "payroll", paidOn: dateOnly(today), payrollPeriod: input.period, note: `รวมเงินเดือนงวด ${input.period}`, byUserId: session.userId, byName } });
        await tx.moneyRequest.update({ where: { id: r.id }, data: { status: "paid" } });
        await insertEvent(tx, orgId, { requestId: r.id, byUserId: session.userId, byName, action: "pay", summary: `จ่ายรวมเงินเดือนงวด ${input.period} ${baht(amount)}` });
        told.push({ r, title: "รวมในเงินเดือนแล้ว", body: `งวด ${input.period} · ${baht(amount)}` });
        done++;
      }
      const deducts = await tx.moneyRequest.findMany({ where: { orgId, id: { in: input.deductIds.slice(0, 500) }, deductedAt: null, deductAmount: { gt: 0 } } });
      for (const r of deducts) {
        if (r.beneficiaryUserId === session.userId) continue;
        await tx.moneyRequest.update({ where: { id: r.id }, data: { deductedAt: new Date(), deductedByName: byName, deductedPeriod: input.period } });
        await insertEvent(tx, orgId, { requestId: r.id, byUserId: session.userId, byName, action: "deduct", summary: `หักเงินเดือนงวด ${input.period} ${baht(Number(r.deductAmount))}` });
        const view = (await loadRequests(tx, orgId, { id: r.id }, 1))[0];
        if (view) told.push({ r: view, title: "หักจากเงินเดือนแล้ว", body: `งวด ${input.period} · ${baht(Number(r.deductAmount))}` });
        done++;
      }
    });
    for (const t of told) void notifyResult(orgId, brief(t.r), [staffOnly(t.r)], t.title, t.body);
    for (const id of input.payIds) await clearActionNotifications(orgId, id, ["req_to_pay"]);
    revalidatePath("/requests/payroll");
    refresh();
    return { ok: true, done };
  } catch (error) {
    return fail(error);
  }
}

/* ═════════════════════════ ช่าง/ร้านภายนอก ═════════════════════════ */

export interface VendorInput {
  id?: string | null;
  name: string;
  kind: "person" | "company";
  taxId: string;
  phone: string;
  address: string;
  bankName: string;
  bankAccount: string;
  accountName: string;
  whtPercent: number;
  vatRegistered: boolean;
  note: string;
  active?: boolean;
}

export async function saveVendorAction(input: VendorInput): Promise<Result<{ id: string }>> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    if (!hasPermission(session, REQ_PERMS.fileOthers) && !hasPermission(session, REQ_PERMS.settings)) return { error: "ไม่มีสิทธิ์แก้ทะเบียนช่างภายนอก" };
    const name = input.name.trim().slice(0, 120);
    if (!name) return { error: "ใส่ชื่อช่าง/ร้าน" };
    const taxId = input.taxId.replace(/\D/g, "");
    if (taxId && taxId.length !== 13) return { error: "เลขผู้เสียภาษีต้องมี 13 หลัก" };
    const wht = Number(input.whtPercent);
    if (!Number.isFinite(wht) || wht < 0 || wht > 15) return { error: "% หัก ณ ที่จ่ายไม่ถูกต้อง" };
    const byName = await nameOf(session.userId);
    const data = {
      name,
      kind: input.kind === "company" ? "company" : "person",
      taxId,
      phone: input.phone.trim().slice(0, 40),
      address: input.address.trim().slice(0, 300),
      bankName: input.bankName.trim().slice(0, 60),
      bankAccount: input.bankAccount.replace(/[^\d-]/g, "").slice(0, 30),
      accountName: input.accountName.trim().slice(0, 120),
      whtPercent: wht,
      vatRegistered: !!input.vatRegistered,
      note: input.note.trim().slice(0, 500),
      ...(input.active === undefined ? {} : { active: !!input.active }),
    };
    const id = await withRequestsTenant(orgId, async (tx) => {
      if (input.id) {
        const v = await tx.moneyVendor.findFirst({ where: { orgId, id: input.id } });
        if (!v) throw new Error("ไม่พบช่าง/ร้านนี้");
        await tx.moneyVendor.update({ where: { id: v.id }, data });
        await insertEvent(tx, orgId, { byUserId: session.userId, byName, action: "vendor", summary: `แก้ข้อมูลช่าง/ร้าน ${name}` });
        return v.id;
      }
      const v = await tx.moneyVendor.create({ data: { orgId, ...data, createdBy: session.userId } });
      await insertEvent(tx, orgId, { byUserId: session.userId, byName, action: "vendor", summary: `เพิ่มช่าง/ร้าน ${name}` });
      return v.id;
    });
    revalidatePath("/requests/vendors");
    return { ok: true, id };
  } catch (error) {
    return fail(error);
  }
}

/* ═════════════════════════ เงินสดย่อย ═════════════════════════ */

export async function addPettyEntryAction(input: { holderUserId: string; kind: "top_up" | "adjust"; amount: number; note: string; attachments: Attachment[] }): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const viewer = viewerOf(session);
    const holder = await prisma.user.findFirst({
      where: { orgId, id: input.holderUserId, isActive: true, roles: { some: { role: { permissions: { some: { permission: { code: REQ_PERMS.pettyCash } } } } } } },
      select: { id: true, name: true },
    });
    if (!holder) return { error: "คนนี้ไม่ได้ถือเงินสดย่อย" };
    if (holder.id !== session.userId && !viewer.canPay) return { error: "ลงได้เฉพาะเงินสดย่อยของตัวเอง (หรือ HR)" };
    // เติมเงิน: เฉพาะ HR/CEO และเติมให้ตัวเองตรง ๆ ไม่ได้ (ผู้ใช้ 30/10/2569) — ของตัวเองต้อง "ขอเติมเงิน" ให้อีกคนอนุมัติ
    if (input.kind === "top_up" && !(viewer.canApprove || viewer.canApproveCeo)) return { error: "เติมเงินได้เฉพาะ HR หรือ CEO — ผู้ถือกด “ขอเติมเงิน” แทน" };
    if (input.kind === "top_up" && holder.id === session.userId) return { error: "เติมเงินให้ตัวเองไม่ได้ — กด “ขอเติมเงิน” ให้อีกคนอนุมัติ" };
    const amount = round2(Number(input.amount));
    if (!Number.isFinite(amount) || amount === 0) return { error: "กรอกจำนวนเงิน" };
    if (input.kind === "top_up" && amount < 0) return { error: "เติมเงินต้องเป็นยอดบวก" };
    const note = input.note.trim().slice(0, 300);
    if (input.kind === "adjust" && !note) return { error: "ปรับยอดต้องใส่เหตุผล (เช่น นับเงินจริงได้ไม่ตรง)" };
    const attachments = cleanAttachments(orgId, input.attachments, ["slip", "evidence"]);
    if (input.kind === "top_up" && attachments.length === 0) return { error: "แนบหลักฐานการเติมเงิน (สลิปโอน/รูปเงินสด)" };
    const byName = await nameOf(session.userId);
    await withRequestsTenant(orgId, async (tx) => {
      await tx.moneyPettyCashEntry.create({ data: { orgId, holderUserId: holder.id, holderName: holder.name, kind: input.kind, delta: amount, note, attachments: attachments as unknown as object, byUserId: session.userId, byName } });
      await insertEvent(tx, orgId, { byUserId: session.userId, byName, action: "petty", summary: `${input.kind === "top_up" ? "เติมเงินสดย่อย" : "ปรับยอดเงินสดย่อย"} ${holder.name} ${baht(amount)}${note ? ` · ${note}` : ""}` });
    });
    revalidatePath("/requests/petty-cash");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function voidPettyEntryAction(input: { id: string; reason: string }): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const reason = input.reason.trim().slice(0, 300);
    if (!reason) return { error: "ใส่เหตุผล" };
    const byName = await nameOf(session.userId);
    const res = await withRequestsTenant(orgId, async (tx) => {
      const e = await tx.moneyPettyCashEntry.findFirst({ where: { orgId, id: input.id, voidedAt: null } });
      if (!e) return "missing";
      if (e.paymentId || e.requestId) return "linked";
      if (!hasPermission(session, REQ_PERMS.pay) && e.byUserId !== session.userId) return "denied";
      await tx.moneyPettyCashEntry.update({ where: { id: e.id }, data: { voidedAt: new Date(), voidedByName: byName, voidReason: reason } });
      await insertEvent(tx, orgId, { byUserId: session.userId, byName, action: "petty", summary: `ยกเลิกรายการเงินสดย่อย ${e.holderName} ${baht(Number(e.delta))} · ${reason}` });
      return "ok";
    });
    if (res === "missing") return { error: "ไม่พบรายการ" };
    if (res === "linked") return { error: "รายการนี้มาจากการจ่ายคำขอ — ยกเลิกที่ตัวการจ่ายในใบคำขอ" };
    if (res === "denied") return { error: "ยกเลิกได้เฉพาะคนลงเอง หรือ HR" };
    revalidatePath("/requests/petty-cash");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * เงินสดย่อย: ขอเติม / อนุมัติ / จ่ายค่าของ (ผู้ใช้ 30/10/2569)
 *   - ผู้ถือขอเติมเงินของตัวเอง → HR หรือ CEO อนุมัติ · ไม่มีใครอนุมัติของตัวเอง · ผู้ถือเป็น HR ⇒ CEO อนุมัติเท่านั้น
 *   - อนุมัติต้องแนบสลิปโอน/รูปเงินสดที่เห็นชัด ถึงจะเพิ่มยอด (สร้างรายการ top_up)
 *   - จ่ายค่าของ: ผู้ถือจดเองได้เลย แต่ต้องกรอกครบ — ค่าอะไร + หมวด + ใบเสร็จ · เกินเงินในมือไม่ได้
 */
async function pettyHolder(orgId: string, userId: string) {
  return prisma.user.findFirst({
    where: { orgId, id: userId, isActive: true, roles: { some: { role: { permissions: { some: { permission: { code: REQ_PERMS.pettyCash } } } } } } },
    select: { id: true, name: true },
  });
}

/** ผู้ถือคนนี้เป็น HR (อนุมัติระดับ HR ได้ แต่ไม่ใช่ CEO) ⇒ คำขอเติมของเขาต้อง CEO อนุมัติ */
async function holderIsHr(orgId: string, userId: string): Promise<boolean> {
  const [hr, ceo] = await Promise.all([usersWithPermission(orgId, REQ_PERMS.approve), usersWithPermission(orgId, REQ_PERMS.approveCeo)]);
  return hr.includes(userId) && !ceo.includes(userId);
}

export async function requestPettyTopupAction(input: { amount: number; note: string }): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const holder = await pettyHolder(orgId, session.userId);
    if (!holder) return { error: "คุณไม่ได้ถือเงินสดย่อย" };
    const amount = round2(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) return { error: "กรอกจำนวนเงินที่ขอเติม" };
    const note = input.note.trim().slice(0, 300);
    if (!note) return { error: "บอกเหตุผลที่ขอเติม (เช่น เงินในมือใกล้หมด)" };
    const needsCeo = await holderIsHr(orgId, holder.id);
    const created = await withRequestsTenant(orgId, async (tx) => {
      const dup = await tx.moneyPettyTopup.findFirst({ where: { orgId, holderUserId: holder.id, status: "pending" }, select: { id: true } });
      if (dup) return null;
      const t = await tx.moneyPettyTopup.create({ data: { orgId, holderUserId: holder.id, holderName: holder.name, amount, note, requestedByUserId: session.userId, requestedByName: holder.name, needsCeo } });
      await insertEvent(tx, orgId, { byUserId: session.userId, byName: holder.name, action: "petty", summary: `ขอเติมเงินสดย่อย ${holder.name} ${baht(amount)} · ${note}` });
      return t;
    });
    if (!created) return { error: "มีคำขอเติมเงินที่รออนุมัติอยู่แล้ว — รอผล หรือยกเลิกอันเดิมก่อน" };
    void notifyPettyTopupApprovers(orgId, { id: created.id, holderUserId: holder.id, holderName: holder.name, amount, note, needsCeo });
    revalidatePath("/requests/petty-cash");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function decidePettyTopupAction(input: { id: string; outcome: "approve" | "reject"; method: "transfer" | "cash"; note: string; attachments: Attachment[] }): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const viewer = viewerOf(session);
    if (!(viewer.canApprove || viewer.canApproveCeo)) return { error: "อนุมัติได้เฉพาะ HR หรือ CEO" };
    const note = input.note.trim().slice(0, 300);
    if (input.outcome === "reject" && !note) return { error: "ใส่เหตุผลที่ไม่อนุมัติ" };
    if (input.outcome === "approve" && !["transfer", "cash"].includes(input.method)) return { error: "เลือกว่าให้เงินแบบโอนหรือเงินสด" };
    const attachments = cleanAttachments(orgId, input.attachments, ["slip", "evidence"]);
    if (input.outcome === "approve" && attachments.length === 0) return { error: input.method === "cash" ? "แนบรูปเงินสดที่ให้ (เห็นจำนวนชัด)" : "แนบสลิปโอนเงิน" };
    const byName = await nameOf(session.userId);
    const res = await withRequestsTenant(orgId, async (tx) => {
      const t = await tx.moneyPettyTopup.findFirst({ where: { orgId, id: input.id, status: "pending" } });
      if (!t) return { error: "ไม่พบคำขอ หรือมีคนตัดสินไปแล้ว" } as const;
      if (t.holderUserId === session.userId || t.requestedByUserId === session.userId) return { error: "อนุมัติคำขอของตัวเองไม่ได้" } as const;
      if (t.needsCeo && !viewer.canApproveCeo) return { error: "คำขอของ HR ต้องให้ CEO อนุมัติ" } as const;
      let entryId: string | null = null;
      if (input.outcome === "approve") {
        const how = input.method === "cash" ? "ให้เงินสด" : "โอนเงิน";
        const e = await tx.moneyPettyCashEntry.create({
          data: { orgId, holderUserId: t.holderUserId, holderName: t.holderName, kind: "top_up", delta: t.amount, note: `อนุมัติคำขอเติม · ${how}${note ? ` · ${note}` : ""}`, attachments: attachments as unknown as object, byUserId: session.userId, byName },
        });
        entryId = e.id;
      }
      await tx.moneyPettyTopup.update({
        where: { id: t.id },
        data: { status: input.outcome === "approve" ? "approved" : "rejected", decidedByUserId: session.userId, decidedByName: byName, decidedAt: new Date(), decisionNote: note || null, entryId },
      });
      await insertEvent(tx, orgId, { byUserId: session.userId, byName, action: "petty", summary: `${input.outcome === "approve" ? "อนุมัติ" : "ไม่อนุมัติ"}คำขอเติมเงินสดย่อย ${t.holderName} ${baht(Number(t.amount))}${note ? ` · ${note}` : ""}` });
      return { t } as const;
    });
    if ("error" in res) return { error: res.error ?? "ทำไม่สำเร็จ" };
    const amt = baht(Number(res.t.amount));
    void notifyPettyTopupResult(
      orgId,
      [res.t.holderUserId],
      input.outcome === "approve" ? `เติมเงินสดย่อยแล้ว ${amt}` : `ไม่อนุมัติคำขอเติมเงิน ${amt}`,
      input.outcome === "approve" ? `${byName} อนุมัติแล้ว — ตรวจรับเงินให้ครบ` : `${byName}: ${note}`,
    );
    void clearActionNotifications(orgId, res.t.id, ["petty_topup"]);
    revalidatePath("/requests/petty-cash");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelPettyTopupAction(input: { id: string }): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const byName = await nameOf(session.userId);
    const ok = await withRequestsTenant(orgId, async (tx) => {
      const t = await tx.moneyPettyTopup.findFirst({ where: { orgId, id: input.id, status: "pending", requestedByUserId: session.userId } });
      if (!t) return false;
      await tx.moneyPettyTopup.update({ where: { id: t.id }, data: { status: "cancelled", decidedByUserId: session.userId, decidedByName: byName, decidedAt: new Date() } });
      await insertEvent(tx, orgId, { byUserId: session.userId, byName, action: "petty", summary: `ยกเลิกคำขอเติมเงินสดย่อย ${t.holderName} ${baht(Number(t.amount))}` });
      return true;
    });
    if (!ok) return { error: "ไม่พบคำขอ หรือมีคนตัดสินไปแล้ว" };
    void clearActionNotifications(orgId, input.id, ["petty_topup"]);
    revalidatePath("/requests/petty-cash");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function addPettySpendAction(input: { title: string; category: string; amount: number; spentOn: string; attachments: Attachment[] }): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    const holder = await pettyHolder(orgId, session.userId);
    if (!holder) return { error: "คุณไม่ได้ถือเงินสดย่อย" };
    const title = input.title.trim().slice(0, 200);
    if (!title) return { error: "กรอกว่าจ่ายค่าอะไร" };
    if (!(PETTY_CATEGORIES as readonly string[]).includes(input.category)) return { error: "เลือกหมวด" };
    const amount = round2(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) return { error: "กรอกจำนวนเงิน" };
    const spentOn = normalizeDate(input.spentOn);
    if (!spentOn || spentOn > bangkokToday()) return { error: "วันที่จ่ายไม่ถูกต้อง" };
    const attachments = cleanAttachments(orgId, input.attachments, ["receipt", "evidence"]);
    if (attachments.length === 0) return { error: "แนบรูปใบเสร็จ / บิล" };
    const res = await withRequestsTenant(orgId, async (tx) => {
      const balance = (await pettyBalances(tx, orgId)).get(holder.id) ?? 0;
      if (amount > balance + 0.005) return { error: `เงินในมือไม่พอ (เหลือ ${baht(balance)}) — กด “ขอเติมเงิน” ก่อน` } as const;
      await tx.moneyPettyCashEntry.create({
        data: { orgId, holderUserId: holder.id, holderName: holder.name, kind: "spend", delta: -amount, category: input.category, note: `${title} · จ่ายวันที่ ${thaiDate(spentOn)}`, attachments: attachments as unknown as object, byUserId: session.userId, byName: holder.name },
      });
      await insertEvent(tx, orgId, { byUserId: session.userId, byName: holder.name, action: "petty", summary: `จ่ายจากเงินสดย่อย ${holder.name} ${baht(amount)} · ${input.category} · ${title}` });
      return { ok: true } as const;
    });
    if ("error" in res) return { error: res.error ?? "ทำไม่สำเร็จ" };
    revalidatePath("/requests/petty-cash");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ═════════════════════════ ตั้งค่า ═════════════════════════ */

export async function saveSettingsAction(input: RequestSettings): Promise<Result> {
  try {
    const session = await guard();
    const orgId = session.orgId;
    if (!hasPermission(session, REQ_PERMS.settings)) return { error: "ไม่มีสิทธิ์ตั้งค่า" };
    const rates = (input.otRates ?? [])
      .map((r, i) => ({ id: String(r.id || `r${i}`).slice(0, 30), label: String(r.label ?? "").trim().slice(0, 60), percent: round2(Number(r.percent)) }))
      .filter((r) => r.label && Number.isFinite(r.percent) && r.percent > 0 && r.percent <= 1000);
    if (rates.length === 0) return { error: "ต้องมีอัตรา OT อย่างน้อย 1 แบบ" };
    const wht = [...new Set((input.whtRates ?? []).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 15))].sort((a, b) => a - b);
    if (!["none", "baht", "days"].includes(input.advanceCapMode)) return { error: "รูปแบบเพดานไม่ถูกต้อง" };
    const capValue = round2(Number(input.advanceCapValue));
    if (input.advanceCapMode !== "none" && (!Number.isFinite(capValue) || capValue <= 0)) return { error: "กรอกเพดานเบิกล่วงหน้า" };
    const vat = Number(input.vatPercent);
    if (!Number.isFinite(vat) || vat < 0 || vat > 30) return { error: "% VAT ไม่ถูกต้อง" };
    const maxAge = Math.round(Number(input.receiptMaxAgeDays));
    const clearDays = Math.round(Number(input.clearDueDays));
    if (!(maxAge >= 1 && maxAge <= 3650) || !(clearDays >= 1 && clearDays <= 120)) return { error: "จำนวนวันไม่ถูกต้อง" };
    // เส้นทางอนุมัติรายประเภท — เกณฑ์ CEO เว้นว่าง = ไม่ต้องผ่าน CEO · 0 = ทุกใบ
    const approvalRoutes = {} as Record<RequestKind, { mode: "hr" | "ceo"; ceoAbove: number | null }>;
    for (const k of Object.keys(KIND_META) as RequestKind[]) {
      const r = input.approvalRoutes?.[k];
      const mode = r?.mode === "ceo" ? "ceo" : "hr";
      const above = r?.ceoAbove === null || r?.ceoAbove === undefined || (r.ceoAbove as unknown) === "" ? null : round2(Number(r.ceoAbove));
      if (above !== null && (!Number.isFinite(above) || above < 0)) return { error: `เกณฑ์ CEO ของ ${KIND_META[k].label} ไม่ถูกต้อง` };
      approvalRoutes[k] = { mode, ceoAbove: mode === "ceo" ? null : above };
    }
    const byName = await nameOf(session.userId);
    const data = {
      approvalRoutes,
      otRates: rates,
      advanceCapMode: input.advanceCapMode,
      advanceCapValue: input.advanceCapMode === "none" ? 0 : capValue,
      whtRates: wht.length ? wht : [0, 3],
      vatPercent: vat,
      receiptMaxAgeDays: maxAge,
      clearDueDays: clearDays,
      updatedBy: session.userId,
    };
    await withRequestsTenant(orgId, async (tx) => {
      await tx.moneyRequestSettings.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
      await insertEvent(tx, orgId, {
        byUserId: session.userId,
        byName,
        action: "settings",
        summary: `ตั้งค่า: อนุมัติ ${(Object.keys(approvalRoutes) as RequestKind[]).map((k) => `${KIND_META[k].short} ${routeText(approvalRoutes[k])}`).join(", ")} · OT ${rates.map((r) => `${r.label} ${r.percent}%`).join(", ")} · เพดานเบิกล่วงหน้า ${input.advanceCapMode === "none" ? "ไม่จำกัด" : input.advanceCapMode === "baht" ? baht(capValue) : `${capValue} วัน`} · VAT ${vat}%`,
      });
    });
    revalidatePath("/requests");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
