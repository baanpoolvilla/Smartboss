import { agentRoute, readAgentJson } from "@/modules/ads/data/agent-auth";
import { listAccounts } from "@/modules/ads/data/accounts";
import { ingestAccounts } from "@/modules/ads/data/ingest";

export const dynamic = "force-dynamic";

/** GET /api/agent/ads/accounts — บัญชีโฆษณาที่มีในบริษัท */
export const GET = agentRoute(async (_req, ctx) => ({ accounts: await listAccounts(ctx.orgId) }));

/** POST /api/agent/ads/accounts — { accounts: [{ customer_id, name, currency_code, time_zone }] } */
export const POST = agentRoute(async (req, ctx) => ({ ok: true, ...(await ingestAccounts(ctx.orgId, await readAgentJson(req))) }));
