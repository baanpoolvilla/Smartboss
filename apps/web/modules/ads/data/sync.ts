import "server-only";
import { prisma } from "@smartboss/database";
import { searchStream } from "../lib/google-ads-client";
import { sendMail, mailConfigured } from "../lib/mailer";
import { addDays, monthlyChunks, todayIn, toDbDate, type Period } from "../lib/periods";

/**
 * Sync Job (spec §3) — ดึงข้อมูลจาก Google Ads API มา upsert ลงตาราง ads_*
 *
 *   daily    ทุกวัน 06:00 (cron)        ย้อนหลัง 30 วัน upsert ทับ
 *   manual   ปุ่ม "ซิงค์ทันที"           ย้อนหลัง 30 วัน
 *   backfill ครั้งเดียวตอนติดตั้ง         ย้อนหลัง 12–24 เดือน (ทีละเดือน)
 *
 * ต้องดึงย้อนหลังทุกรอบ เพราะ conversion ของวันก่อนยังถูกอัปเดตได้ (conversion lag)
 */

export type JobType = "daily" | "manual" | "backfill";
export const SYNC_LOOKBACK_DAYS = 30;

// ─── แปลงค่าจาก REST (int64 เป็น string, เงินเป็น micros, ค่า 0 อาจถูกละไว้) ───
type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const optN = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const micros = (v: unknown): number => Math.round(n(v) / 10_000) / 100;
const s = (v: unknown, max: number): string | null => (v == null ? null : String(v).slice(0, max));

// ─── bulk upsert — ทีละ 500 แถวด้วย INSERT ... ON CONFLICT ───
type Cast = "bigint" | "date" | "numeric" | "text" | "int" | "timestamp";
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
    const sql =
      `INSERT INTO "ads"."${table}" (${cols.map((c) => `"${c.name}"`).join(", ")}) VALUES ${values.join(", ")} ` +
      `ON CONFLICT (${conflict.map((c) => `"${c}"`).join(", ")}) DO UPDATE SET ${update.join(", ")}`;
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

// ─── Query (spec §3.2) ───
const q = (from: string, to: string) => ({
  campaign: `SELECT campaign.id, campaign.name, campaign.status,
       campaign.advertising_channel_type,
       campaign_budget.amount_micros, segments.date,
       metrics.impressions, metrics.clicks, metrics.cost_micros,
       metrics.conversions, metrics.conversions_value,
       metrics.search_impression_share,
       metrics.search_budget_lost_impression_share,
       metrics.search_rank_lost_impression_share,
       metrics.top_impression_percentage,
       metrics.absolute_top_impression_percentage
FROM campaign
WHERE segments.date BETWEEN '${from}' AND '${to}'`,
  adGroup: `SELECT campaign.id, ad_group.id, ad_group.name, ad_group.status,
       segments.date,
       metrics.impressions, metrics.clicks, metrics.cost_micros,
       metrics.conversions, metrics.conversions_value,
       metrics.top_impression_percentage,
       metrics.absolute_top_impression_percentage
FROM ad_group
WHERE segments.date BETWEEN '${from}' AND '${to}'`,
  keyword: `SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id,
       ad_group_criterion.keyword.text,
       ad_group_criterion.keyword.match_type,
       segments.date,
       metrics.impressions, metrics.clicks, metrics.cost_micros,
       metrics.conversions
FROM keyword_view
WHERE segments.date BETWEEN '${from}' AND '${to}'`,
  searchTerm: `SELECT search_term_view.search_term, campaign.id, ad_group.id,
       segments.date,
       metrics.impressions, metrics.clicks, metrics.cost_micros,
       metrics.conversions
FROM search_term_view
WHERE segments.date BETWEEN '${from}' AND '${to}'`,
});

interface ChunkResult {
  rows: number;
  retried: boolean;
}

async function syncChunk(orgId: string, customerId: string, range: Period): Promise<ChunkResult> {
  const queries = q(range.from, range.to);
  let rows = 0;
  let retried = false;
  const now = new Date();

  // ── แคมเปญ ──
  const camp = await searchStream<Obj>(customerId, queries.campaign);
  retried ||= camp.retried;
  const campDims = new Map<string, unknown[]>();
  const campFacts: unknown[][] = [];
  for (const r of camp.rows) {
    const c = o(r.campaign);
    const m = o(r.metrics);
    const id = String(c.id);
    campDims.set(id, [id, orgId, customerId, s(c.name, 255), s(c.status, 20), s(c.advertisingChannelType, 40), r.campaignBudget ? micros(o(r.campaignBudget).amountMicros) : null, now]);
    campFacts.push([
      id, o(r.segments).date, orgId,
      n(m.impressions), n(m.clicks), micros(m.costMicros), n(m.conversions), n(m.conversionsValue),
      optN(m.searchImpressionShare), optN(m.searchBudgetLostImpressionShare), optN(m.searchRankLostImpressionShare),
      optN(m.topImpressionPercentage), optN(m.absoluteTopImpressionPercentage),
    ]);
  }
  rows += await bulkUpsert(
    "ads_campaigns",
    [
      { name: "campaign_id", cast: "bigint" }, { name: "org_id", cast: "text" }, { name: "customer_id", cast: "text" },
      { name: "name", cast: "text" }, { name: "status", cast: "text" }, { name: "channel_type", cast: "text" },
      { name: "daily_budget", cast: "numeric" }, { name: "updated_at", cast: "timestamp" },
    ],
    ["campaign_id"],
    [...campDims.values()]
  );
  rows += await bulkUpsert(
    "ads_campaign_daily",
    [
      { name: "campaign_id", cast: "bigint" }, { name: "date", cast: "date" }, { name: "org_id", cast: "text" },
      ...METRIC_COLS, { name: "conversions_value", cast: "numeric" },
      { name: "search_impr_share", cast: "numeric" }, { name: "search_budget_lost_is", cast: "numeric" },
      { name: "search_rank_lost_is", cast: "numeric" }, { name: "top_impr_pct", cast: "numeric" },
      { name: "abs_top_impr_pct", cast: "numeric" },
    ],
    ["campaign_id", "date"],
    campFacts
  );

  // ── กลุ่มโฆษณา ──
  const ag = await searchStream<Obj>(customerId, queries.adGroup);
  retried ||= ag.retried;
  const agDims = new Map<string, unknown[]>();
  const agFacts: unknown[][] = [];
  for (const r of ag.rows) {
    const a = o(r.adGroup);
    const m = o(r.metrics);
    const id = String(a.id);
    agDims.set(id, [id, orgId, String(o(r.campaign).id), s(a.name, 255), s(a.status, 20), now]);
    agFacts.push([
      id, o(r.segments).date, orgId,
      n(m.impressions), n(m.clicks), micros(m.costMicros), n(m.conversions), n(m.conversionsValue),
      optN(m.topImpressionPercentage), optN(m.absoluteTopImpressionPercentage),
    ]);
  }
  rows += await bulkUpsert(
    "ads_ad_groups",
    [
      { name: "ad_group_id", cast: "bigint" }, { name: "org_id", cast: "text" }, { name: "campaign_id", cast: "bigint" },
      { name: "name", cast: "text" }, { name: "status", cast: "text" }, { name: "updated_at", cast: "timestamp" },
    ],
    ["ad_group_id"],
    [...agDims.values()]
  );
  rows += await bulkUpsert(
    "ads_ad_group_daily",
    [
      { name: "ad_group_id", cast: "bigint" }, { name: "date", cast: "date" }, { name: "org_id", cast: "text" },
      ...METRIC_COLS, { name: "conversions_value", cast: "numeric" },
      { name: "top_impr_pct", cast: "numeric" }, { name: "abs_top_impr_pct", cast: "numeric" },
    ],
    ["ad_group_id", "date"],
    agFacts
  );

  // ── คีย์เวิร์ด ──
  const kw = await searchStream<Obj>(customerId, queries.keyword);
  retried ||= kw.retried;
  rows += await bulkUpsert(
    "ads_keyword_daily",
    [
      { name: "criterion_id", cast: "bigint" }, { name: "ad_group_id", cast: "bigint" }, { name: "date", cast: "date" },
      { name: "org_id", cast: "text" }, { name: "keyword_text", cast: "text" }, { name: "match_type", cast: "text" },
      ...METRIC_COLS,
    ],
    ["ad_group_id", "criterion_id", "date"],
    kw.rows.map((r) => {
      const crit = o(r.adGroupCriterion);
      const m = o(r.metrics);
      return [
        String(crit.criterionId), String(o(r.adGroup).id), o(r.segments).date, orgId,
        s(o(crit.keyword).text, 255), s(o(crit.keyword).matchType, 20),
        n(m.impressions), n(m.clicks), micros(m.costMicros), n(m.conversions),
      ];
    })
  );

  // ── คำค้นหาจริง — รวมแถวซ้ำ (คำเดียวกัน กลุ่มเดียวกัน วันเดียวกัน) ก่อนเขียน ──
  const st = await searchStream<Obj>(customerId, queries.searchTerm);
  retried ||= st.retried;
  const terms = new Map<string, unknown[]>();
  for (const r of st.rows) {
    const term = s(o(r.searchTermView).searchTerm, 500);
    const adGroupId = String(o(r.adGroup).id);
    const date = String(o(r.segments).date);
    const key = `${adGroupId}|${date}|${term}`;
    const m = o(r.metrics);
    const prev = terms.get(key);
    const vals = [n(m.impressions), n(m.clicks), micros(m.costMicros), n(m.conversions)];
    if (prev) for (let i = 0; i < 4; i++) prev[4 + i] = (prev[4 + i] as number) + vals[i]!;
    else terms.set(key, [orgId, adGroupId, date, term, ...vals]);
  }
  rows += await bulkUpsert(
    "ads_search_term_daily",
    [
      { name: "org_id", cast: "text" }, { name: "ad_group_id", cast: "bigint" }, { name: "date", cast: "date" },
      { name: "search_term", cast: "text" }, ...METRIC_COLS,
    ],
    ["ad_group_id", "date", "search_term"],
    [...terms.values()]
  );

  return { rows, retried };
}

// ─── ตัวคุมการรัน ───
const running = new Set<string>();

export function isSyncing(customerId: string): boolean {
  return running.has(customerId);
}

export function syncRange(jobType: JobType, timeZone: string | null, backfillMonths = 24): Period {
  const today = todayIn(timeZone ?? "Asia/Bangkok");
  if (jobType === "backfill") {
    const months = Math.min(24, Math.max(12, Math.round(backfillMonths)));
    return { from: addDays(today, -Math.round(months * 30.44)), to: today };
  }
  return { from: addDays(today, -SYNC_LOOKBACK_DAYS), to: today };
}

export interface SyncOutcome {
  customerId: string;
  status: "success" | "retried" | "failed";
  rowsUpserted: number;
  error?: string;
}

export async function runSync(
  orgId: string,
  customerId: string,
  jobType: JobType,
  opts: { backfillMonths?: number } = {}
): Promise<SyncOutcome> {
  const account = await prisma.adsAccount.findFirst({ where: { orgId, customerId } });
  if (!account) throw new Error("ไม่พบบัญชีโฆษณานี้");
  if (running.has(customerId)) throw new Error("บัญชีนี้กำลังซิงค์อยู่ รอให้รอบเดิมเสร็จก่อน");

  running.add(customerId);
  const startedAt = new Date();
  const range = syncRange(jobType, account.timeZone, opts.backfillMonths);
  let rowsUpserted = 0;
  let retried = false;
  try {
    const chunks = jobType === "backfill" ? monthlyChunks(range) : [range];
    for (const chunk of chunks) {
      const r = await syncChunk(orgId, customerId, chunk);
      rowsUpserted += r.rows;
      retried ||= r.retried;
    }
    const status = retried ? "retried" : "success";
    await prisma.$transaction([
      prisma.adsSyncLog.create({
        data: {
          orgId, customerId, jobType, rangeFrom: toDbDate(range.from), rangeTo: toDbDate(range.to),
          rowsUpserted, durationMs: Date.now() - startedAt.getTime(), status, startedAt,
        },
      }),
      prisma.adsAccount.updateMany({ where: { orgId, customerId }, data: { lastSyncedAt: new Date() } }),
    ]);
    return { customerId, status, rowsUpserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.adsSyncLog.create({
      data: {
        orgId, customerId, jobType, rangeFrom: toDbDate(range.from), rangeTo: toDbDate(range.to),
        rowsUpserted, durationMs: Date.now() - startedAt.getTime(), status: "failed", errorMessage: message.slice(0, 4000), startedAt,
      },
    });
    await alertOnRepeatedFailure(orgId, customerId, account.name, message);
    return { customerId, status: "failed", rowsUpserted, error: message };
  } finally {
    running.delete(customerId);
  }
}

/** ล้มเหลว 2 รอบติดกัน → แจ้งทีม dev (spec §3.3) ทางอีเมล ADS_DEV_ALERT_EMAILS */
async function alertOnRepeatedFailure(orgId: string, customerId: string, name: string | null, message: string) {
  const last = await prisma.adsSyncLog.findMany({
    where: { orgId, customerId },
    orderBy: { startedAt: "desc" },
    take: 2,
    select: { status: true },
  });
  if (last.length < 2 || last.some((l) => l.status !== "failed")) return;

  const to = (process.env.ADS_DEV_ALERT_EMAILS ?? "").split(/[\s,;]+/).filter(Boolean);
  const subject = `[Smartboss] Google Ads sync ล้มเหลว 2 รอบติดกัน — ${name ?? customerId}`;
  const text = `บัญชี ${name ?? ""} (${customerId}) ซิงค์ล้มเหลว 2 รอบติดกัน\n\nข้อผิดพลาดล่าสุด:\n${message}`;
  if (to.length === 0 || !mailConfigured()) {
    console.error(`[ads-sync] ${subject} — ยังไม่ได้ตั้ง ADS_DEV_ALERT_EMAILS/SMTP จึงไม่ได้ส่งอีเมล\n${text}`);
    return;
  }
  try {
    await sendMail({ to, subject, text });
  } catch (err) {
    console.error("[ads-sync] ส่งอีเมลแจ้งเตือนทีม dev ไม่สำเร็จ:", err);
  }
}

export async function listSyncLogs(orgId: string, customerId?: string | null, take = 50) {
  return prisma.adsSyncLog.findMany({
    where: { orgId, ...(customerId ? { customerId } : {}) },
    orderBy: { startedAt: "desc" },
    take,
  });
}
