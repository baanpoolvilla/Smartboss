import "server-only";
import { prisma, type Prisma } from "@smartboss/database";
import { nextAdsProposalCode } from "@/lib/document-code";
import { usersWithPermission } from "@/modules/maintenance/data/notify";
import { ADS_PERMS } from "../permissions";
import {
  PROPOSAL_TYPE_LABEL,
  isProposalType,
  negativeKeywords,
  numberOf,
  numericField,
  proposalHeadline,
  type ProposalType,
} from "../lib/proposal-types";
import { AgentHttpError } from "./agent-auth";
import { loadAgentSettings, type AgentSettings } from "./agent-settings";
import { approverIds, postBotText, postProposalCard, refreshProposalCards } from "./bot";
import { effectiveStatus } from "./proposal-view";
import { sendAgentWebhook } from "./webhooks";

/**
 * คำขอปรับ Google Ads — n8n เสนอ → คนอนุมัติในแชท/แดชบอร์ด → n8n จองไปยิง → รายงานผล → วัดผล
 *
 *   pending ──อนุมัติ──► approved ──n8n claim──► executing ──result──► applied | failed | stale
 *      │                                                                  └─ measurement (7/14 วัน)
 *      ├──ปฏิเสธ──► rejected
 *      └──เลยเวลา──► expired
 *
 * คนอนุมัติ = สมาชิกกลุ่ม "🤖 Ads Agent" (data/bot.ts) — กดได้ครั้งเดียว คนแรกชนะ
 * Smartboss เป็นที่เดียวที่ถือสถานะ · ทุกการเปลี่ยนสถานะใช้ updateMany ที่มีเงื่อนไขสถานะเดิม
 * (กดพร้อมกันสองคน / n8n จองซ้ำ — คนแรกชนะ คนที่สองได้ 409)
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown, max: number): string | null => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
const digits = (v: unknown): string | null => (v != null && /^\d{1,19}$/.test(String(v)) ? String(v) : null);

/** % ที่เปลี่ยนจากค่าเดิม — ไม่รู้ค่าเดิม = null (ตรวจเพดานไม่ได้ จึงบังคับให้ส่งค่าเดิมมาด้วย) */
function changePct(before: number | null, after: number): number | null {
  if (before == null || before <= 0) return null;
  return Math.abs((after - before) / before) * 100;
}

function checkCeiling(type: ProposalType, before: Obj | null, value: number, settings: AgentSettings): void {
  const field = numericField(type)!;
  const pct = changePct(numberOf(before?.[field]), value);
  if (pct == null) throw new Error(`ต้องส่งค่าเดิม before.${field} มาด้วย ระบบใช้ตรวจเพดานการปรับ`);
  if (pct > settings.maxBudgetChangePct + 1e-9) {
    throw new Error(`ปรับ ${pct.toFixed(1)}% เกินเพดานของบริษัท (ไม่เกิน ${settings.maxBudgetChangePct}% ต่อครั้ง)`);
  }
}

// ─── สร้าง (n8n → Smartboss) ───

export async function createProposal(orgId: string, body: Obj): Promise<{ id: string; code: string; status: "pending"; group_members: number }> {
  const settings = await loadAgentSettings(orgId);
  const type = body.type;
  if (!isProposalType(type)) throw new Error(`type ไม่รู้จัก — ใช้ได้: ${Object.keys(PROPOSAL_TYPE_LABEL).join(", ")}`);
  if (!settings.allowedTypes.includes(type)) throw new Error(`บริษัทนี้ยังไม่เปิดให้เสนอ "${PROPOSAL_TYPE_LABEL[type]}" (ตั้งที่หน้า การเชื่อมต่อ n8n)`);

  const customerId = String(body.customer_id ?? "").replace(/\D/g, "");
  const account = customerId ? await prisma.adsAccount.findFirst({ where: { orgId, customerId }, select: { customerId: true } }) : null;
  if (!account) throw new Error("ไม่พบบัญชีโฆษณานี้ในบริษัท — ส่ง customer_id ที่ส่งข้อมูลเข้ามาแล้ว");

  const reason = str(body.reason, 4000);
  if (!reason) throw new Error("ต้องมี reason อธิบายว่าทำไมควรปรับ");
  const campaignId = digits(body.campaign_id);
  const adGroupId = digits(body.ad_group_id);
  let targetId = str(body.target_id, 60);
  const before = obj(body.before);
  let proposed = obj(body.proposed) ?? {};

  if (type === "add_negative_keywords") {
    const keywords = negativeKeywords(proposed);
    if (keywords.length === 0 || keywords.length > 200) throw new Error("proposed.keywords ต้องมี 1–200 คำ");
    const level = proposed.level === "campaign" ? "campaign" : "ad_group";
    if (level === "ad_group" && !adGroupId) throw new Error("negative ระดับกลุ่มโฆษณาต้องส่ง ad_group_id");
    if (level === "campaign" && !campaignId) throw new Error("negative ระดับแคมเปญต้องส่ง campaign_id");
    proposed = { level, keywords };
  } else if (type === "pause_keyword" || type === "enable_keyword") {
    if (!targetId || !adGroupId) throw new Error("ต้องส่ง target_id (criterion id ของคีย์เวิร์ด) และ ad_group_id");
    proposed = { status: type === "pause_keyword" ? "PAUSED" : "ENABLED" };
  } else if (type === "pause_ad_group" || type === "enable_ad_group") {
    if (!adGroupId) throw new Error("ต้องส่ง ad_group_id");
    targetId = adGroupId;
    proposed = { status: type === "pause_ad_group" ? "PAUSED" : "ENABLED" };
  } else {
    const field = numericField(type)!;
    const value = numberOf(proposed[field]);
    if (value == null || value <= 0) throw new Error(`proposed.${field} ต้องเป็นตัวเลขมากกว่า 0`);
    if (type === "set_campaign_budget") {
      if (!campaignId) throw new Error("ต้องส่ง campaign_id");
      targetId = campaignId;
    } else if (!targetId || !adGroupId) {
      throw new Error("ต้องส่ง target_id (criterion id ของคีย์เวิร์ด) และ ad_group_id");
    }
    checkCeiling(type, before, value, settings);
    proposed = { [field]: value };
  }

  // คำขอชนิดเดียวกันกับของชิ้นเดียวกันที่ยังรออยู่ — ไม่สร้างซ้ำ
  const targetKey = targetId ?? adGroupId ?? campaignId;
  if (targetKey) {
    const dup = await prisma.adsChangeProposal.findFirst({
      where: {
        orgId,
        customerId,
        type,
        status: { in: ["pending", "approved", "executing"] },
        expiresAt: { gt: new Date() },
        OR: [{ targetId: targetKey }, { targetId: null, adGroupId: targetKey }, { targetId: null, campaignId: targetKey }],
      },
      select: { id: true, code: true, status: true },
    });
    if (dup && type !== "add_negative_keywords") {
      throw new AgentHttpError(`มีคำขอแบบเดียวกันค้างอยู่แล้ว (${dup.code})`, 409, { existing_id: dup.id, existing_status: dup.status });
    }
  }

  let requestedBy: string | null = null;
  const source = body.source === "command" ? "command" : "ai";
  if (source === "command") {
    requestedBy = str(body.requested_by_user_id, 60);
    const allowed = requestedBy ? (await usersWithPermission(orgId, ADS_PERMS.access)).includes(requestedBy) : false;
    if (!allowed) throw new Error("source = command ต้องส่ง requested_by_user_id ของคนที่สั่ง (ต้องมีสิทธิ์ใช้โมดูล Google Ads)");
  }
  const risk = body.risk === "low" || body.risk === "high" ? body.risk : "medium";
  const evidence = Array.isArray(body.evidence) ? body.evidence.slice(0, 12) : null;

  const created = await prisma.$transaction(async (tx) => {
    const code = await nextAdsProposalCode(tx, orgId);
    return tx.adsChangeProposal.create({
      data: {
        orgId,
        code,
        customerId,
        type,
        source,
        requestedBy,
        campaignId,
        campaignName: str(body.campaign_name, 255),
        adGroupId,
        adGroupName: str(body.ad_group_name, 255),
        targetId,
        targetName: str(body.target_name, 500),
        before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
        proposed: proposed as Prisma.InputJsonValue,
        reason,
        evidence: (evidence ?? undefined) as Prisma.InputJsonValue | undefined,
        risk,
        expectedImpact: str(body.expected_impact, 1000),
        expiresAt: new Date(Date.now() + settings.proposalExpiryHours * 3600_000),
      },
      select: { id: true, code: true, type: true, proposed: true, campaignName: true, adGroupName: true, targetName: true },
    });
  });

  // การ์ดใบเดียวเข้ากลุ่ม Ads Agent — คนสั่งถูกแท็กให้เด้งหาเจ้าตัว
  const headline = `🟠 ขออนุมัติ: ${proposalHeadline({ ...created, type, proposed: obj(created.proposed) ?? {} })}`;
  const members = await postProposalCard(orgId, created.id, headline, requestedBy ? [requestedBy] : []);
  return { id: created.id, code: created.code, status: "pending", group_members: members };
}

// ─── ตัดสิน (คนกดในแชท/แดชบอร์ด) ───

export interface DecideInput {
  action: "approve" | "reject";
  /** อนุมัติ: negative ที่ติ๊กไว้ (ข้อความคำ) · งบ/bid ที่แก้แล้ว */
  keywords?: string[];
  value?: number;
  note?: string;
}

export async function decideProposal(orgId: string, id: string, userId: string, input: DecideInput): Promise<void> {
  const row = await prisma.adsChangeProposal.findFirst({ where: { orgId, id } });
  if (!row || !isProposalType(row.type)) throw new Error("ไม่พบคำขอนี้");
  const status = effectiveStatus(row);
  if (status !== "pending") throw new Error(status === "expired" ? "คำขอนี้หมดอายุแล้ว" : "คำขอนี้มีคนตัดสินไปแล้ว");
  if (!(await approverIds(orgId)).includes(userId)) throw new Error("เฉพาะสมาชิกกลุ่ม 🤖 Ads Agent เท่านั้นที่อนุมัติ/ปฏิเสธได้");
  const settings = await loadAgentSettings(orgId);
  if (!settings.selfApprove && row.requestedBy === userId) throw new Error("บริษัทตั้งไว้ว่าคนสั่งอนุมัติคำขอของตัวเองไม่ได้ — ให้ผู้อนุมัติคนอื่นกด");

  const note = input.note?.trim().slice(0, 1000) || null;
  let approved: Obj | null = null;
  if (input.action === "reject") {
    if (!note) throw new Error("ใส่เหตุผลที่ปฏิเสธก่อน (AI จะใช้เหตุผลนี้รอบหน้า)");
  } else {
    const proposed = obj(row.proposed) ?? {};
    const type = row.type as ProposalType;
    if (type === "add_negative_keywords") {
      const all = negativeKeywords(proposed);
      const picked = input.keywords ? all.filter((k) => input.keywords!.includes(k.text)) : all;
      if (picked.length === 0) throw new Error("เลือกอย่างน้อย 1 คำ");
      approved = { ...proposed, keywords: picked };
    } else if (numericField(type)) {
      const field = numericField(type)!;
      const value = input.value != null ? Number(input.value) : numberOf(proposed[field]);
      if (value == null || !Number.isFinite(value) || value <= 0) throw new Error("ตัวเลขต้องมากกว่า 0");
      checkCeiling(type, obj(row.before), value, settings);
      approved = { [field]: Math.round(value * 100) / 100 };
    } else {
      approved = proposed;
    }
  }

  const res = await prisma.adsChangeProposal.updateMany({
    where: { orgId, id, status: "pending", expiresAt: { gt: new Date() } },
    data: {
      status: input.action === "approve" ? "approved" : "rejected",
      approved: (approved ?? undefined) as Prisma.InputJsonValue | undefined,
      decidedBy: userId,
      decidedAt: new Date(),
      decisionNote: note,
    },
  });
  if (res.count === 0) throw new Error("คำขอนี้มีคนตัดสินไปแล้ว");

  await refreshProposalCards(orgId, id);
  void sendAgentWebhook(
    orgId,
    input.action === "approve" ? "proposal.approved" : "proposal.rejected",
    input.action === "approve"
      ? { id, code: row.code, type: row.type, customer_id: row.customerId }
      : { id, code: row.code, type: row.type, customer_id: row.customerId, reason: note }
  );
}

// ─── n8n จองไปยิง / รายงานผล / วัดผล ───

/** JSON ที่ n8n ใช้ยิงจริง — ใช้ `approved` เสมอ ไม่ใช่ `proposed` (คนอาจแก้/ติ๊กออก) */
function agentJson(r: Awaited<ReturnType<typeof prisma.adsChangeProposal.findFirst>> & object) {
  return {
    id: r.id,
    code: r.code,
    status: effectiveStatus(r),
    customer_id: r.customerId,
    type: r.type,
    source: r.source,
    requested_by_user_id: r.requestedBy,
    campaign_id: r.campaignId,
    campaign_name: r.campaignName,
    ad_group_id: r.adGroupId,
    ad_group_name: r.adGroupName,
    target_id: r.targetId,
    target_name: r.targetName,
    before: r.before,
    proposed: r.proposed,
    approved: r.approved,
    reason: r.reason,
    risk: r.risk,
    decided_by_user_id: r.decidedBy,
    decided_at: r.decidedAt,
    decision_note: r.decisionNote,
    claimed_at: r.claimedAt,
    executed_at: r.executedAt,
    result: r.result,
    error: r.error,
    measurement: r.measurement,
    expires_at: r.expiresAt,
    created_at: r.createdAt,
  };
}

export async function getProposalForAgent(orgId: string, id: string) {
  const row = await prisma.adsChangeProposal.findFirst({ where: { orgId, id } });
  if (!row) throw new AgentHttpError("ไม่พบคำขอนี้", 404);
  return agentJson(row);
}

export async function listProposalsForAgent(orgId: string, sp: URLSearchParams) {
  await expireStale(orgId);
  const statuses = (sp.get("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const since = sp.get("since");
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 50));
  const rows = await prisma.adsChangeProposal.findMany({
    where: {
      orgId,
      ...(statuses.length ? { status: { in: statuses } } : {}),
      ...(sp.get("customer_id") ? { customerId: sp.get("customer_id")! } : {}),
      ...(since && !Number.isNaN(Date.parse(since)) ? { updatedAt: { gte: new Date(since) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return { proposals: rows.map(agentJson) };
}

export async function claimProposal(orgId: string, id: string) {
  const res = await prisma.adsChangeProposal.updateMany({
    where: { orgId, id, status: "approved" },
    data: { status: "executing", claimedAt: new Date() },
  });
  const row = await prisma.adsChangeProposal.findFirst({ where: { orgId, id } });
  if (!row) throw new AgentHttpError("ไม่พบคำขอนี้", 404);
  if (res.count === 0) {
    throw new AgentHttpError(`คำขอนี้ไม่ได้อยู่ในสถานะ "อนุมัติแล้ว" (ตอนนี้: ${effectiveStatus(row)}) — ห้ามยิง`, 409, { status: effectiveStatus(row) });
  }
  await refreshProposalCards(orgId, id);
  return { ok: true, proposal: agentJson(row) };
}

export async function reportProposalResult(orgId: string, id: string, body: Obj) {
  const status = body.status;
  if (status !== "applied" && status !== "failed" && status !== "stale") throw new Error("status ต้องเป็น applied | failed | stale");
  const error = str(body.error, 4000);
  if (status !== "applied" && !error) throw new Error("ล้มเหลว/ใช้ไม่ได้ ต้องส่ง error บอกเหตุผล (ขึ้นในการ์ดให้คนเห็น)");
  const res = await prisma.adsChangeProposal.updateMany({
    where: { orgId, id, status: "executing" },
    data: {
      status,
      executedAt: new Date(),
      result: (obj(body.result) ?? undefined) as Prisma.InputJsonValue | undefined,
      error: status === "applied" ? null : error,
    },
  });
  if (res.count === 0) throw new AgentHttpError("รายงานผลได้เฉพาะคำขอที่ claim ไปแล้ว (executing)", 409);
  await refreshProposalCards(orgId, id);
  if (status !== "applied") {
    const row = await prisma.adsChangeProposal.findFirst({ where: { orgId, id }, select: { code: true, decidedBy: true } });
    if (row?.decidedBy) {
      await postBotText(orgId, `⚠️ ${row.code} ${status === "stale" ? "ไม่ได้ปรับ เพราะค่าใน Google Ads เปลี่ยนไปก่อนยิง" : "ปรับไม่สำเร็จ"}: ${error}`, { mentionUserIds: [row.decidedBy] });
    }
  }
  return { ok: true };
}

export async function addProposalMeasurement(orgId: string, id: string, body: Obj) {
  const days = Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > 180) throw new Error("days ต้องเป็นจำนวนวัน 1–180 เช่น 7 หรือ 14");
  const summary = str(body.summary, 2000);
  if (!summary) throw new Error("ต้องส่ง summary สรุปผลสั้น ๆ (ขึ้นในการ์ด)");
  const row = await prisma.adsChangeProposal.findFirst({ where: { orgId, id }, select: { status: true, measurement: true } });
  if (!row) throw new AgentHttpError("ไม่พบคำขอนี้", 404);
  if (row.status !== "applied") throw new AgentHttpError("วัดผลได้เฉพาะคำขอที่ปรับสำเร็จแล้ว", 409);
  const measurement = { ...(obj(row.measurement) ?? {}), [String(days)]: { summary, metrics: obj(body.metrics), at: new Date().toISOString() } };
  await prisma.adsChangeProposal.updateMany({ where: { orgId, id }, data: { measurement: measurement as Prisma.InputJsonValue } });
  await refreshProposalCards(orgId, id);
  return { ok: true };
}

/** คำขอที่ไม่มีใครตัดสินจนเลยเวลา → หมดอายุ (เรียกตอนเปิดแดชบอร์ด/n8n ดึงรายการ) */
export async function expireStale(orgId: string): Promise<number> {
  const stale = await prisma.adsChangeProposal.findMany({
    where: { orgId, status: "pending", expiresAt: { lt: new Date() } },
    select: { id: true },
    take: 50,
  });
  if (stale.length === 0) return 0;
  await prisma.adsChangeProposal.updateMany({ where: { orgId, id: { in: stale.map((s) => s.id) }, status: "pending" }, data: { status: "expired" } });
  for (const s of stale) await refreshProposalCards(orgId, s.id);
  return stale.length;
}

// ─── หน้าแดชบอร์ด ───

export async function listProposalIds(orgId: string, opts: { status?: "open" | "done" | "all"; customerId?: string | null; take?: number }) {
  const open = ["pending", "approved", "executing"];
  const rows = await prisma.adsChangeProposal.findMany({
    where: {
      orgId,
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.status === "open" ? { status: { in: open } } : opts.status === "done" ? { status: { notIn: open } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function proposalCounts(orgId: string, customerId?: string | null) {
  const rows = await prisma.adsChangeProposal.groupBy({
    by: ["status"],
    where: { orgId, ...(customerId ? { customerId } : {}) },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Record<string, number>;
}
