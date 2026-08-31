"use server";

import "server-only";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission, type OrgSession } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { deleteFile as deleteStoredFile } from "@/lib/storage";
import { canUserAccessReportTopic, listAccessibleTopicIds } from "@/modules/report_task/lib/room-access-server";
import { COMPANY_FILES_PERMS } from "../permissions";
import type { ShareLinkRole } from "../types";

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

/** เนื้อหาของโฟลเดอร์เดียว — โฟลเดอร์ย่อยก่อน ไฟล์ทีหลัง เรียงตามชื่อทั้งคู่
 * รากบริษัท (folderId = null) ไม่โชว์โฟลเดอร์ที่ผูกกับห้อง — ดูได้ทางแท็บ
 * "ห้องรายงาน" (listRoomFolders) แยกต่างหากเท่านั้น ไม่ปนกับ tree ปกติ */
export async function listFolder(folderId: string | null) {
  const session = await requireAccess();
  await assertFolderAccess(session, folderId);
  const [folders, files] = await Promise.all([
    prisma.companyFolder.findMany({
      where: { orgId: session.orgId, parentId: folderId, ...(folderId === null ? { roomId: null } : {}) },
      orderBy: { name: "asc" },
    }),
    prisma.companyFile.findMany({
      where: { orgId: session.orgId, folderId },
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
export async function deleteFolder(folderId: string) {
  const session = await requireUpload();
  const folder = await prisma.companyFolder.findFirst({ where: { id: folderId, orgId: session.orgId } });
  if (!folder) throw new Error("ไม่พบโฟลเดอร์นี้");
  await assertFolderAccess(session, folderId);
  if (!canModify(session, folder.createdBy)) throw new Error("ไม่มีสิทธิ์ลบโฟลเดอร์นี้");

  const storageKeys = await collectStorageKeysUnderFolder(session.orgId, folderId);
  await prisma.companyFolder.delete({ where: { id: folderId } });
  await Promise.all(storageKeys.map((key) => deleteStoredFile(key)));
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
  return prisma.companyFile.update({
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

export async function deleteCompanyFile(fileId: string) {
  const session = await requireUpload();
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);
  if (!canModify(session, file.createdBy)) throw new Error("ไม่มีสิทธิ์ลบไฟล์นี้");

  const versions = await prisma.companyFileVersion.findMany({ where: { fileId }, select: { storageKey: true } });
  await prisma.companyFile.delete({ where: { id: fileId } });
  await Promise.all(versions.map((v) => deleteStoredFile(v.storageKey)));
}

export async function createShareLink(fileId: string, role: ShareLinkRole, expiresInDays: number | null) {
  const session = await requireUpload();
  const file = await prisma.companyFile.findFirst({ where: { id: fileId, orgId: session.orgId } });
  if (!file) throw new Error("ไม่พบไฟล์นี้");
  await assertFolderAccess(session, file.folderId);

  return prisma.companyFileShareLink.create({
    data: {
      fileId,
      token: randomBytes(24).toString("hex"),
      role,
      createdBy: session.userId,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null,
    },
  });
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
    where: { orgId: session.orgId, folderId: folder.id },
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
  /** "ไฟล์บริษัท" (อยู่ที่ราก), "โฟลเดอร์: X" หรือ "ห้อง: X" — บอกว่าไฟล์นี้มาจากไหน
   * โดยไม่ต้องกดเข้าไปดูทีละโฟลเดอร์/ห้องก่อน (มุมมองรวมแบบหน้า SharePoint) */
  sourceLabel: string;
  /** ชื่อคนอัปโหลดไฟล์นี้ครั้งแรก (ไม่ใช่คนแก้เวอร์ชันล่าสุด) — null ถ้าบัญชีถูกปิดใช้งานไปแล้ว */
  uploaderName: string | null;
}

/** ไฟล์ทั้งหมดที่ผู้ใช้ปัจจุบันเห็นได้ รวมทั้งบริษัท — ไม่ต้องไล่กดเข้าโฟลเดอร์/ห้อง
 * ทีละที่ (เหมือนหน้า SharePoint ที่รวมไฟล์จากทุกไซต์ที่มีสิทธิ์ไว้หน้าเดียว) ไฟล์ที่
 * อยู่ในห้องที่เข้าไม่ได้จะไม่ปรากฏเลย — กรองจริงฝั่งเซิร์ฟเวอร์ ไม่ใช่ซ่อนแค่ UI */
export async function listAllFiles(): Promise<AllFilesRow[]> {
  const session = await requireAccess();
  const [allFiles, allFolders, accessibleTopicIds] = await Promise.all([
    prisma.companyFile.findMany({ where: { orgId: session.orgId }, orderBy: { createdAt: "desc" } }),
    prisma.companyFolder.findMany({ where: { orgId: session.orgId } }),
    listAccessibleTopicIds(session.orgId, session.userId),
  ]);
  const folderById = new Map(allFolders.map((f) => [f.id, f]));
  const uploaderIds = [...new Set(allFiles.map((f) => f.createdBy))];
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
      sourceLabel: sourceLabelOf(file.folderId),
      uploaderName: uploaderNameById.get(file.createdBy) ?? null,
    }));
}
