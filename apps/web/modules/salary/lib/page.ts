import "server-only";
import { redirect } from "next/navigation";
import { hasPermission, requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { SALARY_PERMS } from "../permissions";
import { salaryAccess } from "./access";

/** เปิดหน้าของโมดูล — ต้องมีสิทธิ์เข้าเมนูเงินเดือน · `edit` = หน้าจัดการ (CEO + คนที่ CEO เลือก) */
export async function salaryPage(opts: { edit?: boolean; manageAccess?: boolean } = {}) {
  const session = await requireOrg();
  if (!hasPermission(session, SALARY_PERMS.access) && !session.roles.includes("CEO")) redirect("/");
  const access = await salaryAccess(session);
  if ((opts.edit && !access.canEdit) || (opts.manageAccess && !access.canManageAccess)) redirect("/salary");
  return { session, access };
}

export async function actorOf(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return { userId, name: u?.name ?? "ผู้ใช้" };
}
