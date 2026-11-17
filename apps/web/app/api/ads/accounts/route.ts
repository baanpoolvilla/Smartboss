import { adsRoute } from "@/modules/ads/data/access";
import { listAccounts } from "@/modules/ads/data/accounts";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";

/** GET /api/ads/accounts — บัญชีโฆษณาที่ n8n ส่งข้อมูลเข้ามา */
export const GET = adsRoute(ADS_PERMS.access, async (_req, session) => ({ accounts: await listAccounts(session.orgId) }));
