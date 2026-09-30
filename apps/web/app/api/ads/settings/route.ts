import { adsRoute, readJson } from "@/modules/ads/data/access";
import { loadAnalysisSettings, saveAnalysisSettings } from "@/modules/ads/data/settings";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";

/** GET /api/ads/settings?customer_id= — อ่านกฎตรวจสอบและเป้าหมายธุรกิจของบัญชี */
export const GET = adsRoute(ADS_PERMS.settingManage, async (req, session) => {
  const customerId = new URL(req.url).searchParams.get("customer_id") ?? "";
  return loadAnalysisSettings(session.orgId, customerId);
});

/** PUT /api/ads/settings?customer_id= — แก้กฎตรวจสอบและเป้าหมายธุรกิจ */
export const PUT = adsRoute(ADS_PERMS.settingManage, async (req, session) => {
  const customerId = new URL(req.url).searchParams.get("customer_id") ?? "";
  await saveAnalysisSettings(session.orgId, customerId, await readJson(req));
  return loadAnalysisSettings(session.orgId, customerId);
});
