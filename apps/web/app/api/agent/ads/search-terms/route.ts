import { agentRoute } from "@/modules/ads/data/agent-auth";
import { agentSearchTerms } from "@/modules/ads/data/agent-read";

export const dynamic = "force-dynamic";

/** GET /api/agent/ads/search-terms?customer_id=&from=&to=&campaign_id=&ad_group_id=&min_clicks=&max_conversions=&contains=&sort=&limit= */
export const GET = agentRoute(async (req, ctx) => agentSearchTerms(ctx.orgId, new URL(req.url).searchParams));
