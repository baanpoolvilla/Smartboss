import "server-only";
import { prisma } from "@smartboss/database";

/**
 * เพดานความจุไฟล์คลังกลางต่อบริษัท — "safety ceiling" กันค่า object storage (S3/R2)
 * วิ่งหนีเมื่อขายหลายบริษัท ยังเป็นสเต็ปแรกแบบเบา:
 *   - ปรับค่าเริ่มต้นได้ผ่าน env COMPANY_FILES_ORG_QUOTA_GB (ดีฟอลต์ 5GB)
 *   - นับเฉพาะไฟล์คลังกลาง (company-files) ซึ่งเป็นตัวกินพื้นที่หลัก
 *
 * สเต็ปถัดไป (ตอนใกล้เปิดขายจริง): เพดานรายบริษัทที่ผู้ขายตั้งเองได้ + dashboard
 * การใช้งาน + ครอบคลุมไฟล์โมดูลอื่น — ทำเพิ่มทีหลังโดยไม่ต้องรื้อของนี้
 */

const DEFAULT_QUOTA_GB = 5;

/** เพดานต่อบริษัท (ไบต์) — จาก env ถ้าตั้งไว้ ไม่งั้นดีฟอลต์ */
export function orgQuotaBytes(): number {
  const gb = Number(process.env.COMPANY_FILES_ORG_QUOTA_GB);
  const useGb = Number.isFinite(gb) && gb > 0 ? gb : DEFAULT_QUOTA_GB;
  return useGb * 1024 * 1024 * 1024;
}

/**
 * เพดานที่ใช้จริงกับบริษัทนี้ (ไบต์) — ถ้าตั้งเพดานรายบริษัทไว้ (storageQuotaMb) ใช้ค่านั้น
 * ไม่งั้น fallback ไปค่ากลางจาก env (orgQuotaBytes)
 */
export async function getOrgQuotaBytes(orgId: string): Promise<number> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { storageQuotaMb: true },
  });
  if (org?.storageQuotaMb != null && org.storageQuotaMb > 0) {
    return org.storageQuotaMb * 1024 * 1024;
  }
  return orgQuotaBytes();
}

/**
 * ความจุที่บริษัทนี้ใช้ไปจริง (ไบต์) — รวมทุกเวอร์ชันของทุกไฟล์ (เวอร์ชันเก่าก็กิน
 * พื้นที่จริงบน storage จนกว่าจะลบถาวร) ไฟล์ในถังขยะที่ยังไม่ล้างก็ยังนับ เพราะยัง
 * เปลืองพื้นที่อยู่ — ตรงกับต้นทุนจริง
 */
export async function getOrgCompanyFilesUsage(orgId: string): Promise<number> {
  const agg = await prisma.companyFileVersion.aggregate({
    _sum: { size: true },
    where: { file: { orgId } },
  });
  return agg._sum.size ?? 0;
}

/** พื้นที่ที่ไฟล์แชทของบริษัทนี้ใช้ (ไบต์) — นับจาก chat.files (ทุกไฟล์ที่อัปขึ้นแชท) */
export async function getOrgChatUsage(orgId: string): Promise<number> {
  const agg = await prisma.chatFile.aggregate({ _sum: { size: true }, where: { orgId } });
  return agg._sum.size ?? 0;
}

/** พื้นที่รวมที่นับเข้าเพดานบริษัท = คลังไฟล์กลาง + แชท (เพดานเดียวต่อบริษัท ขายเป็นแพ็กเกจเดียว) */
export async function getOrgStorageUsage(orgId: string): Promise<{ total: number; companyFiles: number; chat: number }> {
  const [companyFiles, chat] = await Promise.all([getOrgCompanyFilesUsage(orgId), getOrgChatUsage(orgId)]);
  return { total: companyFiles + chat, companyFiles, chat };
}

export interface QuotaCheck {
  ok: boolean;
  used: number;
  limit: number;
  incoming: number;
}

/** ตรวจก่อนอัปโหลด: (ใช้ไป + ไฟล์ใหม่) ต้องไม่เกินเพดาน */
export async function checkOrgQuota(orgId: string, incomingBytes: number): Promise<QuotaCheck> {
  const [limit, usage] = await Promise.all([getOrgQuotaBytes(orgId), getOrgStorageUsage(orgId)]);
  const used = usage.total;
  return { ok: used + incomingBytes <= limit, used, limit, incoming: incomingBytes };
}

/** ทำเป็นข้อความ GB อ่านง่ายสำหรับแจ้งผู้ใช้ */
export function toGB(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}
