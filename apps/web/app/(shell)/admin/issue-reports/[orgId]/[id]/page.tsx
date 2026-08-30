import { notFound, redirect } from "next/navigation";
import { requireOrg, isSuperAdmin } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { AppScaffold } from "@/components/module/app-scaffold";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { migrateIssueStoreSlice } from "@/modules/report_task/lib/issue-migration";
import { listSuperAdmins } from "@/modules/admin/data/issue-ticket-actions";
import { IssueTicketDetailClient, type TicketUserInfo } from "@/modules/admin/components/issue-reports/issue-ticket-detail-client";

export const dynamic = "force-dynamic";

/**
 * Cross-org ticket detail — the one place a Super Admin actually works a
 * ticket (reply, claim, change status/priority/assignee) now that the
 * per-org "issue desk" is retired everywhere else. Reads straight from the
 * target org's own raw store row (no session/org boundary to cross around —
 * requireOrg()+isSuperAdmin() is the gate, same as the list page).
 */
export default async function AdminIssueTicketDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; id: string }>;
}) {
  const session = await requireOrg();
  if (!isSuperAdmin(session)) redirect("/admin");

  const { orgId, id } = await params;
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
  if (!org) notFound();

  const { data } = await readStore<unknown>(orgId, "issue-reports");
  const slice = migrateIssueStoreSlice(data);
  const ticket = slice.tickets.find((t) => t.id === id);
  if (!ticket) notFound();

  const userIds = Array.from(
    new Set([ticket.reporterId, ticket.assigneeId, ...ticket.messages.map((m) => m.authorId)].filter((x): x is string => !!x))
  );
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, roles: { select: { role: { select: { name: true } } } } },
        })
      : [];
  const userMap: Record<string, TicketUserInfo> = {};
  for (const u of users) userMap[u.id] = { name: u.name, email: u.email, role: u.roles[0]?.role.name ?? null };

  const superAdmins = await listSuperAdmins();

  return (
    <AppScaffold title={`ตั๋ว ${ticket.code}`} width="max-w-4xl" backHref="/admin/issue-reports">
      <IssueTicketDetailClient
        orgId={orgId}
        orgName={org.name}
        ticket={ticket}
        userMap={userMap}
        superAdmins={superAdmins}
        currentUserId={session.userId}
      />
    </AppScaffold>
  );
}
