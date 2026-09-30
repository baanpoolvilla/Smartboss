import { adsRoute, readJson } from "@/modules/ads/data/access";
import { loadBenchmarks, resetAccountBenchmarks, saveBenchmarks } from "@/modules/ads/data/settings";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/ads/benchmarks?customer_id= — อ่านเกณฑ์ KPI
 * ไม่ระบุ customer_id = ค่าเริ่มต้นทุกบัญชีของบริษัท
 */
export const GET = adsRoute(ADS_PERMS.access, async (req, session) => {
  const customerId = new URL(req.url).searchParams.get("customer_id") || null;
  return loadBenchmarks(session.orgId, customerId);
});

/**
 * PUT /api/ads/benchmarks?customer_id= — แก้เกณฑ์ KPI
 * body: { ctr: { direction, poor, good }, ... } หรือ { reset: true } = เลิกใช้ค่าเฉพาะบัญชี
 */
export const PUT = adsRoute(ADS_PERMS.settingManage, async (req, session) => {
  const customerId = new URL(req.url).searchParams.get("customer_id") || null;
  const body = await readJson(req);
  if (body.reset === true) {
    if (!customerId) throw new Error("ล้างได้เฉพาะเกณฑ์ของบัญชี");
    await resetAccountBenchmarks(session.orgId, customerId);
  } else {
    await saveBenchmarks(session.orgId, customerId, body);
  }
  return loadBenchmarks(session.orgId, customerId);
});
