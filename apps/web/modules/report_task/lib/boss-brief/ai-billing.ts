import "server-only";
import OpenAI from "openai";
import { openField, sealField, fieldEncryptionConfigured } from "@smartboss/database/field-crypto";
import { createStoreIfAbsent, readStore, writeStore } from "@/modules/report_task/lib/db/org-store";

/**
 * ยอดเงิน AI จริงจาก OpenAI + คีย์แยกต่อบริษัท (13/11/2569)
 * ผู้ใช้: "อยากได้ตัวเลขจริง ๆ ไม่งั้นจะสับสน" · "เอาแค่ของเราก่อน แต่อนาคตมีหลายบริษัทก็ต้องใช้"
 *
 * คีย์ที่ใช้เรียก AI ของสรุป/ถาม AI (ลำดับ):
 *   1) ของบริษัทเอง — stores key "ai-billing" { projectId, apiKeySealed } (เข้ารหัสด้วย field-crypto) · ตั้งโดยผู้ให้บริการ (ยังไม่มีหน้าจอ)
 *   2) ของฟีเจอร์นี้ทั้งแพลตฟอร์ม — env OPENAI_BRIEF_API_KEY + OPENAI_BRIEF_PROJECT_ID (Project แยกใน OpenAI ⇒ ยอดจริงตรงกับฟีเจอร์นี้เป๊ะ)
 *   3) คีย์กลางเดิม — env OPENAI_API_KEY (ยอดจริงของ Project นั้นจะรวมฟีเจอร์ AI อื่นด้วย)
 *
 * ยอดจริง: Costs API ของ OpenAI (ต้องมี env OPENAI_ADMIN_KEY) กรองตาม projectId · ดึงทุก 3 ชม. เก็บ stores key "ai-billing-actual"
 * ใช้คู่กับยอดที่ระบบนับเอง (token จริง × ราคา) — เพดานยึดค่าที่สูงกว่าเสมอ
 */

type OrgAiConfig = { projectId?: string; apiKeySealed?: string };
export type ActualCost = { month: string; usd: number; syncedAt: string; projectId: string };

async function orgConfig(orgId: string): Promise<OrgAiConfig> {
  const { data } = await readStore<OrgAiConfig>(orgId, "ai-billing");
  return data ?? {};
}

/** projectId ของ OpenAI ที่บิลของบริษัทนี้ไปลง — ไม่รู้ = ดึงยอดจริงไม่ได้ */
export async function projectIdFor(orgId: string): Promise<string | null> {
  return (await orgConfig(orgId)).projectId || process.env.OPENAI_BRIEF_PROJECT_ID || null;
}

/** client OpenAI สำหรับสรุป/ถาม AI ของบริษัทนี้ */
export async function aiClientFor(orgId: string): Promise<OpenAI> {
  const cfg = await orgConfig(orgId);
  const own = cfg.apiKeySealed ? openField(cfg.apiKeySealed) : "";
  const apiKey = own || process.env.OPENAI_BRIEF_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ยังไม่ได้ตั้งค่า");
  return new OpenAI({ apiKey });
}

export async function readActualCost(orgId: string, month: string): Promise<ActualCost | null> {
  const { data } = await readStore<ActualCost>(orgId, "ai-billing-actual");
  return data && data.month === month ? data : null;
}

/** ดึงยอดจริงเดือนนี้จาก OpenAI (Costs API, bucket รายวัน) — ไม่มี admin key / projectId = ข้าม */
export async function syncActualCost(orgId: string, now = new Date()): Promise<ActualCost | null> {
  const admin = process.env.OPENAI_ADMIN_KEY;
  const projectId = await projectIdFor(orgId);
  if (!admin || !projectId) return null;
  // ต้นเดือนตามเวลาไทย (OpenAI นับวันแบบ UTC — ยอดช่วง 00:00–07:00 ของวันที่ 1 อาจไปตกเดือนก่อน คลาดไม่กี่สตางค์)
  const bkk = new Date(now.getTime() + 7 * 3600e3);
  const month = bkk.toISOString().slice(0, 7);
  const start = Math.floor(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), 1) / 1000);
  let usd = 0;
  let page: string | undefined;
  for (let i = 0; i < 10; i++) {
    const qs = new URLSearchParams({ start_time: String(start), bucket_width: "1d", limit: "31" });
    qs.append("project_ids", projectId);
    if (page) qs.set("page", page);
    const res = await fetch(`https://api.openai.com/v1/organization/costs?${qs}`, { headers: { Authorization: `Bearer ${admin}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`OpenAI costs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { data?: { results?: { amount?: { value?: number } }[] }[]; has_more?: boolean; next_page?: string | null };
    for (const b of body.data ?? []) for (const r of b.results ?? []) usd += Number(r.amount?.value ?? 0);
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  const out: ActualCost = { month, usd: Math.round(usd * 10000) / 10000, syncedAt: new Date().toISOString(), projectId };
  for (let i = 0; i < 3; i++) {
    const { version } = await readStore<ActualCost>(orgId, "ai-billing-actual");
    const w = version === 0 ? await createStoreIfAbsent(orgId, "ai-billing-actual", out) : await writeStore(orgId, "ai-billing-actual", out, version);
    if (w.ok) break;
  }
  return out;
}

/**
 * หน้าตั้งค่า AI (15/11/2569) — ส่วนของผู้ให้บริการ (SUPER_ADMIN): ดูว่าบริษัทนี้ใช้คีย์ไหน ตั้ง/ล้างคีย์+Project ของบริษัทเอง ทดสอบการเชื่อมต่อ
 * ไม่ส่งคีย์กลับหน้าจอเด็ดขาด — ส่งแค่ 4 ตัวท้าย
 */
export type AiBillingStatus = {
  source: "org" | "platform-brief" | "platform-main" | "none";
  projectId: string | null;
  orgProjectId: string | null;
  orgKeyHint: string | null;
  adminKey: boolean;
};

export async function billingStatus(orgId: string): Promise<AiBillingStatus> {
  const cfg = (await orgConfig(orgId)) as OrgAiConfig & { keyHint?: string };
  const source = cfg.apiKeySealed ? "org" : process.env.OPENAI_BRIEF_API_KEY ? "platform-brief" : process.env.OPENAI_API_KEY ? "platform-main" : "none";
  return {
    source,
    projectId: await projectIdFor(orgId),
    orgProjectId: cfg.projectId || null,
    orgKeyHint: cfg.apiKeySealed ? cfg.keyHint ?? "••••" : null,
    adminKey: !!process.env.OPENAI_ADMIN_KEY,
  };
}

/** apiKey: undefined = คงเดิม · "" กับ clearKey = ล้างคีย์ของบริษัท (กลับไปใช้คีย์กลาง) */
export async function saveOrgBilling(orgId: string, patch: { projectId?: string; apiKey?: string; clearKey?: boolean }): Promise<void> {
  if (patch.apiKey && !fieldEncryptionConfigured()) throw new Error("เซิร์ฟเวอร์ยังไม่ได้ตั้งกุญแจเข้ารหัส (FIELD_ENCRYPTION_KEY) — เก็บคีย์ไม่ได้");
  for (let i = 0; i < 3; i++) {
    const { data, version } = await readStore<OrgAiConfig & { keyHint?: string }>(orgId, "ai-billing");
    const next: OrgAiConfig & { keyHint?: string } = { ...(data ?? {}) };
    if (patch.projectId !== undefined) {
      const p = patch.projectId.trim();
      if (p && !/^proj_[A-Za-z0-9]{4,64}$/.test(p)) throw new Error("Project ID ต้องขึ้นต้นด้วย proj_");
      if (p) next.projectId = p;
      else delete next.projectId;
    }
    if (patch.clearKey) {
      delete next.apiKeySealed;
      delete next.keyHint;
    } else if (patch.apiKey && patch.apiKey.trim()) {
      const k = patch.apiKey.trim();
      if (!/^sk-[A-Za-z0-9_\-]{20,}$/.test(k)) throw new Error("คีย์ไม่ถูกรูปแบบ (ต้องขึ้นต้นด้วย sk-)");
      next.apiKeySealed = sealField(k);
      next.keyHint = k.slice(-4);
    }
    const w = version === 0 ? await createStoreIfAbsent(orgId, "ai-billing", next) : await writeStore(orgId, "ai-billing", next, version);
    if (w.ok) return;
  }
  throw new Error("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
}

/** ทดสอบคีย์ที่บริษัทนี้ใช้อยู่ — ขอรายชื่อรุ่น (ไม่เสียเงิน) */
export async function testAiConnection(orgId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const client = await aiClientFor(orgId);
    await client.models.list();
    return { ok: true, message: "เชื่อมต่อ OpenAI ได้" };
  } catch (e) {
    const status = (e as { status?: number }).status;
    return { ok: false, message: status === 401 ? "คีย์ใช้ไม่ได้ (401)" : `เชื่อมต่อไม่ได้: ${(e as Error).message.slice(0, 150)}` };
  }
}
