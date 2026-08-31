import { redirect } from "next/navigation";

import { requireOrg, hasPermission } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import {
  DiscordReportsClient,
  type ChannelRow,
  type SubmissionRow,
} from "@/modules/admin/components/discord-reports/discord-reports-client";
import type { DiscordRound } from "@/modules/report_task/lib/discord/decider";

/**
 * หน้าจัดการ Discord Report Sync (ชั่วคราว) — ดูรายงานรายวัน, ตั้งค่าห้อง (กรอกเอง),
 * ผูก Discord user กับพนักงาน · ดู docs/discord_report_integration.md
 */
export const dynamic = "force-dynamic";

function todayThai(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

export default async function DiscordReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.performanceView)) {
    redirect("/admin");
  }
  const canManage = hasPermission(session, ADMIN_PERMS.performanceSettingManage);
  const orgId = session.orgId;

  const { date: dateParam } = await searchParams;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayThai();

  const [channelRows, linkRows, employees, submissionRows] = await Promise.all([
    prisma.discordChannel.findMany({ where: { orgId }, orderBy: { label: "asc" } }),
    prisma.discordLink.findMany({ where: { orgId } }),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.reportSubmission.findMany({
      where: { orgId, reportDate: new Date(date) },
      orderBy: { postedAt: "asc" },
    }),
  ]);

  const channels: ChannelRow[] = channelRows.map((c) => ({
    discordChannelId: c.discordChannelId,
    topicId: c.topicId,
    label: c.label,
    rounds: (c.rounds as unknown as DiscordRound[]) ?? [],
    minImages: c.minImages,
    requiredWeekdays: c.requiredWeekdays,
    useRoster: c.useRoster,
    keywordOnly: c.keywordOnly,
    keyword: c.keyword,
    active: c.active,
  }));

  const submissions: SubmissionRow[] = submissionRows.map((s) => ({
    id: s.id,
    employeeId: s.employeeId,
    discordUserId: s.discordUserId,
    channelId: s.channelId,
    topicId: s.topicId,
    roundId: s.roundId,
    postedAt: s.postedAt ? s.postedAt.toISOString() : null,
    imageCount: s.imageCount,
    status: s.status,
  }));

  return (
    <AppScaffold title="Discord Report Sync" width="max-w-5xl">
      <DiscordReportsClient
        channels={channels}
        links={linkRows.map((l) => ({ discordUserId: l.discordUserId, employeeId: l.employeeId }))}
        employees={employees}
        submissions={submissions}
        date={date}
        canManage={canManage}
      />
    </AppScaffold>
  );
}
