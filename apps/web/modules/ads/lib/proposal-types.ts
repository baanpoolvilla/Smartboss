/**
 * คำขอปรับ Google Ads ที่ AI บน n8n เสนอ (หรือคนพิมพ์สั่งบอท) — ชนิด ป้าย และรูปข้อมูล
 *
 * ไฟล์นี้ไม่มี "server-only" — การ์ดในแชทและหน้าแดชบอร์ดฝั่ง client ใช้ชุดเดียวกัน
 *
 * รูปข้อมูลของ `proposed` / `approved` / `before` แยกตามชนิด:
 *   add_negative_keywords  { level: "ad_group"|"campaign", keywords: [{ text, match_type, clicks?, cost?, conversions? }] }
 *                          approved = รายการที่คนติ๊กไว้ (ติ๊กออกได้ ไม่เพิ่มคำเองได้)
 *   pause_keyword / enable_keyword       { status: "PAUSED"|"ENABLED" }   (target = keyword criterion)
 *   pause_ad_group / enable_ad_group     { status: "PAUSED"|"ENABLED" }   (target = ad group)
 *   set_campaign_budget    { amount }  งบรายวัน หน่วยสกุลเงินของบัญชี (ไม่ใช่ micros) · แก้ตัวเลขก่อนอนุมัติได้
 *   set_keyword_bid        { cpc_bid } · แก้ตัวเลขก่อนอนุมัติได้
 */

export const PROPOSAL_TYPES = [
  "add_negative_keywords",
  "pause_keyword",
  "enable_keyword",
  "pause_ad_group",
  "enable_ad_group",
  "set_campaign_budget",
  "set_keyword_bid",
] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

export const PROPOSAL_TYPE_LABEL: Record<ProposalType, string> = {
  add_negative_keywords: "เพิ่ม Negative keyword",
  pause_keyword: "หยุดคีย์เวิร์ด",
  enable_keyword: "เปิดคีย์เวิร์ด",
  pause_ad_group: "หยุดกลุ่มโฆษณา",
  enable_ad_group: "เปิดกลุ่มโฆษณา",
  set_campaign_budget: "ปรับงบรายวันแคมเปญ",
  set_keyword_bid: "ปรับ bid คีย์เวิร์ด",
};

export function isProposalType(v: unknown): v is ProposalType {
  return typeof v === "string" && (PROPOSAL_TYPES as readonly string[]).includes(v);
}

export const PROPOSAL_STATUSES = ["pending", "approved", "executing", "applied", "failed", "stale", "rejected", "expired"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** tone ใช้เลือกสีป้าย — wait/run/ok/bad/muted */
export const PROPOSAL_STATUS: Record<ProposalStatus, { label: string; tone: "wait" | "run" | "ok" | "bad" | "muted" }> = {
  pending: { label: "รออนุมัติ", tone: "wait" },
  approved: { label: "อนุมัติแล้ว · รอระบบปรับ", tone: "run" },
  executing: { label: "กำลังปรับ Google Ads", tone: "run" },
  applied: { label: "ปรับแล้ว", tone: "ok" },
  failed: { label: "ปรับไม่สำเร็จ", tone: "bad" },
  stale: { label: "ใช้ไม่ได้แล้ว (ค่าใน Google เปลี่ยน)", tone: "muted" },
  rejected: { label: "ปฏิเสธ", tone: "bad" },
  expired: { label: "หมดอายุ", tone: "muted" },
};

export const RISK_LABEL: Record<string, string> = { low: "ต่ำ", medium: "กลาง", high: "สูง" };

/** เหตุผลสำเร็จรูปตอนกดปฏิเสธ — พิมพ์เองได้เสมอ */
export const REJECT_REASONS = ["ยังไม่ถึงเวลา", "ตัวเลขยังไม่พอ", "คำนี้ลูกค้าใช้จริง", "ผิดแคมเปญ/กลุ่ม"];

export interface NegativeKeyword {
  text: string;
  match_type: "EXACT" | "PHRASE" | "BROAD";
  clicks?: number | null;
  cost?: number | null;
  conversions?: number | null;
}

/** การ์ดคำขอปรับหนึ่งใบ ตามที่คนดูคนนี้เห็น — ใช้ทั้งการ์ดในแชทและหน้าแดชบอร์ด */
export interface ProposalView {
  id: string;
  code: string;
  type: ProposalType;
  status: ProposalStatus;
  source: "ai" | "command";
  requestedByName: string | null;
  customerId: string;
  currency: string | null;
  campaignName: string | null;
  adGroupName: string | null;
  targetName: string | null;
  before: Record<string, unknown> | null;
  proposed: Record<string, unknown>;
  approved: Record<string, unknown> | null;
  reason: string;
  evidence: { label: string; value: string }[];
  risk: string;
  expectedImpact: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executedAt: string | null;
  error: string | null;
  /** ผลวัดหลังปรับ เรียงตามจำนวนวัน */
  measurements: { days: number; summary: string | null; at: string | null }[];
  expiresAt: string;
  createdAt: string;
  /** คนดูคนนี้กดอนุมัติ/ปฏิเสธได้ตอนนี้ — การ์ดในแชทคิดใหม่ฝั่งหน้าจอด้วย canDecideFor(meId, …) */
  canDecide: boolean;
  /** สมาชิกกลุ่ม 🤖 Ads Agent ตอนนี้ = คนที่กดอนุมัติได้ */
  deciderIds: string[];
  requestedById: string | null;
  /** นโยบายบริษัท: คนสั่งบอทอนุมัติคำขอของตัวเองได้ไหม */
  selfApprove: boolean;
  /** เพดานการปรับงบของบริษัท (%) — ให้ช่องแก้ตัวเลขเตือนก่อนส่ง */
  maxBudgetChangePct: number | null;
}

/** กดอนุมัติ/ปฏิเสธได้ไหม — ยังรออยู่ + เป็นสมาชิกกลุ่ม Ads Agent + (บริษัทให้อนุมัติของตัวเองได้ หรือไม่ใช่คนสั่ง) */
export function canDecideFor(
  viewerId: string | null | undefined,
  p: { status: ProposalStatus; deciderIds: string[]; requestedById: string | null; selfApprove: boolean }
): boolean {
  return !!viewerId && p.status === "pending" && p.deciderIds.includes(viewerId) && (p.selfApprove || p.requestedById !== viewerId);
}

export const numberOf = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** รายการคำของ add_negative_keywords จาก JSON ที่ไม่รู้รูป */
export function negativeKeywords(v: unknown): NegativeKeyword[] {
  const list = v && typeof v === "object" ? (v as { keywords?: unknown }).keywords : null;
  if (!Array.isArray(list)) return [];
  return list
    .filter((k): k is Record<string, unknown> => !!k && typeof k === "object" && typeof (k as { text?: unknown }).text === "string")
    .map((k) => ({
      text: String(k.text).trim(),
      match_type: (k.match_type === "EXACT" || k.match_type === "BROAD" ? k.match_type : "PHRASE") as NegativeKeyword["match_type"],
      clicks: numberOf(k.clicks),
      cost: numberOf(k.cost),
      conversions: numberOf(k.conversions),
    }))
    .filter((k) => k.text.length > 0);
}

/** ค่าตัวเลขที่ชนิดนั้นปรับ (งบ / bid) — null = ชนิดที่ไม่ใช่ตัวเลข */
export function numericField(type: ProposalType): "amount" | "cpc_bid" | null {
  if (type === "set_campaign_budget") return "amount";
  if (type === "set_keyword_bid") return "cpc_bid";
  return null;
}

/** ข้อความสั้นหนึ่งบรรทัด — ใช้เป็นตัวอย่างข้อความล่าสุดในรายการห้องแชท และหัวแจ้งเตือน */
export function proposalHeadline(p: Pick<ProposalView, "type" | "proposed" | "campaignName" | "adGroupName" | "targetName">): string {
  const where = p.adGroupName ?? p.campaignName ?? "";
  if (p.type === "add_negative_keywords") {
    const n = negativeKeywords(p.proposed).length;
    return `${PROPOSAL_TYPE_LABEL[p.type]} ${n} คำ${where ? ` · ${where}` : ""}`;
  }
  const target = p.targetName ?? where;
  return `${PROPOSAL_TYPE_LABEL[p.type]}${target ? ` · ${target}` : ""}`;
}
