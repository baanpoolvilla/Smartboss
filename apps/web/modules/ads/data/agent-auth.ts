import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@smartboss/database";
import { ADS_CODE } from "../constants";
import { touchAgentSeen } from "./agent-settings";

/**
 * token ของ n8n — เรียก /api/agent/ads/* ด้วย header `Authorization: Bearer sbads_…`
 *
 * token ผูกกับบริษัทเดียว (orgId มาจาก token ไม่ใช่จากสิ่งที่ n8n ส่งมา — n8n ระบุบริษัทอื่นเองไม่ได้)
 * เก็บแค่ SHA-256 ของ token · ตัวเต็มแสดงครั้งเดียวตอนสร้าง · ยกเลิกได้ทันที
 */

const PREFIX = "sbads_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAgentToken(orgId: string, name: string, createdBy: string): Promise<{ id: string; token: string }> {
  const label = name.trim().slice(0, 100);
  if (!label) throw new Error("ตั้งชื่อ token ก่อน เช่น \"n8n เครื่องออฟฟิศ\"");
  const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = await prisma.adsAgentToken.create({
    data: { orgId, name: label, tokenPrefix: token.slice(0, 12), tokenHash: hashToken(token), createdBy },
    select: { id: true },
  });
  return { id: row.id, token };
}

export async function listAgentTokens(orgId: string) {
  return prisma.adsAgentToken.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, tokenPrefix: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
}

export async function revokeAgentToken(orgId: string, id: string): Promise<void> {
  const res = await prisma.adsAgentToken.updateMany({ where: { orgId, id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (res.count === 0) throw new Error("ไม่พบ token นี้ หรือถูกยกเลิกไปแล้ว");
}

export interface AgentContext {
  orgId: string;
  tokenId: string;
}

export class AgentAuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

/** ตรวจ token ของคำขอ → บริษัทที่ token นี้ผูกไว้ · บริษัทต้องเปิดโมดูล ads อยู่ */
export async function authenticateAgent(req: Request): Promise<AgentContext> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith(PREFIX)) throw new AgentAuthError("ต้องส่ง Authorization: Bearer <token ของ n8n>", 401);

  // lookup ด้วย unique key (hash) — ยังไม่รู้ orgId ตอนนี้ orgId คือคำตอบของ query นี้
  const row = await prisma.adsAgentToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, orgId: true, revokedAt: true, lastUsedAt: true },
  });
  if (!row || row.revokedAt) throw new AgentAuthError("token ไม่ถูกต้อง หรือถูกยกเลิกแล้ว", 401);

  const enabled = await prisma.orgModule.findFirst({
    where: { orgId: row.orgId, isEnabled: true, module: { code: ADS_CODE } },
    select: { orgId: true },
  });
  if (!enabled) throw new AgentAuthError("บริษัทนี้ปิดโมดูล Google Ads อยู่", 403);

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.adsAgentToken.updateMany({ where: { orgId: row.orgId, id: row.id }, data: { lastUsedAt: new Date() } });
  }
  await touchAgentSeen(row.orgId);
  return { orgId: row.orgId, tokenId: row.id };
}

const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** อ่าน JSON body ของ n8n — ไม่ใช่ object = error (ไม่เงียบ ๆ ทำต่อด้วย {}) */
export async function readAgentJson(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new Error("ข้อมูลใหญ่เกิน 10 MB — แบ่งส่งเป็นหลายรอบ");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new Error("body ต้องเป็น JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("body ต้องเป็น JSON object");
  return body as Record<string, unknown>;
}

/**
 * ห่อ Route Handler ของ /api/agent/ads/* — ตรวจ token → เรียก handler → JSON
 * error จาก data layer ตอบ 400 พร้อมข้อความ (n8n เอาไปแสดง/ตัดสินใจต่อได้) · BigInt เป็น string
 */
export function agentRoute<P = Record<string, string>>(handler: (req: Request, ctx: AgentContext, params: P) => Promise<unknown>) {
  return async (req: Request, route: { params: Promise<P> }): Promise<Response> => {
    let ctx: AgentContext;
    try {
      ctx = await authenticateAgent(req);
    } catch (err) {
      const status = err instanceof AgentAuthError ? err.status : 401;
      return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status });
    }
    try {
      const result = await handler(req, ctx, await route.params);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? String(v) : v)), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      const status = err instanceof AgentHttpError ? err.status : 400;
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err), ...(err instanceof AgentHttpError ? err.extra : {}) },
        { status }
      );
    }
  };
}

/** error ที่ต้องการ status เฉพาะ เช่น 404 / 409 (จองคำขอที่ไม่ได้อยู่ในสถานะอนุมัติแล้ว) */
export class AgentHttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}
