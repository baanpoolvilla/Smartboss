import "server-only";
import { prisma } from "@smartboss/database";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { migrateIssueStoreSlice } from "@/modules/report_task/lib/issue-migration";
import type { IssueTicket } from "@/modules/report_task/types/issue";
import { listAllOrganizations } from "./orgs";

export interface CrossOrgIssueTicket extends IssueTicket {
  orgId: string;
  orgName: string;
  reporterName: string;
  reporterEmail: string | null;
}

/**
 * Every issue ticket across every company on the platform, tagged with which
 * company reported it and who — SUPER_ADMIN only (the page that calls this
 * must check isSuperAdmin() itself first, same as listAllOrganizations()).
 *
 * report_task's data is normally strictly per-org (see org-store.ts's own
 * comment on why — every other query there takes a single orgId) — this is
 * the one place that intentionally reads the same "issue-reports" store key
 * across every organization at once, because that's the whole point of this
 * screen: a client company's own report shouldn't only ever reach that
 * company's own internal admin, it should also reach SmartBoss directly.
 */
export async function listAllIssueTickets(): Promise<CrossOrgIssueTicket[]> {
  const orgs = await listAllOrganizations();
  const perOrg = await Promise.all(
    orgs.map(async (org) => {
      const { data } = await readStore<unknown>(org.id, "issue-reports");
      const slice = migrateIssueStoreSlice(data);
      return slice.tickets.map((t) => ({ ...t, orgId: org.id, orgName: org.name }));
    })
  );
  const tickets = perOrg.flat();

  // Batch-resolve reporter names in one query — report_task's own directory
  // helper (lib/directory.ts) only ever knows the *current session's* org,
  // which is no use here since tickets span every org at once.
  const reporterIds = Array.from(new Set(tickets.map((t) => t.reporterId)));
  const users =
    reporterIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: reporterIds } }, select: { id: true, name: true, email: true } })
      : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  return tickets
    .map((t) => ({
      ...t,
      reporterName: userById.get(t.reporterId)?.name ?? "ไม่ทราบชื่อ",
      reporterEmail: userById.get(t.reporterId)?.email ?? null,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
