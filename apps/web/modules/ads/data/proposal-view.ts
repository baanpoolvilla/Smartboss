import "server-only";
import { prisma } from "@smartboss/database";
import { ADS_BOT_CHANNEL_PREFIX } from "@/modules/chat/types";
import { PROPOSAL_STATUSES, canDecideFor, isProposalType, type ProposalStatus, type ProposalView } from "../lib/proposal-types";
import { loadAgentSettings } from "./agent-settings";

/**
 * ประกอบ ProposalView (การ์ดคำขอปรับ) — ไฟล์นี้ไม่ import อะไรจากแชท
 * แชท (serialize.ts) เรียกใช้ตอนวาดการ์ดในห้องบอท ส่วน data/proposals.ts เรียกใช้ตอนส่งการ์ด —
 * แยกไว้กัน import วนกัน (proposals → bot → chat serialize → proposals)
 */

type Row = Awaited<ReturnType<typeof loadRows>>[number];

/** สมาชิกกลุ่ม 🤖 Ads Agent ที่ยังทำงานอยู่ = คนที่กดอนุมัติได้ (อ่านตรงที่นี่ ไม่ import data/bot.ts กัน import วน) */
async function groupMemberIds(orgId: string): Promise<string[]> {
  const rows = await prisma.chatChannelMember.findMany({ where: { orgId, channelId: `${ADS_BOT_CHANNEL_PREFIX}${orgId}` }, select: { userId: true } });
  if (rows.length === 0) return [];
  const active = await prisma.user.findMany({ where: { orgId, id: { in: rows.map((r) => r.userId) }, isActive: true }, select: { id: true } });
  return active.map((u) => u.id);
}

function loadRows(orgId: string, ids: string[]) {
  return prisma.adsChangeProposal.findMany({ where: { orgId, id: { in: ids } } });
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** คำขอที่ยังรออยู่แต่เลยเวลาแล้ว — แสดงเป็นหมดอายุทันที (แถวจริงถูกเปลี่ยนตอน expireStale รอบถัดไป) */
export function effectiveStatus(row: { status: string; expiresAt: Date }): ProposalStatus {
  const s = (PROPOSAL_STATUSES as readonly string[]).includes(row.status) ? (row.status as ProposalStatus) : "pending";
  return s === "pending" && row.expiresAt.getTime() < Date.now() ? "expired" : s;
}

/**
 * ตัวสร้าง view ของหลายคำขอในรอบเดียว — viewerId คือคนที่ดูการ์ด (null = การ์ดในกลุ่มแชท หน้าจอคิด canDecide เองจาก deciderIds)
 * คืน null เมื่อไม่พบคำขอ (ถูกลบ/ไม่ใช่ของบริษัทนี้)
 */
export async function proposalViewer(orgId: string, ids: string[]): Promise<(id: string, viewerId: string | null) => ProposalView | null> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return () => null;
  const rows = await loadRows(orgId, unique);
  const userIds = [...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy]).filter((x): x is string => !!x))];
  const customerIds = [...new Set(rows.map((r) => r.customerId))];
  const [users, accounts, settings, approvers] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { orgId, id: { in: userIds } }, select: { id: true, name: true } }) : [],
    prisma.adsAccount.findMany({ where: { orgId, customerId: { in: customerIds } }, select: { customerId: true, currencyCode: true } }),
    loadAgentSettings(orgId),
    groupMemberIds(orgId),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const currencyOf = new Map(accounts.map((a) => [a.customerId, a.currencyCode]));
  const approverSet = new Set(approvers);
  const byId = new Map(rows.map((r) => [r.id, r]));

  return (id, viewerId) => {
    const r = byId.get(id);
    if (!r || !isProposalType(r.type)) return null;
    const status = effectiveStatus(r);
    const deciderIds = [...approverSet];
    return toView(r, status, {
      deciderIds,
      requestedById: r.requestedBy,
      selfApprove: settings.selfApprove,
      canDecide: canDecideFor(viewerId, { status, deciderIds, requestedById: r.requestedBy, selfApprove: settings.selfApprove }),
      requestedByName: r.requestedBy ? (nameOf.get(r.requestedBy) ?? null) : null,
      decidedByName: r.decidedBy ? (nameOf.get(r.decidedBy) ?? null) : null,
      currency: currencyOf.get(r.customerId) ?? null,
      maxBudgetChangePct: settings.maxBudgetChangePct,
    });
  };
}

function toView(
  r: Row,
  status: ProposalStatus,
  extra: Pick<ProposalView, "requestedByName" | "decidedByName" | "currency" | "canDecide" | "maxBudgetChangePct" | "deciderIds" | "requestedById" | "selfApprove">
): ProposalView {
  const measurement = obj(r.measurement) ?? {};
  const measurements = Object.entries(measurement)
    .map(([days, v]) => {
      const m = obj(v) ?? {};
      return { days: Number(days), summary: typeof m.summary === "string" ? m.summary : null, at: typeof m.at === "string" ? m.at : null };
    })
    .filter((m) => Number.isFinite(m.days))
    .sort((a, b) => a.days - b.days);
  const evidence = Array.isArray(r.evidence)
    ? (r.evidence as unknown[])
        .map((e) => obj(e))
        .filter((e): e is Record<string, unknown> => !!e && e.label != null && e.value != null)
        .map((e) => ({ label: String(e.label).slice(0, 80), value: String(e.value).slice(0, 200) }))
        .slice(0, 12)
    : [];
  return {
    id: r.id,
    code: r.code,
    type: r.type as ProposalView["type"],
    status,
    source: r.source === "command" ? "command" : "ai",
    customerId: r.customerId,
    campaignName: r.campaignName,
    adGroupName: r.adGroupName,
    targetName: r.targetName,
    before: obj(r.before),
    proposed: obj(r.proposed) ?? {},
    approved: obj(r.approved),
    reason: r.reason,
    evidence,
    risk: r.risk,
    expectedImpact: r.expectedImpact,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    executedAt: r.executedAt?.toISOString() ?? null,
    error: r.error,
    measurements,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    ...extra,
  };
}
