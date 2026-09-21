import { notFound } from "next/navigation";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";
import { AppScaffold } from "@/components/module/app-scaffold";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { migrateIssueStoreSlice } from "@/modules/report_task/lib/issue-migration";
import { listAssignableStaff } from "@/modules/admin/data/issue-ticket-actions";
import { requireIssueConsoleAccess } from "@/modules/admin/data/issue-console-access";
import { markTicketNotificationsRead } from "@/modules/admin/data/issue-notify-state";
import { canActOnTicketOrg } from "@/modules/admin/support-org";
import { classifyIssueSource } from "@/modules/admin/issue-source";
import { moduleRegistry } from "@/module-registry";
import { IssueTicketDetailClient, type TicketUserInfo } from "@/modules/admin/components/issue-reports/issue-ticket-detail-client";

export const dynamic = "force-dynamic";

/**
 * Cross-org ticket detail — the one place a Super Admin actually works a
 * ticket (reply, claim, change status/priority/assignee) now that the
 * per-org "issue desk" is retired everywhere else. Reads straight from the
 * target org's own raw store row (no session/org boundary to cross around —
 * requireIssueConsoleAccess() is the gate, same as the list page). Super Admin
 * works any ticket; CEO/ADMIN of our own company (ISSUE_SUPPORT_ORG) can read
 * any ticket but only work the ones filed by our own company (readOnly).
 */
export default async function AdminIssueTicketDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; id: string }>;
}) {
  const { session, access } = await requireIssueConsoleAccess();

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
      ? await crossOrg("admin:platform-support-console-cross-company-users", () =>
          prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true, roles: { select: { role: { select: { name: true } } } } },
          })
        )
      : [];
  const userMap: Record<string, TicketUserInfo> = {};
  for (const u of users) userMap[u.id] = { name: u.name, email: u.email, role: u.roles[0]?.role.name ?? null };

  const assignees = await listAssignableStaff();

  // เปิดดูตั๋วนี้แล้ว — แจ้งเตือนของตั๋วนี้ที่ยังไม่อ่านถือว่าอ่านแล้ว (ตัวเลขแดงลดลงเอง)
  await markTicketNotificationsRead(session.userId, id).catch((err) => console.error("[issue-reports] mark read failed", err));

  // แจ้งมาจากโมดูล › เมนูไหน + (ถ้าเป็นหน้ารายการเดี่ยวของบริษัทที่ผู้ดูสังกัดอยู่) ลิงก์เปิดหน้านั้น
  // — ข้อมูลบริษัทอื่นเปิดจากบัญชีนี้ไม่ได้อยู่แล้ว จึงไม่ให้ลิงก์
  const source = classifyIssueSource(
    ticket.context.pageUrl,
    moduleRegistry.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      icon: m.icon,
      basePath: m.basePath,
      menus: m.menus.map((menu) => ({ label: menu.label, path: menu.path })),
    }))
  );
  const sourceLabel = source.menuLabel ? `${source.moduleName} › ${source.menuLabel}` : source.moduleName;
  const pageLink = orgId === session.orgId ? source.recordPath : null;

  return (
    <AppScaffold title={`ตั๋ว ${ticket.code}`} width="max-w-4xl" backHref="/admin/issue-reports">
      <IssueTicketDetailClient
        orgId={orgId}
        orgName={org.name}
        ticket={ticket}
        userMap={userMap}
        assignees={assignees}
        currentUserId={session.userId}
        readOnly={!canActOnTicketOrg(access, orgId)}
        sourceLabel={sourceLabel}
        pageLink={pageLink}
      />
    </AppScaffold>
  );
}
