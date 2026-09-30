import "server-only";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";
import { ADS_CODE } from "../constants";
import { halfMonthPeriods, todayIn, weeklyPeriods } from "../lib/periods";
import { runAnalysis } from "./ai";
import { sendWeeklyEmail } from "./email";
import { runSync } from "./sync";

/**
 * งานตามตารางเวลา (spec §3.1 / §6.6) — เรียกจาก /api/cron/ads ผ่าน crontab
 *   sync        ทุกวัน 06:00          ซิงค์ย้อนหลัง 30 วัน
 *   weekly      ทุกวันจันทร์ 07:00    7 วันล่าสุด เทียบ 7 วันก่อนหน้า + อีเมล
 *   half-month  วันที่ 1 และ 16       ครึ่งเดือนที่ผ่านมา เทียบครึ่งเดือนก่อนหน้า
 */

/** บัญชีที่เปิดซิงค์ ของทุกบริษัทที่เปิดใช้โมดูล ads */
async function activeAccounts() {
  const enabledOrgs = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.orgModule.findMany({ where: { isEnabled: true, module: { code: ADS_CODE } }, select: { orgId: true } })
  );
  const orgIds = enabledOrgs.map((o) => o.orgId);
  if (orgIds.length === 0) return [];
  return prisma.adsAccount.findMany({
    where: { orgId: { in: orgIds }, syncEnabled: true },
    select: { orgId: true, customerId: true, timeZone: true },
  });
}

export async function cronDailySync() {
  const results = [];
  for (const acc of await activeAccounts()) {
    try {
      results.push(await runSync(acc.orgId, acc.customerId, "daily"));
    } catch (err) {
      results.push({ customerId: acc.customerId, status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { sync: results };
}

export async function cronWeekly() {
  const results = [];
  for (const acc of await activeAccounts()) {
    const { period, compare } = weeklyPeriods(todayIn(acc.timeZone ?? "Asia/Bangkok"));
    try {
      const reportId = await runAnalysis(acc.orgId, acc.customerId, period, compare, "schedule");
      const email = await sendWeeklyEmail(acc.orgId, reportId);
      results.push({ customerId: acc.customerId, reportId, email });
    } catch (err) {
      results.push({ customerId: acc.customerId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { weekly: results };
}

/** force = ทดสอบรันวันอื่นนอกจากวันที่ 1/16 ได้ */
export async function cronHalfMonth(force = false) {
  const results = [];
  for (const acc of await activeAccounts()) {
    const today = todayIn(acc.timeZone ?? "Asia/Bangkok");
    const day = Number(today.slice(8, 10));
    if (!force && day !== 1 && day !== 16) {
      results.push({ customerId: acc.customerId, skipped: "ไม่ใช่วันที่ 1 หรือ 16" });
      continue;
    }
    const { period, compare } = halfMonthPeriods(today);
    try {
      results.push({ customerId: acc.customerId, reportId: await runAnalysis(acc.orgId, acc.customerId, period, compare, "schedule") });
    } catch (err) {
      results.push({ customerId: acc.customerId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { halfMonth: results };
}
