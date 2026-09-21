import { cache } from "react";
import { getSession, loadAuthUser } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { getVisibleModules, type ModuleManifest } from "@/module-registry";
import { roleLabel } from "@/lib/roles";
import { unreadCount } from "@/modules/maintenance/data/notify";
import { getIssueConsoleAccess } from "@/modules/admin/data/issue-console-access";
import { ADMIN_ISSUE_REPORT_CODE } from "@/modules/admin/issue-report-manifest";

export interface ShellNavUser {
  name: string;
  email: string;
  avatarUrl: string | null;
  roleLabel: string;
}

export interface ShellNav {
  user: ShellNavUser;
  /** โมดูลที่ผู้ใช้เห็นได้จริง (บริษัทเปิดใช้ + มีสิทธิ์) */
  modules: ModuleManifest[];
  unread: number;
}

/**
 * ข้อมูลที่ทั้ง shell layout และหน้า launcher ต้องใช้ร่วมกัน
 * ห่อด้วย cache() → เรียกกี่ที่ใน request เดียวก็ query ครั้งเดียว
 */
export const loadShellNav = cache(async (): Promise<ShellNav | null> => {
  const session = await getSession();
  if (!session) return null;

  const user = await loadAuthUser(session.userId);
  if (!user) return null;

  // โมดูลที่บริษัทของผู้ใช้เปิดใช้งาน (subscription) — platform user (ไม่มี org) = ว่าง
  const enabledCodes = user.orgId
    ? (
        await prisma.orgModule.findMany({
          where: { orgId: user.orgId, isEnabled: true },
          include: { module: true },
        })
      ).map((om) => om.module.code)
    : [];

  // แผนก IT (คนแก้) และ CEO/ADMIN (แค่รู้) ของ "บริษัทของเรา" เห็นเมนูคอนโซลแจ้งบัคด้วย —
  // query เฉพาะเมื่อตั้ง ISSUE_SUPPORT_ORG แล้ว (ดู getSupportRole)
  // ไม่มีสิทธิ์เข้าคอนโซล (เช่น Super Admin ของบริษัทอื่น) → ซ่อนโมดูลนี้ทั้งอัน ไม่ให้โผล่แล้วกดเข้าไม่ได้
  const consoleAccess = await getIssueConsoleAccess({ userId: user.id, orgId: user.orgId, roles: user.roles });
  const supportStaff = consoleAccess?.kind === "home";

  return {
    user: {
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      roleLabel: roleLabel(user.roles),
    },
    modules: getVisibleModules({
      permissions: user.permissions,
      roles: user.roles,
      enabledCodes,
      isSupportStaff: supportStaff,
    }).filter((m) => m.id !== ADMIN_ISSUE_REPORT_CODE || consoleAccess !== null),
    unread: await unreadCount(user.id),
  };
});
