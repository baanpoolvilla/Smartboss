"use server";

import "server-only";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission, type OrgSession } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { deleteFile as deleteStoredFile } from "@/lib/storage";
import { canUserAccessReportTopic, listAccessibleTopicIds } from "@/modules/report_task/lib/room-access-server";
import { COMPANY_FILES_PERMS } from "../permissions";
import type { ShareLinkRole, ShareLinkScope } from "../types";
import { hashSharePassword, verifySharePasswordHash } from "../lib/share-password";

/**
 * Server actions for the "ไฟล์บริษัท" module — one place that owns every
 * write to CompanyFolder/CompanyFile/CompanyFileVersion/CompanyFileShareLink,
 * always org-scoped off the session (never trust a client-supplied orgId).
 */

async function requireAccess() {
  const session = await requireOrg();
  if (!hasPermission(session, COMPANY_FILES_PERMS.access)) redirect("/");
  return session;
}

async function requireUpload() {
  const session = await requireAccess();
  if (!hasPermission(session, COMPANY_FILES_PERMS.upload)) throw new Error("ไม่มีสิทธิ์อัปโหลด/สร้างโฟลเดอร์");
  return session;
}

/** ลบ/เพิกถอนของคนอื่นได้ก็ต่อเมื่อมีสิทธิ์ manage หรือเป็นเจ้าของแถวนั้นเอง */
function canModify(session: OrgSession, createdBy: string): boolean {
  return createdBy === session.userId || hasPermission(session, COMPANY_FILES_PERMS.manage);
}

/**
 * โฟลเดอร์ที่ผูกกับห้องของโมดูลรายงาน (roomId ตั้งค่า) เห็นเฉพาะสมาชิกห้องนั้น
 * ไม่ใช่ทุกคนในบริษัท — เดินขึ้นสายพ่อแม่หา roomId ตัวแรกที่เจอ (ลูกของโฟลเดอร์
 * ห้องก็ถูกจำกัดสิทธิ์ตามห้องนั้นไปด้วย แม้ตัวมันเองจะไม่มี roomId ก็ตาม)
 * คืน null = โฟลเดอร์ปกติ ไม่มีการจำกัดเพิ่มจาก orgId
 */
async function getEffectiveRoomId(orgId: string, folderId: string | null): Promise<string | null> {
  let currentId = folderId;
  for (let i = 0; i < 20 && currentId; i++) {
    const folder = await prisma.companyFolder.findFirst({
      where: { id: currentId, orgId },
      select: { roomId: true, parentId: true },
    });
    if (!folder) return null;
    if (folder.roomId) return folder.roomId;
    currentId = folder.parentId;
  }
  return null;
}

/** โยน error เดียวกับ "ไม่พบ" เมื่อเข้าไม่ได้ — ไม่บอกว่ามีอยู่จริงแต่ไม่มีสิทธิ์ */
async function assertFolderAccess(session: OrgSession, folderId: string | null): Promise<void> {
  const roomId = await getEffectiveRoomId(session.orgId, folderId);
  if (!roomId) return;
  const allowed = await canUserAccessReportTopic(session.orgId, roomId, session.userId);
  if (!allowed) throw new Error("ไม่พบโฟลเดอร์นี้");
}

export interface FolderPathEntry {
  id: string;
  name: string;
}

/** บันทึก audit log — ห่อ try ไว้เสมอ กิจกรรมบันทึกไม่ได้ต้องไม่ทำให้ action หลักพัง */
async function logActivity(
  session: OrgSession,
  entry: { fileId?: string | null; folderId?: string | null; action: string; detail?: string | null }
): Promise<void> {
  try {
    await prisma.companyFileActivity.create({
      data: {
        orgId: session.orgId,
        fileId: entry.fileId ?? null,
        folderId: entry.folderId ?? null,
        actorId: session.userId,
        action: entry.action,
        detail: entry.detail ?? null,
      },
    });
  } catch (e) {
    console.error("[company-files] activity log failed", e);
  }
}

/** id ของโฟลเดอร์นี้ + ลูกหลานทั้งหมด (ไล่ตาม parentId) — ใช้ตอน soft-delete/restore
 * ทั้งกิ่ง กันลูปด้วยเพดานชั้น */
async function collectSubtreeFolderIds(orgId: string, rootId: string): Promise<string[]> {
  const ids: string[] = [rootId];
  let frontier = [rootId];
  for (let i = 0; i < 50 && frontier.length > 0; i++) {
    const children = await prisma.companyFolder.findMany({
      where: { orgId, parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id);
    ids.push(...frontier);
  }
  return ids;
}

/** เนื้อหาของโฟลเดอร์เดียว — โฟลเดอร์ย่อยก่อน ไฟล์ทีหลัง เรียงตามชื่อทั้งคู่
 * รากบริษัท (folderId = null) ไม่โชว์โฟลเดอร์ที่ผูกกับห้อง — ดูได้ทางแท็บ
 * "ห้องรายงาน" (listRoomFolders) แยกต่างหากเท่านั้น ไม่ปนกับ tree ปกติ */
export async function listFolder(folderId: string | null) {
  const session = await requireAccess();
  await assertFolderAccess(session, folderId);
  const [folders, files] = await Promise.all([
    prisma.companyFolder.findMany({
      where: { orgId: session.orgId, parentId: folderId, deletedAt: null, ...(folderId === null ? { roomId: null } : {}) },
      orderBy: { name: "asc" },
    }),
    prisma.companyFile.findMany({
      where: { orgId: session.orgId, folderId, deletedAt: null },
      orderBy: { name: "asc" },
    }),
  ]);
  return { folders, files };
}

/** เส้นทางเบรดครัมบ์จากรากถึงโฟลเดอร์นี้ */
export async function getFolderPath(folderId: string | null): Promise<FolderPathEntry[]> {
  const session = await requireAccess();
  await assertFolderAccess(session, folderId);
  const path: FolderPathEntry[] = [];
  let currentId = folderId;
  // จำนวนชั้นจริงไม่มีทางเกินหลักสิบ — กันลูปไม่รู้จบไว้เผื่อข้อมูลเพี้ยน
  // (parentId ชี้เป็นวงกลม) มากกว่ากลัวโฟลเดอร์ลึกจริง
  for (let i = 0; i < 100 && currentId; i++) {
    const folder = await prisma.companyFolder.findFirst({
      where: { id: currentId, orgId: session.orgId },
      select: { id: true, name: true, parentId: true },
    });
    if (!folder) break;
    path.unshift({ id: folder.id, name: folder.name });
    currentId = folder.parentId;
  }
  return path;
}

export async function createFolder(parentId: string | null, name: string) {
  const session = await requireUpload();
  await assertFolderAccess(session, parentId);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("ตั้งชื่อโฟลเดอร์ก่อน");
  return prisma.companyFolder.create({
    data: { orgId: session.orgId, parentId, name: trimmed, createdBy: session.userId },
  });
}

export async function renameFolder(folderId: string, name: string) {
  const session = await requireUpload();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("ตั้งชื่อโฟลเดอร์ก่อน");
  const folder = await prisma.companyFolder.findFirst({ where: { id: folderId, orgId: session.orgId } });
  if (!folder) throw new Error("ไม่พบโฟลเดอร์นี้");
  await assertFolderAccess(session, folderId);
  if (!canModify(session, folder.createdBy)) throw new Error("ไม่มีสิทธิ์แก้ไขโฟลเดอร์นี้");
  return prisma.companyFolder.update({ where: { id: folderId }, data: { name: trimmed } });
}

/** ลบโฟลเดอร์ทั้งชั้น — cascade ลบโฟลเดอร์ย่อย/ไฟล์ข้างในหมด (ระดับ DB, onDelete:
 * Cascade ใน schema) แต่ไฟล์จริงบน storage ต้องลบเองที่นี่ก่อน ไม่งั้นจะกลายเป็น
 * key กำพร้าเปลืองพื้นที่เก็บถาวร */
/** ลบโฟลเดอร์ = ย้ายทั้งกิ่ง (โฟลเดอร์ย่อย+ไฟล์ข้างใน) เข้าถังขยะ soft-delete
 * กู้คืนได้ ไม่ลบไบต์จริงจนกว่าจะ purge */
export async function deleteFolder(folderId: string) {
  const session = await requireUpload();
  const folder = await prisma.companyFolder.findFirst({ where: { id: folderId, orgId: session.orgId } });
  if (!folder) throw new Error("ไม่พบโฟลเดอร์นี้");
  await assertFolderAccess(session, folderId);
  if (!canModify(session, folder.createdBy)) throw new Error("ไม่มีสิทธิ์ลบโฟลเดอร์นี้");
  const folderIds = await collectSubtreeFolderIds(session.orgId, folderId);
  const now = new Date();
  await prisma.$transaction([
    prisma.companyFolder.updateMany({
      where: { id: { in: folderIds }, orgId: session.orgId },
      data: { deletedAt: now, deletedBy: session.userId },
    }),
    prisma.companyFile.updateMany({
      where: { folderId: { in: folderIds }, orgId: session.orgId },
      data: { deletedAt: now, deletedBy: session.userId },
    }),
  ]);
  await logActivity(session, { folderId, action: "delete", detail: folder.name });
}

/** กู้คืนโฟลเดอร์ทั้งกิ่งจากถังขยะ */
export async function restoreFolder(folderId: string) {
  const session = await requireUpload();
  const folder = await prisma.companyFolder.findFirst({ where: { id: folderId, orgId: session.orgId } });
  if (!folder) throw new Error("ไม่พบโฟลเดอร์นี้");
  await assertFolderAccess(session, folderId);
  if (!canModify(session, folder.createdBy)) throw new Error("ไม่มีสิทธิ์กู้คืนโฟลเดอร์นี้");
  const folderIds = await collectSubtreeFolderIds(session.orgId, folderId);
  await prisma.$transaction([
    prisma.companyFolder.updateMany({
      where: { id: { in: folderIds }, orgId: session.orgId },
      data: { deletedAt: null, deletedBy: null },
    }),
    prisma.companyFile.updateMany({
      where: { folderId: { in: folderIds }, orgId: session.orgId },
      data: { deletedAt: null, deletedBy: null },
    }),
  ]);
  await logActivity(session, { folderId, action: "restore", detail: folder.name });
}

/** ลบถาวรโฟลเดอร์ทั้งกิ่ง — ลบไบต์จริงทุกไฟล์ข้างใน แล้วลบแถวจริง (cascade DB) */
export async function purgeFolder(folderId: string) {
  const session = await requireUpload();
  const folder = await prisma.companyFolder.findFirst({ where: { id: folderId, orgId: session.orgId } });
  if (!folder) throw new Error("ไม่พบโฟลเดอร์นี้");
  await assertFolderAccess(session, folderId);
  if (!canModify(session, folder.createdBy)) throw new Error("ไม่มีสิทธิ์ลบถาวรโฟลเดอร์นี้");
  const storageKeys = await collectStorageKeysUnderFolder(session.orgId, folderId);
  await prisma.companyFolder.delete({ where: { id: folderId } });
  await Promise.all(storageKeys.map((key) => deleteStoredFile(key)));
  await logActivity(session, { action: "purge", detail: `โฟลเดอร์ ${folder.name}` });
}

async function collectStorageKeysUnderFolder(orgId: string, folderId: string): Promise<string[]> {
  const subfolders = await prisma.companyFolder.findMany({ where: { orgId, parentId: folderId }, select: { id: true } });
  const nested = await Promise.all(subfolders.map((f) => collectStorageKeysUnderFolder(orgId, f.id)));
  const versions = await prisma.companyFileVersion.findMany({
    where: { file: { orgId, folderId } },
    select: { storageKey: true },
  });
  return [...nested.flat(), ...versions.map((v) => v.storageKey)];
}

export interface UploadedFileInfo {
  url: string;
  mimeType: string;
  size: number;
  name: string;
}

/** สร้างไฟล์ใหม่ในโฟลเดอร์ — เรียกหลังอัปโหลดผ่าน /api/company-files/uploads
 * สำเร็จแล้ว (uploaded.url คือ storageKey ในรูป /api/files/<key>) */
export async function createFile(folderId: string | null, uploaded: UploadedFileInfo) {
  const session = await requireUpload();
  await assertFolderAccess(session, folderId);
  const file = await prisma.companyFile.create({
    data: {
      orgId: session.orgId,
      folderId,
      name: uploaded.name,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
      storageKey: uploaded.url,
      currentVersion: 1,
      createdBy: session.userId,
    },
  });
  await prisma.companyFileVersion.create({
    data: {
      fileId: file.id,
      versionNumber: 1,
      storageKey: uploaded.url,
      size: uploaded.size,
      mimeType: uploaded.mimeType,
      uploadedBy: session.userId,
    },
  });
  await logActivity(session, { fileId: file.id, folderId, action: "create", detail: file.name });
  return file;
}

/** อัปโหลดทับเป็นเวอร์ชันใหม่ — ของเดิมทุกเวอร์ชันยังอยู่ครบใน
 * CompanyFileVersion ไม่มีอะไรถูกลบ ("ประวัติ/เวอร์ชันของไฟล์ที่เคยแก้ไข") */
export async function addFileVersion(fileId: string, uploaded: UploadedFileInfo, note?: string) {
  const session = await requireUpload();
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);
  if (!canModify(session, file.createdBy)) throw new Error("ไม่มีสิทธิ์อัปโหลดเวอร์ชันใหม่ของไฟล์นี้");

  const nextVersion = file.currentVersion + 1;
  await prisma.companyFileVersion.create({
    data: {
      fileId,
      versionNumber: nextVersion,
      storageKey: uploaded.url,
      size: uploaded.size,
      mimeType: uploaded.mimeType,
      uploadedBy: session.userId,
      note: note?.trim() || null,
    },
  });
  const updated = await prisma.companyFile.update({
    where: { id: fileId },
    data: {
      name: uploaded.name,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
      storageKey: uploaded.url,
      currentVersion: nextVersion,
      updatedBy: session.userId,
    },
  });
  await logActivity(session, {
    fileId,
    action: "version",
    detail: `เวอร์ชัน ${nextVersion}${note?.trim() ? ` · ${note.trim()}` : ""}`,
  });
  return updated;
}

export async function listFileVersions(fileId: string) {
  const session = await requireAccess();
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);
  return prisma.companyFileVersion.findMany({ where: { fileId }, orderBy: { versionNumber: "desc" } });
}

/** "กู้คืน" เวอร์ชันเก่า — ไม่ลบเวอร์ชันหลังจากนั้นทิ้ง แค่สร้างเวอร์ชันใหม่ที่
 * ชี้ไปที่ storageKey เดิมของเวอร์ชันที่เลือก (เหมือน SharePoint: "restore"
 * ไม่ใช่ "rewind" — ประวัติที่เคยเกิดขึ้นจริงไม่หายไปไหน) */
export async function restoreFileVersion(fileId: string, versionNumber: number) {
  const session = await requireUpload();
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);
  if (!canModify(session, file.createdBy)) throw new Error("ไม่มีสิทธิ์กู้คืนเวอร์ชันของไฟล์นี้");
  const target = await prisma.companyFileVersion.findUnique({ where: { fileId_versionNumber: { fileId, versionNumber } } });
  if (!target) throw new Error("ไม่พบเวอร์ชันนี้");

  return addFileVersion(
    fileId,
    { url: target.storageKey, mimeType: target.mimeType, size: target.size, name: file.name },
    `กู้คืนจากเวอร์ชัน ${versionNumber}`
  );
}

/** เปลี่ยนชื่อไฟล์ — ชื่ออยู่บน CompanyFile (เวอร์ชันเก่าไม่ถูกแตะเลย) เหมือน
 * SharePoint ที่ rename ไม่นับเป็นเวอร์ชันใหม่ */
export async function renameFile(fileId: string, name: string) {
  const session = await requireUpload();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("ตั้งชื่อไฟล์ก่อน");
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);
  if (!canModify(session, file.createdBy)) throw new Error("ไม่มีสิทธิ์เปลี่ยนชื่อไฟล์นี้");
  return prisma.companyFile.update({
    where: { id: fileId },
    data: { name: trimmed, updatedBy: session.userId },
  });
}

/** ลบไฟล์ = ย้ายเข้าถังขยะ (soft-delete) — ยังไม่ลบไบต์จริง กู้คืนได้จนกว่าจะ purge
 * (พฤติกรรมแบบ recycle bin ของ SharePoint แทนที่จะลบถาวรทันที) */
export async function deleteCompanyFile(fileId: string) {
  const session = await requireUpload();
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);
  if (!canModify(session, file.createdBy)) throw new Error("ไม่มีสิทธิ์ลบไฟล์นี้");
  await prisma.companyFile.update({
    where: { id: fileId },
    data: { deletedAt: new Date(), deletedBy: session.userId },
  });
  await logActivity(session, { fileId, action: "delete", detail: file.name });
}

/** กู้คืนไฟล์จากถังขยะ */
export async function restoreCompanyFile(fileId: string) {
  const session = await requireUpload();
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);
  if (!canModify(session, file.createdBy)) throw new Error("ไม่มีสิทธิ์กู้คืนไฟล์นี้");
  await prisma.companyFile.update({
    where: { id: fileId },
    data: { deletedAt: null, deletedBy: null },
  });
  await logActivity(session, { fileId, action: "restore", detail: file.name });
}

/** ลบถาวร (purge) ไฟล์ในถังขยะ — ลบไบต์จริงทุกเวอร์ชัน กู้คืนไม่ได้อีก */
export async function purgeCompanyFile(fileId: string) {
  const session = await requireUpload();
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);
  if (!canModify(session, file.createdBy)) throw new Error("ไม่มีสิทธิ์ลบถาวรไฟล์นี้");
  const versions = await prisma.companyFileVersion.findMany({ where: { fileId }, select: { storageKey: true } });
  await prisma.companyFile.delete({ where: { id: fileId } });
  await Promise.all(versions.map((v) => deleteStoredFile(v.storageKey)));
  await logActivity(session, { action: "purge", detail: file.name });
}

export async function createShareLink(
  fileId: string,
  role: ShareLinkRole,
  expiresInDays: number | null,
  opts?: { scope?: ShareLinkScope; password?: string | null }
) {
  const session = await requireUpload();
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);

  const password = opts?.password?.trim() || null;
  const link = await prisma.companyFileShareLink.create({
    data: {
      fileId,
      token: randomBytes(24).toString("hex"),
      role,
      scope: opts?.scope ?? "anyone",
      passwordHash: password ? hashSharePassword(password) : null,
      createdBy: session.userId,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null,
    },
  });
  await logActivity(session, {
    fileId,
    action: "share",
    detail: `${role}${opts?.scope === "org" ? " · เฉพาะในบริษัท" : ""}${password ? " · มีรหัสผ่าน" : ""}`,
  });
  return link;
}

export async function listShareLinks(fileId: string) {
  const session = await requireAccess();
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);
  return prisma.companyFileShareLink.findMany({ where: { fileId }, orderBy: { createdAt: "desc" } });
}

export async function revokeShareLink(linkId: string) {
  const session = await requireUpload();
  const link = await prisma.companyFileShareLink.findUnique({ where: { id: linkId }, include: { file: true } });
  if (!link || link.file.orgId !== session.orgId) throw new Error("ไม่พบลิงก์นี้");
  await assertFolderAccess(session, link.file.folderId);
  if (!canModify(session, link.createdBy)) throw new Error("ไม่มีสิทธิ์เพิกถอนลิงก์นี้");
  await prisma.companyFileShareLink.update({ where: { id: linkId }, data: { revoked: true } });
  await logActivity(session, { fileId: link.fileId, action: "revoke" });
}

/** อ่านลิงก์แชร์แบบไม่ต้องมี session — ใช้จากหน้าเปิดลิงก์สาธารณะ
 * (app/s/[token]) และ API ที่เสิร์ฟไฟล์ให้คนถือลิงก์ ไม่ใช่จาก data layer
 * ปกติที่ผูก requireOrg() ไว้ */
export async function resolveShareLink(token: string) {
  const link = await prisma.companyFileShareLink.findUnique({ where: { token }, include: { file: true } });
  if (!link || link.revoked) return null;
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return null;
  return link;
}

export type ShareAccessResult =
  | { ok: true; link: NonNullable<Awaited<ReturnType<typeof resolveShareLink>>> }
  | { ok: false; reason: "invalid" | "scope" | "password" };

/** ตรวจสิทธิ์เปิดลิงก์แชร์ครบทุกด่าน (เพิกถอน/หมดอายุ + ขอบเขต org + รหัสผ่าน) —
 * ใช้ร่วมกันทั้งหน้าเพจ (app/s/[token]) และ API เสิร์ฟไฟล์ เพื่อบังคับด่านตรงกัน
 * viewerOrgId = orgId ของ session ผู้เปิด (null ถ้าไม่ล็อกอิน) */
export async function resolveShareAccess(
  token: string,
  viewer: { viewerOrgId: string | null; password?: string | null }
): Promise<ShareAccessResult> {
  const link = await resolveShareLink(token);
  if (!link) return { ok: false, reason: "invalid" };
  if (link.scope === "org" && (!viewer.viewerOrgId || viewer.viewerOrgId !== link.file.orgId)) {
    return { ok: false, reason: "scope" };
  }
  if (link.passwordHash && !(viewer.password && verifySharePasswordHash(link.passwordHash, viewer.password))) {
    return { ok: false, reason: "password" };
  }
  return { ok: true, link };
}

/** สรุปสถานะด่านของลิงก์ให้หน้าเพจตัดสินใจว่าจะโชว์ฟอร์มรหัส/ต้องล็อกอินไหม
 * โดยไม่เผยไฟล์ก่อนผ่านด่าน */
export async function getShareLinkGate(token: string): Promise<
  { status: "invalid" } | { status: "ok"; scope: ShareLinkScope; needsPassword: boolean; orgId: string; role: string; name: string }
> {
  const link = await resolveShareLink(token);
  if (!link) return { status: "invalid" };
  return {
    status: "ok",
    scope: link.scope as ShareLinkScope,
    needsPassword: !!link.passwordHash,
    orgId: link.file.orgId,
    role: link.role,
    name: link.file.name,
  };
}

/** ตรวจรหัสผ่านลิงก์ (เรียกจากฟอร์มฝั่งผู้เปิด) — คืน true ถ้าถูกหรือไม่มีรหัส */
export async function verifyShareLinkPassword(token: string, password: string): Promise<boolean> {
  const link = await resolveShareLink(token);
  if (!link) return false;
  if (!link.passwordHash) return true;
  return verifySharePasswordHash(link.passwordHash, password);
}

/** อัปโหลดเวอร์ชันใหม่จากลิงก์แชร์แบบ "แก้ไขได้" — คนถือลิงก์นี้ไม่มี session
 * เลย (อาจเป็นคนนอกบริษัท) จึงตรวจสิทธิ์จาก token/role เอง ไม่ใช่ requireOrg().
 * ยังผ่าน addFileVersion ไม่ได้เพราะฟังก์ชันนั้นเช็ค session แต่ตรรกะสร้างแถว
 * เวอร์ชันเหมือนกันทุกอย่าง — คัดลอกมาสั้นๆ แทนที่จะแยก session-check ออกจาก
 * addFileVersion จนอ่านยากขึ้นสำหรับเส้นทางปกติที่ใช้บ่อยกว่ามาก */
export async function addFileVersionViaShareLink(token: string, uploaded: UploadedFileInfo) {
  const link = await resolveShareLink(token);
  if (!link) throw new Error("ลิงก์นี้ใช้ไม่ได้แล้ว (ถูกเพิกถอนหรือหมดอายุ)");
  if (link.role !== "edit") throw new Error("ลิงก์นี้ดูได้อย่างเดียว แก้ไขไม่ได้");

  const file = link.file;
  const nextVersion = file.currentVersion + 1;
  await prisma.companyFileVersion.create({
    data: {
      fileId: file.id,
      versionNumber: nextVersion,
      storageKey: uploaded.url,
      size: uploaded.size,
      mimeType: uploaded.mimeType,
      uploadedBy: `share-link:${token.slice(0, 8)}`,
      note: "แก้ไขผ่านลิงก์แชร์ (ไม่มีบัญชีในระบบ)",
    },
  });
  return prisma.companyFile.update({
    where: { id: file.id },
    data: { mimeType: uploaded.mimeType, size: uploaded.size, storageKey: uploaded.url, currentVersion: nextVersion },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// เชื่อมกับ "ห้อง" ของโมดูลรายงาน (report-feed) — ทุกฟังก์ชันในหมวดนี้ตรวจสิทธิ์
// ห้องจริงฝั่งเซิร์ฟเวอร์ผ่าน room-access-server.ts ไม่ใช่แค่กรอง UI
// ─────────────────────────────────────────────────────────────────────────

/** โฟลเดอร์ของห้องนี้ — สร้างครั้งแรกตอนมีคนอัปโหลดเอกสารจากห้องนั้น (ก่อนหน้านั้น
 * ห้องยังไม่มีโฟลเดอร์เลย ไม่ต้องสร้างล่วงหน้าตอนสร้างห้อง) */
export async function getOrCreateRoomFolder(topicId: string, topicName: string) {
  const session = await requireUpload();
  const allowed = await canUserAccessReportTopic(session.orgId, topicId, session.userId);
  if (!allowed) throw new Error("ไม่มีสิทธิ์เข้าห้องนี้");

  const existing = await prisma.companyFolder.findFirst({ where: { orgId: session.orgId, roomId: topicId } });
  if (existing) return existing;
  return prisma.companyFolder.create({
    data: {
      orgId: session.orgId,
      parentId: null,
      roomId: topicId,
      name: topicName.trim() || "ห้อง",
      createdBy: session.userId,
    },
  });
}

/** อัปโหลดเอกสารจากแท็บ "ไฟล์" ของห้อง — ทางเข้าเดียวที่ควรใช้จากฝั่ง UI ของห้อง
 * (แทนที่จะเรียก getOrCreateRoomFolder + createFile แยกสองที) */
export async function addFileToRoomFolder(topicId: string, topicName: string, uploaded: UploadedFileInfo) {
  const folder = await getOrCreateRoomFolder(topicId, topicName);
  return createFile(folder.id, uploaded);
}

/** เอกสารของห้องหนึ่ง — ใช้แสดงในแท็บ "ไฟล์" ของห้องนั้นในโมดูลรายงาน
 * คืนก้อนว่างเงียบๆ ถ้าเข้าห้องนี้ไม่ได้ หรือห้องนี้ยังไม่เคยมีใครอัปโหลดเลย */
export async function listRoomFiles(topicId: string) {
  const session = await requireAccess();
  const allowed = await canUserAccessReportTopic(session.orgId, topicId, session.userId);
  if (!allowed) return { folder: null, files: [] };

  const folder = await prisma.companyFolder.findFirst({ where: { orgId: session.orgId, roomId: topicId } });
  if (!folder) return { folder: null, files: [] };
  const files = await prisma.companyFile.findMany({
    where: { orgId: session.orgId, folderId: folder.id, deletedAt: null },
    orderBy: { name: "asc" },
  });
  return { folder, files };
}

/** โฟลเดอร์ห้องทั้งหมดที่ผู้ใช้ปัจจุบันเห็นได้ — สำหรับ section "ห้องรายงาน"
 * ในหน้าไฟล์บริษัทหลัก (แยกจาก tree โฟลเดอร์ปกติ) */
export async function listRoomFolders() {
  const session = await requireAccess();
  const accessible = await listAccessibleTopicIds(session.orgId, session.userId);
  if (accessible.size === 0) return [];
  return prisma.companyFolder.findMany({
    where: { orgId: session.orgId, roomId: { in: [...accessible] } },
    orderBy: { name: "asc" },
  });
}

export interface AllFilesRow {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  currentVersion: number;
  createdAt: Date;
  /** วันที่แก้ล่าสุด (updatedAt ของไฟล์) — คอลัมน์ "Modified" แบบ SharePoint */
  updatedAt: Date;
  /** "ไฟล์บริษัท" (อยู่ที่ราก), "โฟลเดอร์: X" หรือ "ห้อง: X" — บอกว่าไฟล์นี้มาจากไหน
   * โดยไม่ต้องกดเข้าไปดูทีละโฟลเดอร์/ห้องก่อน (มุมมองรวมแบบหน้า SharePoint) */
  sourceLabel: string;
  /** ชื่อคนอัปโหลดไฟล์นี้ครั้งแรก (ไม่ใช่คนแก้เวอร์ชันล่าสุด) — null ถ้าบัญชีถูกปิดใช้งานไปแล้ว */
  uploaderName: string | null;
  /** ชื่อคนแก้ล่าสุด (updatedBy ถ้ามี ไม่งั้น = คนอัปโหลดแรก) — null ถ้าบัญชีถูกปิด */
  modifiedByName: string | null;
}

/** ไฟล์ทั้งหมดที่ผู้ใช้ปัจจุบันเห็นได้ รวมทั้งบริษัท — ไม่ต้องไล่กดเข้าโฟลเดอร์/ห้อง
 * ทีละที่ (เหมือนหน้า SharePoint ที่รวมไฟล์จากทุกไซต์ที่มีสิทธิ์ไว้หน้าเดียว) ไฟล์ที่
 * อยู่ในห้องที่เข้าไม่ได้จะไม่ปรากฏเลย — กรองจริงฝั่งเซิร์ฟเวอร์ ไม่ใช่ซ่อนแค่ UI */
export async function listAllFiles(): Promise<AllFilesRow[]> {
  const session = await requireAccess();
  const [allFiles, allFolders, accessibleTopicIds] = await Promise.all([
    prisma.companyFile.findMany({ where: { orgId: session.orgId, deletedAt: null }, orderBy: { createdAt: "desc" } }),
    prisma.companyFolder.findMany({ where: { orgId: session.orgId } }),
    listAccessibleTopicIds(session.orgId, session.userId),
  ]);
  const folderById = new Map(allFolders.map((f) => [f.id, f]));
  const uploaderIds = [...new Set(allFiles.flatMap((f) => [f.createdBy, f.updatedBy].filter((x): x is string => !!x)))];
  const uploaders = uploaderIds.length
    ? await prisma.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true } })
    : [];
  const uploaderNameById = new Map(uploaders.map((u) => [u.id, u.name]));

  function effectiveRoomId(folderId: string | null): string | null {
    let currentId = folderId;
    for (let i = 0; i < 20 && currentId; i++) {
      const folder = folderById.get(currentId);
      if (!folder) return null;
      if (folder.roomId) return folder.roomId;
      currentId = folder.parentId;
    }
    return null;
  }

  function sourceLabelOf(folderId: string | null): string {
    if (!folderId) return "ไฟล์บริษัท (หน้าหลัก)";
    const folder = folderById.get(folderId);
    if (!folder) return "ไฟล์บริษัท";
    return folder.roomId ? `ห้อง: ${folder.name}` : `โฟลเดอร์: ${folder.name}`;
  }

  return allFiles
    .filter((file) => {
      const roomId = effectiveRoomId(file.folderId);
      return !roomId || accessibleTopicIds.has(roomId);
    })
    .map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      currentVersion: file.currentVersion,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      sourceLabel: sourceLabelOf(file.folderId),
      uploaderName: uploaderNameById.get(file.createdBy) ?? null,
      modifiedByName: (file.updatedBy && uploaderNameById.get(file.updatedBy)) || uploaderNameById.get(file.createdBy) || null,
    }));
}


// ─────────────────────────────────────────────────────────────────────────
// ค้นหา + ย้ายไฟล์ (SharePoint parity) — ทั้งหมดผูก orgId + สิทธิ์ห้องฝั่งเซิร์ฟเวอร์
// ─────────────────────────────────────────────────────────────────────────

/** ค้นไฟล์ตามชื่อทั้งบริษัทที่ผู้ใช้เห็นได้ — ใช้มุมมองรวมเดิม (listAllFiles) เป็นฐาน
 * จึงกรองสิทธิ์ห้อง/orgId เหมือนกันเป๊ะ ไม่มีทางรั่วไฟล์ห้องที่เข้าไม่ได้
 * (ตอนนี้กรองใน memory — เมื่อไฟล์เยอะค่อยดันไป SQL contains/full-text ดูรายงาน) */
export async function searchFiles(query: string): Promise<AllFilesRow[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = await listAllFiles();
  return all.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 100);
}

/** โฟลเดอร์ปลายทางที่ย้ายไฟล์ไปได้ — เฉพาะที่ผู้ใช้เข้าถึงได้ (โฟลเดอร์ปกติ + ห้องที่
 * เป็นสมาชิก) ใช้เติม dropdown "ย้ายไปที่..." ฝั่ง UI */
export async function listMovableFolders(): Promise<{ id: string; name: string; roomId: string | null }[]> {
  const session = await requireAccess();
  const [folders, accessible] = await Promise.all([
    prisma.companyFolder.findMany({ where: { orgId: session.orgId, deletedAt: null }, orderBy: { name: "asc" } }),
    listAccessibleTopicIds(session.orgId, session.userId),
  ]);
  return folders
    .filter((f) => !f.roomId || accessible.has(f.roomId))
    .map((f) => ({ id: f.id, name: f.name, roomId: f.roomId }));
}

/** ย้ายไฟล์ไปโฟลเดอร์อื่น (targetFolderId = null คือย้ายไปรากบริษัท) — ตรวจสิทธิ์ทั้ง
 * โฟลเดอร์ต้นทางและปลายทาง กันย้ายไฟล์เข้า/ออกห้องที่ไม่มีสิทธิ์ */
export async function moveFile(fileId: string, targetFolderId: string | null) {
  const session = await requireUpload();
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);
  await assertFolderAccess(session, targetFolderId);
  if (!canModify(session, file.createdBy)) throw new Error("ไม่มีสิทธิ์ย้ายไฟล์นี้");
  const updated = await prisma.companyFile.update({
    where: { id: fileId },
    data: { folderId: targetFolderId, updatedBy: session.userId },
  });
  await logActivity(session, { fileId, folderId: targetFolderId, action: "move", detail: file.name });
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────
// Audit log + ถังขยะ (SharePoint recycle bin / activity)
// ─────────────────────────────────────────────────────────────────────────

/** ไทม์ไลน์กิจกรรมของไฟล์หนึ่ง — ใครทำอะไรเมื่อไหร่ (ล่าสุดก่อน) */
export async function listFileActivity(fileId: string) {
  const session = await requireAccess();
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);
  const rows = await prisma.companyFileActivity.findMany({
    where: { orgId: session.orgId, fileId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const actorIds = [...new Set(rows.map((r) => r.actorId))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds }, orgId: session.orgId }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(actors.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    detail: r.detail,
    createdAt: r.createdAt,
    actorName: nameById.get(r.actorId) ?? null,
  }));
}

export interface TrashRow {
  kind: "file" | "folder";
  id: string;
  name: string;
  deletedAt: Date;
  /** ที่มาของรายการ (ห้อง/โฟลเดอร์) เพื่อให้รู้ว่าลบมาจากไหน */
  sourceLabel: string;
}

/** รายการในถังขยะที่ผู้ใช้ปัจจุบันเห็นได้ (ไฟล์ + โฟลเดอร์ที่ถูก soft-delete) —
 * กรองสิทธิ์ห้องเหมือนมุมมองรวม ไม่โผล่ของห้องที่เข้าไม่ได้ */
export async function listTrash(): Promise<TrashRow[]> {
  const session = await requireAccess();
  const [delFiles, delFolders, allFolders, accessibleTopicIds] = await Promise.all([
    prisma.companyFile.findMany({
      where: { orgId: session.orgId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 300,
    }),
    prisma.companyFolder.findMany({
      where: { orgId: session.orgId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 300,
    }),
    prisma.companyFolder.findMany({ where: { orgId: session.orgId } }),
    listAccessibleTopicIds(session.orgId, session.userId),
  ]);
  const folderById = new Map(allFolders.map((f) => [f.id, f]));

  function effectiveRoomId(folderId: string | null): string | null {
    let currentId = folderId;
    for (let i = 0; i < 20 && currentId; i++) {
      const folder = folderById.get(currentId);
      if (!folder) return null;
      if (folder.roomId) return folder.roomId;
      currentId = folder.parentId;
    }
    return null;
  }
  function accessible(folderId: string | null): boolean {
    const roomId = effectiveRoomId(folderId);
    return !roomId || accessibleTopicIds.has(roomId);
  }
  function sourceLabelOf(folderId: string | null): string {
    if (!folderId) return "ไฟล์บริษัท (หน้าหลัก)";
    const folder = folderById.get(folderId);
    if (!folder) return "ไฟล์บริษัท";
    return folder.roomId ? `ห้อง: ${folder.name}` : `โฟลเดอร์: ${folder.name}`;
  }

  const rows: TrashRow[] = [];
  for (const f of delFiles) {
    if (!accessible(f.folderId)) continue;
    rows.push({ kind: "file", id: f.id, name: f.name, deletedAt: f.deletedAt as Date, sourceLabel: sourceLabelOf(f.folderId) });
  }
  for (const f of delFolders) {
    // แสดงเฉพาะโฟลเดอร์ "หัวกิ่ง" ที่ถูกลบ — โฟลเดอร์ย่อยที่ถูกลบพร้อมกันไม่ต้องโชว์ซ้ำ
    if (f.parentId && folderById.get(f.parentId)?.deletedAt) continue;
    if (!accessible(f.id)) continue;
    rows.push({ kind: "folder", id: f.id, name: f.name, deletedAt: f.deletedAt as Date, sourceLabel: f.roomId ? "ห้องรายงาน" : "โฟลเดอร์บริษัท" });
  }
  rows.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
  return rows;
}