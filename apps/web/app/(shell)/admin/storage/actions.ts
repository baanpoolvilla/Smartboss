"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, isSuperAdmin } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { organizationExists } from "@/modules/admin/data/orgs";

/**
 * ตั้งเพดานพื้นที่ไฟล์รายบริษัท (แพ็กเกจเสริม) — SUPER_ADMIN เท่านั้น
 * quotaGb ว่าง = กลับไปใช้ค่ากลางจาก env (storageQuotaMb = null)
 */
export async function setOrgStorageQuotaAction(formData: FormData) {
  const session = await requireOrg();
  if (!isSuperAdmin(session)) redirect("/admin");

  const orgId = String(formData.get("orgId") ?? "").trim();
  if (!orgId || !(await organizationExists(orgId))) {
    throw new Error("ไม่พบบริษัทนี้");
  }

  const raw = String(formData.get("quotaGb") ?? "").trim();
  let storageQuotaMb: number | null;
  if (raw === "") {
    storageQuotaMb = null; // ใช้ค่ากลาง
  } else {
    const gb = Number(raw);
    if (!Number.isFinite(gb) || gb <= 0) throw new Error("ค่าความจุไม่ถูกต้อง");
    storageQuotaMb = Math.round(gb * 1024);
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { storageQuotaMb },
  });
  revalidatePath("/admin/storage");
}
