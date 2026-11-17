import "server-only";
import { randomBytes } from "node:crypto";
import { prisma, type Prisma } from "@smartboss/database";
import { PROPOSAL_TYPES, isProposalType, type ProposalType } from "../lib/proposal-types";

/**
 * การเชื่อมต่อ n8n + นโยบายคำขอปรับ (รายบริษัท) — ตาราง ads_agent_settings
 *
 * ค่าเริ่มต้นตอนยังไม่มีแถว: เปิดทุกชนิดคำขอ · ปรับงบได้ไม่เกิน 30% · หมดอายุ 72 ชม. ·
 * คนสั่งบอทอนุมัติคำขอของตัวเองได้ — ทุกค่าแก้ได้ที่หน้า "การเชื่อมต่อ n8n" (ห้าม hard code กฎธุรกิจ)
 */

/** n8n ไม่ส่งอะไรมาเลยเกินกี่นาที ถือว่าออฟไลน์ (เครื่อง Windows หลับ/รีบูต/เน็ตหลุด) */
export const AGENT_OFFLINE_AFTER_MINUTES = 15;

export interface AgentSettings {
  webhookUrl: string | null;
  hasWebhookSecret: boolean;
  allowedTypes: ProposalType[];
  maxBudgetChangePct: number;
  proposalExpiryHours: number;
  selfApprove: boolean;
  lastSeenAt: Date | null;
  lastSeenInfo: Record<string, unknown> | null;
}

const DEFAULTS = {
  allowedTypes: [...PROPOSAL_TYPES] as ProposalType[],
  maxBudgetChangePct: 30,
  proposalExpiryHours: 72,
  selfApprove: true,
};

export async function loadAgentSettings(orgId: string): Promise<AgentSettings> {
  const row = await prisma.adsAgentSetting.findUnique({ where: { orgId } });
  if (!row) return { webhookUrl: null, hasWebhookSecret: false, ...DEFAULTS, lastSeenAt: null, lastSeenInfo: null };
  return {
    webhookUrl: row.webhookUrl,
    hasWebhookSecret: !!row.webhookSecret,
    allowedTypes: row.allowedTypes.filter(isProposalType),
    maxBudgetChangePct: Number(row.maxBudgetChangePct),
    proposalExpiryHours: row.proposalExpiryHours,
    selfApprove: row.selfApprove,
    lastSeenAt: row.lastSeenAt,
    lastSeenInfo: row.lastSeenInfo && typeof row.lastSeenInfo === "object" ? (row.lastSeenInfo as Record<string, unknown>) : null,
  };
}

/** สร้างแถวด้วยค่าเริ่มต้นถ้ายังไม่มี — ทุกจุดที่เขียนแถวนี้ต้องผ่านตรงนี้ ไม่งั้นแถวใหม่ได้ allowed_types ว่าง (ปิดทุกชนิด) */
async function ensureRow(orgId: string): Promise<void> {
  await prisma.adsAgentSetting.upsert({
    where: { orgId },
    update: {},
    create: { orgId, allowedTypes: DEFAULTS.allowedTypes, maxBudgetChangePct: DEFAULTS.maxBudgetChangePct, proposalExpiryHours: DEFAULTS.proposalExpiryHours, selfApprove: DEFAULTS.selfApprove },
  });
}

export async function saveAgentSettings(orgId: string, input: Record<string, unknown>): Promise<void> {
  const url = typeof input.webhook_url === "string" ? input.webhook_url.trim() : "";
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Webhook URL ไม่ถูกต้อง");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Webhook URL ต้องขึ้นต้นด้วย https://");
  }
  const types = Array.isArray(input.allowed_types) ? input.allowed_types.filter(isProposalType) : DEFAULTS.allowedTypes;
  const pct = Number(input.max_budget_change_pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 500) throw new Error("เพดานปรับงบต้องอยู่ระหว่าง 1–500%");
  const hours = Number(input.proposal_expiry_hours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new Error("อายุคำขอต้องเป็นจำนวนชั่วโมง 1–720");

  await ensureRow(orgId);
  await prisma.adsAgentSetting.update({
    where: { orgId },
    data: {
      webhookUrl: url || null,
      allowedTypes: [...new Set(types)],
      maxBudgetChangePct: pct,
      proposalExpiryHours: hours,
      selfApprove: input.self_approve === true,
    },
  });
}

/** ออก secret ใหม่สำหรับเซ็น webhook — คืนค่าเต็มครั้งเดียว (เอาไปใส่ใน n8n) */
export async function rotateWebhookSecret(orgId: string): Promise<string> {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  await ensureRow(orgId);
  await prisma.adsAgentSetting.update({ where: { orgId }, data: { webhookSecret: secret } });
  return secret;
}

export async function webhookTarget(orgId: string): Promise<{ url: string; secret: string } | null> {
  const row = await prisma.adsAgentSetting.findUnique({ where: { orgId }, select: { webhookUrl: true, webhookSecret: true } });
  return row?.webhookUrl && row.webhookSecret ? { url: row.webhookUrl, secret: row.webhookSecret } : null;
}

/** n8n ยังติดต่อมา — ทุกคำขอด้วย token นับเป็นสัญญาณชีพ (เขียนไม่เกินนาทีละครั้ง) · heartbeat ส่ง info มาด้วยได้ */
export async function touchAgentSeen(orgId: string, info?: Record<string, unknown>): Promise<void> {
  await ensureRow(orgId);
  if (info) {
    await prisma.adsAgentSetting.update({ where: { orgId }, data: { lastSeenAt: new Date(), lastSeenInfo: info as Prisma.InputJsonValue } });
    return;
  }
  await prisma.adsAgentSetting.updateMany({
    where: { orgId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(Date.now() - 60_000) } }] },
    data: { lastSeenAt: new Date() },
  });
}

export function agentOnline(lastSeenAt: Date | null): boolean {
  return !!lastSeenAt && Date.now() - lastSeenAt.getTime() < AGENT_OFFLINE_AFTER_MINUTES * 60_000;
}
