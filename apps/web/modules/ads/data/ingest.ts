import "server-only";
import { prisma } from "@smartboss/database";
import { isDate, toDbDate } from "../lib/periods";

/**
 * รับข้อมูลโฆษณาที่ n8n ดึงจาก Google Ads แล้วส่งเข้ามา (ผู้ใช้ 17/11/2569: n8n ดึงแล้วส่งเข้า Smartboss)
 * เขียนลงตาราง ads_* ชุดเดิม — แดชบอร์ดและ Rule Engine อ่านจากตารางเดิมทุกอย่าง ไม่ต้องรู้ว่าใครดึงมา
 *
 * รูปข้อมูลแต่ละแถว (snake_case ตามที่ GAQL คืนมาแบบแบน):
 *   cost ใส่เป็นหน่วยเงิน (฿) หรือส่ง cost_micros มาแทนก็ได้ (หารล้านให้)
 *   *_impr_share / *_lost_is / *_impr_pct เป็นเศษส่วน 0–1 ตามที่ API ส่ง (ส่งมาเป็น % เกิน 1 จะหาร 100 ให้)
 *   date = YYYY-MM-DD · ไม่ส่ง date = อัปเดตแค่ชื่อ/สถานะ (dimension) ไม่ลงตัวเลขรายวัน
 *
 * upsert ทับของเดิม — ส่งช่วงเดิมซ้ำได้ (conversion ของวันก่อนยังเปลี่ยนได้ ควรส่งย้อน 30 วันทุกรอบ)
 */

export const MAX_ROWS_PER_CALL = 5000;

type Obj = Record<string, unknown>;
const num = (v: unknown): number => (v == null || v === "" ? 0 : Number(v) || 0);
const optNum = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown, max: number): string | null => (v == null || v === "" ? null : String(v).slice(0, max));
const id = (v: unknown): string | null => (v != null && /^\d{1,19}$/.test(String(v)) ? String(v) : null);
const money = (r: Obj, key: string): number => {
  if (r[key] != null && r[key] !== "") return Math.round(num(r[key]) * 100) / 100;
  if (r[`${key}_micros`] != null) return Math.round(num(r[`${key}_micros`]) / 10_000) / 100;
  return 0;
};
const optMoney = (r: Obj, key: string): number | null => {
  if (r[key] != null && r[key] !== "") return optNum(r[key]);
  if (r[`${key}_micros`] != null) return Math.round(num(r[`${key}_micros`]) / 10_000) / 100;
  return null;
};
const share = (v: unknown): number | null => {
  const n = optNum(v);
  if (n == null) return null;
  return n > 1 ? Math.min(1, n / 100) : Math.max(0, n);
};

function rowsOf(body: Obj): Obj[] {
  const rows = body.rows;
  if (!Array.isArray(rows)) throw new Error("ต้องส่ง rows เป็น array");
  if (rows.length > MAX_ROWS_PER_CALL) throw new Error(`ส่งได้ครั้งละไม่เกิน ${MAX_ROWS_PER_CALL} แถว — แบ่งส่งหลายรอบ`);
  return rows.filter((r): r is Obj => !!r && typeof r === "object");
}

function dateOf(r: Obj): string | null {
  const d = r.date ?? r.segments_date;
  return isDate(d) ? (d as string) : null;
}

// ─── bulk upsert — ทีละ 500 แถว · ON CONFLICT ทับได้เฉพาะแถวของบริษัทเดียวกัน ───
type Cast = "bigint" | "date" | "numeric" | "text" | "timestamp";
interface Col {
  name: string;
  cast: Cast;
}

async function bulkUpsert(table: string, cols: Col[], conflict: string[], rows: unknown[][]): Promise<number> {
  const update = cols.filter((c) => !conflict.includes(c.name)).map((c) => `"${c.name}" = EXCLUDED."${c.name}"`);
  let total = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const params: unknown[] = [];
    const values = chunk.map((row) => {
      const ph = cols.map((c, j) => {
        params.push(row[j]);
        return `$${params.length}::${c.cast}`;
      });
      return `(${ph.join(", ")})`;
    });
    // id ของแคมเปญ/กลุ่ม/คีย์เวิร์ดเป็นของ Google (unique ทั้งโลก) — ถ้าบังเอิญชนกับแถวของบริษัทอื่น ไม่ทับ
    const sql =
      `INSERT INTO "ads"."${table}" (${cols.map((c) => `"${c.name}"`).join(", ")}) VALUES ${values.join(", ")} ` +
      `ON CONFLICT (${conflict.map((c) => `"${c}"`).join(", ")}) DO UPDATE SET ${update.join(", ")} ` +
      `WHERE "ads"."${table}"."org_id" = EXCLUDED."org_id"`;
    total += await prisma.$executeRawUnsafe(sql, ...params);
  }
  return total;
}

const METRIC_COLS: Col[] = [
  { name: "impressions", cast: "bigint" },
  { name: "clicks", cast: "bigint" },
  { name: "cost", cast: "numeric" },
  { name: "conversions", cast: "numeric" },
];

// ─── บัญชี ───

export async function ingestAccounts(orgId: string, body: Obj): Promise<{ upserted: number }> {
  const list = Array.isArray(body.accounts) ? body.accounts : [];
  if (list.length === 0) throw new Error("ต้องส่ง accounts เป็น array อย่างน้อย 1 บัญชี");
  let upserted = 0;
  for (const raw of list) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Obj;
    const customerId = String(r.customer_id ?? "").replace(/\D/g, "");
    if (!customerId) throw new Error("ทุกบัญชีต้องมี customer_id");
    await ensureAccount(orgId, customerId, {
      name: str(r.name ?? r.descriptive_name, 255),
      currencyCode: str(r.currency_code, 3),
      timeZone: str(r.time_zone, 64),
    });
    upserted++;
  }
  return { upserted };
}

/** บัญชีต้องเป็นของบริษัทนี้ — ยังไม่มีสร้างให้ · เป็นของบริษัทอื่น = error (ไม่ให้เขียนข้ามบริษัท) */
async function ensureAccount(
  orgId: string,
  customerId: string,
  info: { name?: string | null; currencyCode?: string | null; timeZone?: string | null } = {}
): Promise<void> {
  const existing = await prisma.adsAccount.findUnique({ where: { customerId }, select: { orgId: true } });
  if (existing && existing.orgId !== orgId) throw new Error(`บัญชี ${customerId} ผูกกับบริษัทอื่นอยู่`);
  const data = Object.fromEntries(Object.entries(info).filter(([, v]) => v != null));
  if (existing) {
    if (Object.keys(data).length > 0) await prisma.adsAccount.updateMany({ where: { orgId, customerId }, data });
  } else {
    await prisma.adsAccount.create({ data: { orgId, customerId, ...data } });
  }
}

function customerOf(body: Obj): string {
  const customerId = String(body.customer_id ?? "").replace(/\D/g, "");
  if (!customerId) throw new Error("ต้องส่ง customer_id ของบัญชีโฆษณา");
  return customerId;
}

// ─── แคมเปญ ───

export async function ingestCampaigns(orgId: string, body: Obj): Promise<{ rows: number }> {
  const customerId = customerOf(body);
  await ensureAccount(orgId, customerId);
  const now = new Date();
  const dims = new Map<string, unknown[]>();
  const facts: unknown[][] = [];
  for (const r of rowsOf(body)) {
    const cid = id(r.campaign_id);
    if (!cid) throw new Error("ทุกแถวต้องมี campaign_id เป็นตัวเลข");
    dims.set(cid, [cid, orgId, customerId, str(r.name ?? r.campaign_name, 255), str(r.status, 20), str(r.channel_type, 40), optMoney(r, "daily_budget"), now]);
    const date = dateOf(r);
    if (date) {
      facts.push([
        cid, date, orgId,
        num(r.impressions), num(r.clicks), money(r, "cost"), num(r.conversions), num(r.conversions_value),
        share(r.search_impr_share), share(r.search_budget_lost_is), share(r.search_rank_lost_is),
        share(r.top_impr_pct), share(r.abs_top_impr_pct),
      ]);
    }
  }
  let n = await bulkUpsert(
    "ads_campaigns",
    [
      { name: "campaign_id", cast: "bigint" }, { name: "org_id", cast: "text" }, { name: "customer_id", cast: "text" },
      { name: "name", cast: "text" }, { name: "status", cast: "text" }, { name: "channel_type", cast: "text" },
      { name: "daily_budget", cast: "numeric" }, { name: "updated_at", cast: "timestamp" },
    ],
    ["campaign_id"],
    [...dims.values()]
  );
  n += await bulkUpsert(
    "ads_campaign_daily",
    [
      { name: "campaign_id", cast: "bigint" }, { name: "date", cast: "date" }, { name: "org_id", cast: "text" },
      ...METRIC_COLS, { name: "conversions_value", cast: "numeric" },
      { name: "search_impr_share", cast: "numeric" }, { name: "search_budget_lost_is", cast: "numeric" },
      { name: "search_rank_lost_is", cast: "numeric" }, { name: "top_impr_pct", cast: "numeric" },
      { name: "abs_top_impr_pct", cast: "numeric" },
    ],
    ["campaign_id", "date"],
    facts
  );
  return { rows: n };
}

// ─── กลุ่มโฆษณา ───

export async function ingestAdGroups(orgId: string, body: Obj): Promise<{ rows: number }> {
  const customerId = customerOf(body);
  await ensureAccount(orgId, customerId);
  const now = new Date();
  const dims = new Map<string, unknown[]>();
  const facts: unknown[][] = [];
  for (const r of rowsOf(body)) {
    const ag = id(r.ad_group_id);
    const cid = id(r.campaign_id);
    if (!ag || !cid) throw new Error("ทุกแถวต้องมี ad_group_id และ campaign_id เป็นตัวเลข");
    dims.set(ag, [ag, orgId, cid, str(r.name ?? r.ad_group_name, 255), str(r.status, 20), now]);
    const date = dateOf(r);
    if (date) {
      facts.push([
        ag, date, orgId,
        num(r.impressions), num(r.clicks), money(r, "cost"), num(r.conversions), num(r.conversions_value),
        share(r.top_impr_pct), share(r.abs_top_impr_pct),
      ]);
    }
  }
  let n = await bulkUpsert(
    "ads_ad_groups",
    [
      { name: "ad_group_id", cast: "bigint" }, { name: "org_id", cast: "text" }, { name: "campaign_id", cast: "bigint" },
      { name: "name", cast: "text" }, { name: "status", cast: "text" }, { name: "updated_at", cast: "timestamp" },
    ],
    ["ad_group_id"],
    [...dims.values()]
  );
  n += await bulkUpsert(
    "ads_ad_group_daily",
    [
      { name: "ad_group_id", cast: "bigint" }, { name: "date", cast: "date" }, { name: "org_id", cast: "text" },
      ...METRIC_COLS, { name: "conversions_value", cast: "numeric" },
      { name: "top_impr_pct", cast: "numeric" }, { name: "abs_top_impr_pct", cast: "numeric" },
    ],
    ["ad_group_id", "date"],
    facts
  );
  return { rows: n };
}

// ─── คีย์เวิร์ด ───

export async function ingestKeywords(orgId: string, body: Obj): Promise<{ rows: number }> {
  const customerId = customerOf(body);
  await ensureAccount(orgId, customerId);
  const facts: unknown[][] = [];
  for (const r of rowsOf(body)) {
    const crit = id(r.criterion_id);
    const ag = id(r.ad_group_id);
    const date = dateOf(r);
    if (!crit || !ag || !date) throw new Error("ทุกแถวต้องมี criterion_id, ad_group_id และ date (YYYY-MM-DD)");
    facts.push([
      crit, ag, date, orgId, str(r.text ?? r.keyword_text, 255), str(r.match_type, 20),
      num(r.impressions), num(r.clicks), money(r, "cost"), num(r.conversions),
    ]);
  }
  const n = await bulkUpsert(
    "ads_keyword_daily",
    [
      { name: "criterion_id", cast: "bigint" }, { name: "ad_group_id", cast: "bigint" }, { name: "date", cast: "date" },
      { name: "org_id", cast: "text" }, { name: "keyword_text", cast: "text" }, { name: "match_type", cast: "text" },
      ...METRIC_COLS,
    ],
    ["ad_group_id", "criterion_id", "date"],
    facts
  );
  return { rows: n };
}

// ─── คำค้นหาจริง — รวมแถวซ้ำ (คำเดียวกัน กลุ่มเดียวกัน วันเดียวกัน) ก่อนเขียน ───

export async function ingestSearchTerms(orgId: string, body: Obj): Promise<{ rows: number }> {
  const customerId = customerOf(body);
  await ensureAccount(orgId, customerId);
  const terms = new Map<string, unknown[]>();
  for (const r of rowsOf(body)) {
    const ag = id(r.ad_group_id);
    const date = dateOf(r);
    const term = str(r.search_term, 500);
    if (!ag || !date || !term) throw new Error("ทุกแถวต้องมี ad_group_id, date และ search_term");
    const key = `${ag}|${date}|${term}`;
    const vals = [num(r.impressions), num(r.clicks), money(r, "cost"), num(r.conversions)];
    const prev = terms.get(key);
    if (prev) for (let i = 0; i < 4; i++) prev[4 + i] = (prev[4 + i] as number) + vals[i]!;
    else terms.set(key, [orgId, ag, date, term, ...vals]);
  }
  const n = await bulkUpsert(
    "ads_search_term_daily",
    [
      { name: "org_id", cast: "text" }, { name: "ad_group_id", cast: "bigint" }, { name: "date", cast: "date" },
      { name: "search_term", cast: "text" }, ...METRIC_COLS,
    ],
    ["ad_group_id", "date", "search_term"],
    [...terms.values()]
  );
  return { rows: n };
}

// ─── จบรอบ — บันทึก log + เวลาซิงค์ล่าสุดของบัญชี ───

export async function ingestComplete(orgId: string, body: Obj): Promise<{ ok: true }> {
  const customerId = customerOf(body);
  await ensureAccount(orgId, customerId);
  const status = body.status === "failed" ? "failed" : body.status === "retried" ? "retried" : "success";
  const from = isDate(body.from) ? toDbDate(body.from as string) : null;
  const to = isDate(body.to) ? toDbDate(body.to as string) : null;
  const startedAt = typeof body.started_at === "string" && !Number.isNaN(Date.parse(body.started_at)) ? new Date(body.started_at) : new Date();
  await prisma.adsSyncLog.create({
    data: {
      orgId,
      customerId,
      jobType: "n8n",
      rangeFrom: from,
      rangeTo: to,
      rowsUpserted: Math.max(0, Math.round(num(body.rows_upserted))),
      durationMs: Math.max(0, Math.round(num(body.duration_ms))),
      status,
      errorMessage: str(body.error, 4000),
      startedAt,
    },
  });
  if (status !== "failed") await prisma.adsAccount.updateMany({ where: { orgId, customerId }, data: { lastSyncedAt: new Date() } });
  return { ok: true };
}
