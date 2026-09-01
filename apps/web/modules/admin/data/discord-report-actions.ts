"use server";

import { Prisma } from "@prisma/client";

import { requireOrg, hasPermission } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { ADMIN_PERMS } from "@/modules/admin/permissions";
import type { DiscordRound } from "@/modules/report_task/lib/discord/decider";

/**
 * Server actions ของหน้า /admin/discord-reports (Discord Report Sync ชั่วคราว)
 * แก้ config ห้อง/การผูกตัวตน — org มาจาก session เท่านั้น ไม่รับจาก client
 */

async function requireManage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.performanceSettingManage)) {
    throw new Error("ไม่มีสิทธิ์แก้ไขการตั้งค่านี้");
  }
  return session;
}

export interface ChannelInput {
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

export async function upsertChannelAction(input: ChannelInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const s = await requireManage();
    const rounds = input.rounds as unknown as Prisma.InputJsonValue;
    const data = {
      topicId: input.topicId.trim(),
      label: input.label.trim(),
      rounds,
      minImages: Math.max(0, Math.trunc(input.minImages)),
      requiredWeekdays: input.requiredWeekdays,
      useRoster: input.useRoster,
      keywordOnly: input.keywordOnly,
      keyword: input.keyword.trim() || "daily",
      active: input.active,
    };
    await prisma.discordChannel.upsert({
      where: { orgId_discordChannelId: { orgId: s.orgId, discordChannelId: input.discordChannelId.trim() } },
      create: { orgId: s.orgId, discordChannelId: input.discordChannelId.trim(), ...data },
      update: data,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
}

export async function deleteChannelAction(discordChannelId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const s = await requireManage();
    await prisma.discordChannel.delete({
      where: { orgId_discordChannelId: { orgId: s.orgId, discordChannelId } },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ลบไม่สำเร็จ" };
  }
}

export async function upsertLinkAction(
  discordUserId: string,
  employeeId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const s = await requireManage();
    const uid = discordUserId.trim();
    if (!uid || !employeeId) return { ok: false, error: "กรอกไม่ครบ" };
    await prisma.discordLink.upsert({
      where: { orgId_discordUserId: { orgId: s.orgId, discordUserId: uid } },
      create: { orgId: s.orgId, discordUserId: uid, employeeId },
      update: { employeeId },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
}

export async function deleteLinkAction(discordUserId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const s = await requireManage();
    await prisma.discordLink.delete({
      where: { orgId_discordUserId: { orgId: s.orgId, discordUserId } },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ลบไม่สำเร็จ" };
  }
}
