import "server-only";
import { prisma } from "@smartboss/database";

/**
 * `Organization.planCode` is a free-text column ("FREE"/"PRO"/"ENTERPRISE",
 * see core.prisma) with no enum and no gating logic anywhere in the codebase
 * yet — this file is that gating logic's first home. Unrecognized/missing
 * values fall back to FREE (the least-privileged tier) rather than throwing,
 * since an org created before this feature existed has `planCode: null`.
 */
export const PLAN_ORDER = ["FREE", "PRO", "ENTERPRISE"] as const;
export type PlanCode = (typeof PLAN_ORDER)[number];

export async function getOrgPlan(orgId: string): Promise<PlanCode> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { planCode: true } });
  const code = org?.planCode?.toUpperCase();
  return (PLAN_ORDER as readonly string[]).includes(code ?? "") ? (code as PlanCode) : "FREE";
}

export function planAtLeast(plan: PlanCode, min: PlanCode): boolean {
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(min);
}

/** Monthly AI Insight analysis quota per plan — 1 call = 1 full company-wide
 * analysis round, cached and shared by everyone in the org (not per-person).
 * FREE gets 0: the feature is locked, not just rate-limited to nothing. */
export const AI_INSIGHT_MONTHLY_LIMIT: Record<PlanCode, number> = {
  FREE: 0,
  PRO: 50,
  ENTERPRISE: 200,
};
