import "server-only";
import { prisma } from "@smartboss/database";
import type { DiscordRound } from "@/modules/report_task/lib/discord/decider";

export interface ChannelConfig {
  orgId: string;
  discordChannelId: string;
  topicId: string;
  label: string;
  rounds: DiscordRound[];
  minImages: number;
  requiredWeekdays: number[];
  useRoster: boolean;
  keywordOnly: boolean;
  keyword: string;
  active: boolean;
}

/** หา config ห้องจาก Channel ID (ห้องหนึ่งอยู่บริษัทเดียวในทางปฏิบัติ) — org มาจากตรงนี้ ไม่รับจาก client */
export async function findChannel(discordChannelId: string): Promise<ChannelConfig | null> {
  const row = await prisma.discordChannel.findFirst({ where: { discordChannelId } });
  if (!row) return null;
  return {
    orgId: row.orgId,
    discordChannelId: row.discordChannelId,
    topicId: row.topicId,
    label: row.label,
    rounds: (row.rounds as unknown as DiscordRound[]) ?? [],
    minImages: row.minImages,
    requiredWeekdays: row.requiredWeekdays,
    useRoster: row.useRoster,
    keywordOnly: row.keywordOnly,
    keyword: row.keyword,
    active: row.active,
  };
}

/** map Discord user -> employee (core.users.id) ในบริษัทนั้น */
export async function findEmployeeId(orgId: string, discordUserId: string): Promise<string | null> {
  const row = await prisma.discordLink.findUnique({
    where: { orgId_discordUserId: { orgId, discordUserId } },
    select: { employeeId: true },
  });
  return row?.employeeId ?? null;
}
