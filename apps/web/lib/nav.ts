import { cache } from "react";
import { getSession, loadAuthUser } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { getVisibleModules, type ModuleManifest } from "@/module-registry";
import { roleLabel } from "@/lib/roles";
import { unreadCount } from "@/modules/maintenance/data/notify";
import { getIssueConsoleAccess } from "@/modules/admin/data/issue-console-access";
import { ADMIN_ISSUE_REPORT_CODE } from "@/modules/admin/issue-report-manifest";
import { WORKER_ROLE_CODE } from "@/modules/daily_worker/permissions";
import { WORKER_MENU_KEYS, WORKER_MODULE_KEYS, tr, type WorkerLang } from "@/modules/daily_worker/i18n";
import { workerLangFor } from "@/modules/daily_worker/lang-server";
import { salaryAccess } from "@/modules/salary/lib/access";
import { SALARY_EDIT_MENU } from "@/modules/salary/permissions";

export interface ShellNavUser {
  /** ใช้ฝั่งเบราว์เซอร์แยกของที่จำในเครื่องรายคน (เช่น อีโมจิที่ใช้ล่าสุด) — ไม่ใช่เส้นแบ่งสิทธิ์ */
  id: string;
  /** ภาษาหน้าจอของคนงาน — null = ผู้ใช้ทั่วไป */
  workerLang: WorkerLang | null;
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

  // คนงาน (WORKER): ชื่อโมดูล/เมนูตามภาษาที่เลือก (เริ่มต้นพม่า) · ผู้ใช้อื่นเหมือนเดิมทุกอย่าง
  const workerLang = user.roles.includes(WORKER_ROLE_CODE) ? await workerLangFor(user.roles) : null;
  // เมนูของคนทำเงินเดือน (การเงินพนักงาน) ตัดสินจากรายชื่อที่ CEO เลือก ไม่ใช่บทบาท — SUPER_ADMIN ผ่านทุกสิทธิ์
  // ตาม resolvePermission จึงต้องตัดออกเองตรงนี้ถ้าไม่ได้รับเลือก
  const salaryEditor = user.orgId ? (await salaryAccess({ userId: user.id, roles: user.roles, orgId: user.orgId })).canEdit : false;
  const visible = getVisibleModules({
    permissions: salaryEditor ? [...user.permissions, SALARY_EDIT_MENU] : user.permissions,
    roles: user.roles,
    enabledCodes,
    isSupportStaff: supportStaff,
  })
    .map((m) => (salaryEditor ? m : { ...m, menus: m.menus.filter((menu) => menu.permission !== SALARY_EDIT_MENU) }))
    .filter((m) => m.menus.length > 0)
    .filter((m) => m.id !== ADMIN_ISSUE_REPORT_CODE || consoleAccess !== null);
  const modules =
    workerLang === null
      ? visible
      : visible.map((m) => ({
          ...m,
          name: WORKER_MODULE_KEYS[m.id] ? tr(workerLang, WORKER_MODULE_KEYS[m.id]!) : m.name,
          menus: m.menus.map((menu) => {
            const key = WORKER_MENU_KEYS[menu.path] ?? (menu.path.endsWith("/chat") ? "menuChat" : menu.path.endsWith("/report-feed") ? "menuReport" : undefined);
            return key ? { ...menu, label: tr(workerLang, key) } : menu;
          }),
        }));

  return {
    user: {
      workerLang,
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      roleLabel: roleLabel(user.roles),
    },
    modules,
    unread: await unreadCount(user.id),
  };
});
