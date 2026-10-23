import "server-only";
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import { prisma } from "@smartboss/database";

import { publishToUsers } from "@/lib/realtime/server";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { listDirectory, type DirectoryUser } from "@/modules/report_task/lib/db/employee-directory";
import { listDepartmentsWithOverlay } from "@/modules/report_task/lib/db/departments";
import type { ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { NOTE_LIMITS, type NoteMember, type NotePageMeta, type NoteSectionMeta, type NoteVersionMeta } from "./types";

/*
 * โน้ตของห้องรายงาน — ฝั่งเซิร์ฟเวอร์ (แก้พร้อมกันได้ด้วย Yjs)
 *
 * แหล่งความจริงคือฐานข้อมูลเสมอ: note_pages.state (สถานะบีบรวม) + note_updates (ชุดแก้ที่ต่อท้าย)
 * แคชในหน่วยความจำเป็นแค่ตัวเร่ง — ก่อนใช้ทุกครั้งดึงชุดแก้ที่ใหม่กว่าจากฐานข้อมูลมาก่อน
 * (ถ้าวันหน้ารันหลายโปรเซส แคชแต่ละโปรเซสยังตรงกับฐานข้อมูล)
 *
 * ── ป้องกันข้อมูลเต็ม/ล้น/หาย (ผู้ใช้ขอให้วิเคราะห์ 23/10/2569) ──
 *  • แก้ทุกครั้ง ≠ แถวถาวร: ชุดแก้ถูกบีบรวมเข้า state ทุก ~100 ชุด และ cron บีบหน้าที่ค้าง
 *  • หน้าเดียวไม่เกิน 5 MB (ตัวหนังสือ/ตารางล้วน — รูปเก็บที่ระบบไฟล์แนบ มีแค่ลิงก์) + CHECK ในฐานข้อมูล 8 MB
 *  • ชุดแก้เดียวไม่เกิน 1 MB · ข้อมูลเสีย (ถอดไม่ได้) ไม่ถูกบันทึก
 *  • ประวัติ: จุดพักเมื่อเว้นช่วงแก้ 5 นาที/ทุก 30 นาทีที่แก้ต่อเนื่อง · เก็บครบ 30 วัน เก่ากว่านั้นวันละอัน · ไม่เกิน 300 ต่อหน้า
 *  • ลบ = ถังขยะ 30 วันแล้วลบจริง (cron) · ห้องละไม่เกิน 2,000 หน้า / 100 ส่วน (กันสคริปต์วนสร้าง)
 *  • แก้พร้อมกัน: Yjs รวมให้เอง ไม่มีใครทับใคร · ลำดับมาไม่ตรง/ส่งซ้ำก็ได้ผลเดิม
 *  • เน็ตหลุด: เครื่องเก็บชุดที่ยังส่งไม่ได้ไว้ ส่งใหม่เมื่อกลับมา + ซิงก์เทียบ state vector ทุกครั้งที่ต่อใหม่
 */

type Session = { orgId: string; userId: string; roles: string[] };

export class NoteError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");
export const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/* ═════════════════════════ สิทธิ์: เห็นห้อง = อ่าน/แก้โน้ตได้ ═════════════════════════ */

interface RoomCtx {
  topic: ReportTopic;
  users: DirectoryUser[];
}
/*
 * สถานะในหน่วยความจำทั้งหมดอยู่บน globalThis ก้อนเดียว — route แต่ละไฟล์ (และ Next dev ตอนโหลดโมดูลซ้ำ)
 * อาจได้สำเนาโมดูลนี้คนละชุด ถ้าเก็บเป็นตัวแปรโมดูลธรรมดา ล็อก/แคชเอกสาร/รายชื่อคนเปิดดูจะแยกกัน
 * (เช่น /presence บันทึกคนดูไว้ชุดหนึ่ง แต่ส่งชุดแก้จากอีกชุด → อีกคนไม่เห็นสด และสองแคชบีบรวมทับกัน)
 */
interface NotesMemory {
  roomCache: Map<string, { at: number; ok: boolean; ctx: RoomCtx | null }>;
  docs: Map<string, CachedDoc>;
  locks: Map<string, Promise<unknown>>;
  textTimers: Map<string, ReturnType<typeof setTimeout>>;
  roomBytesCache: Map<string, { bytes: number; at: number }>;
  rooms: Map<string, Map<string, Viewer>>;
}
const mem = ((globalThis as unknown as { __smartbossNotes?: NotesMemory }).__smartbossNotes ??= {
  roomCache: new Map(),
  docs: new Map(),
  locks: new Map(),
  textTimers: new Map(),
  roomBytesCache: new Map(),
  rooms: new Map(),
});
const { roomCache, docs, locks, textTimers, roomBytesCache, rooms } = mem;
const ACCESS_TTL_MS = 30_000;

/** กติกาเดียวกับ canSeeReportTopic (lib/permissions.ts) แต่ใช้ข้อมูลจากฐานข้อมูล */
function canSee(topic: ReportTopic, user: DirectoryUser | undefined, isSuperAdmin: boolean, isDeptHead: boolean): boolean {
  if (isSuperAdmin || user?.isOwner) return true;
  const v = topic.visibility;
  if (user?.isWorker) {
    if (!v) return false;
    if (v.userIds?.length) return v.userIds.includes(user.id);
    return (!!user.departmentId && !!v.departmentIds?.includes(user.departmentId)) || !!v.extraUserIds?.includes(user.id);
  }
  if (!v || (!v.managerOnly && !v.departmentIds?.length && !v.userIds?.length)) return true;
  if (!user) return false;
  if (v.userIds?.length) return v.userIds.includes(user.id);
  if (v.managerOnly && !isDeptHead) return false;
  if (v.departmentIds?.length) {
    const inDept = !!user.departmentId && v.departmentIds.includes(user.departmentId);
    if (!inDept && !(v.extraUserIds?.includes(user.id) ?? false)) return false;
  }
  return true;
}

export async function requireRoom(session: Session, topicId: string): Promise<RoomCtx> {
  if (!topicId || topicId.length > 200) throw new NoteError("ไม่พบห้อง", 404);
  const key = `${session.orgId}|${session.userId}|${topicId}`;
  const hit = roomCache.get(key);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) {
    if (!hit.ok || !hit.ctx) throw new NoteError("ไม่มีสิทธิ์เข้าห้องนี้", 403);
    return hit.ctx;
  }
  const [feed, users, departments] = await Promise.all([
    readStore<{ topics?: ReportTopic[] }>(session.orgId, "report-feed"),
    listDirectory(session.orgId),
    listDepartmentsWithOverlay(session.orgId),
  ]);
  const topic = (feed.data?.topics ?? []).find((t) => t.id === topicId);
  const user = users.find((u) => u.id === session.userId);
  const isDeptHead = departments.some((d) => d.headId === session.userId);
  const ok = !!topic && canSee(topic, user, session.roles.includes("SUPER_ADMIN"), isDeptHead || !!user?.isOwner);
  const ctx = ok && topic ? { topic, users } : null;
  roomCache.set(key, { at: Date.now(), ok, ctx });
  if (roomCache.size > 5000) roomCache.clear();
  if (!ctx) throw new NoteError(topic ? "ไม่มีสิทธิ์เข้าห้องนี้" : "ไม่พบห้อง", topic ? 403 : 404);
  return ctx;
}

async function requirePage(session: Session, pageId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) throw new NoteError("ไม่พบหน้า", 404);
  const page = await prisma.reportNotePage.findFirst({
    where: { id: pageId, orgId: session.orgId },
    select: { id: true, orgId: true, topicId: true, title: true, deletedAt: true, sectionId: true, stateSize: true, updatedAt: true, updatedBy: true },
  });
  if (!page) throw new NoteError("ไม่พบหน้า", 404);
  const room = await requireRoom(session, page.topicId);
  return { page, room };
}

const nameOf = (users: DirectoryUser[], id: string | null | undefined) => (id ? users.find((u) => u.id === id)?.name ?? "ผู้ใช้" : "");

/* ═════════════════════════ เอกสารในหน่วยความจำ (แคช + ล็อกรายหน้า) ═════════════════════════ */

interface CachedDoc {
  doc: Y.Doc;
  lastId: bigint;
  /** ชุดแก้ที่ยังไม่บีบรวม */
  pending: number;
  /** ขนาดโดยประมาณ (ไบต์) — คำนวณจริงเมื่อเข้าใกล้ขีด */
  size: number;
  at: number;
}
const MAX_CACHED_DOCS = 40;
const CACHE_IDLE_MS = 10 * 60_000;
/** รวมขนาดเอกสารในแคชไม่เกินนี้ (หน้าใหญ่ ๆ หลายหน้าพร้อมกันไม่ทำให้หน่วยความจำเซิร์ฟเวอร์เต็ม) — ตัดออกแล้วโหลดจากฐานข้อมูลใหม่ได้ ไม่มีข้อมูลหาย */
const MAX_CACHED_BYTES = 60 * 1024 * 1024;

/** ทำงานของหน้าเดียวกันทีละคำขอ — กันสองคำขอบีบรวม/บันทึกชนกัน */
function withPageLock<T>(pageId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(pageId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(pageId, tail);
  void tail.then(() => {
    if (locks.get(pageId) === tail) locks.delete(pageId);
  });
  return run;
}

function evictIdle() {
  const now = Date.now();
  for (const [id, c] of docs) if (now - c.at > CACHE_IDLE_MS) docs.delete(id);
  if (docs.size > MAX_CACHED_DOCS) {
    const oldest = [...docs.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, docs.size - MAX_CACHED_DOCS);
    for (const [id] of oldest) docs.delete(id);
  }
  let total = 0;
  for (const c of docs.values()) total += c.size;
  if (total > MAX_CACHED_BYTES) {
    for (const [id, c] of [...docs.entries()].sort((a, b) => a[1].at - b[1].at)) {
      if (total <= MAX_CACHED_BYTES || docs.size <= 1) break;
      docs.delete(id);
      total -= c.size;
    }
  }
}

/** โหลดเอกสาร (หรือเติมชุดแก้ใหม่จากฐานข้อมูลเข้าแคช) — เรียกภายใต้ล็อกของหน้านั้น */
async function loadDoc(pageId: string, orgId: string): Promise<CachedDoc> {
  let c = docs.get(pageId);
  if (!c) {
    const page = await prisma.reportNotePage.findFirst({ where: { id: pageId, orgId }, select: { state: true, stateUpdateId: true } });
    if (!page) throw new NoteError("ไม่พบหน้า", 404);
    const doc = new Y.Doc();
    if (page.state.length > 0) Y.applyUpdate(doc, new Uint8Array(page.state));
    c = { doc, lastId: page.stateUpdateId, pending: 0, size: page.state.length, at: Date.now() };
    docs.set(pageId, c);
    evictIdle();
  } else {
    // อีกโปรเซสบีบรวมไปแล้ว (แถวชุดแก้ที่แคชนี้ยังไม่เห็นถูกลบ) — ใส่ state ล่าสุดทับ (Yjs ใส่ซ้ำได้ผลเท่าเดิม) ไม่งั้นแคชจะตกหล่นแล้วเขียนทับของใหม่
    const head = await prisma.reportNotePage.findFirst({ where: { id: pageId, orgId }, select: { stateUpdateId: true } });
    if (!head) throw new NoteError("ไม่พบหน้า", 404);
    if (head.stateUpdateId > c.lastId) {
      const page = await prisma.reportNotePage.findFirstOrThrow({ where: { id: pageId, orgId }, select: { state: true, stateUpdateId: true } });
      if (page.state.length > 0) Y.applyUpdate(c.doc, new Uint8Array(page.state));
      c.lastId = page.stateUpdateId;
      c.pending = 0;
      c.size = page.state.length;
    }
  }
  const newer = await prisma.reportNoteUpdate.findMany({ where: { pageId, orgId, id: { gt: c.lastId } }, orderBy: { id: "asc" }, select: { id: true, data: true } });
  for (const u of newer) {
    Y.applyUpdate(c.doc, new Uint8Array(u.data));
    c.lastId = u.id;
    c.pending += 1;
    c.size += u.data.length;
  }
  c.at = Date.now();
  return c;
}

/** ข้อความล้วนของเอกสาร (ค้นหา/ประวัติ/ตัวอย่าง) */
export function docText(doc: Y.Doc): string {
  const xml = doc.getXmlFragment("default").toString();
  return xml
    .replace(/<\/(paragraph|heading|listItem|taskItem|tableRow|blockquote|codeBlock)>/g, "\n")
    .replace(/<\/(tableCell|tableHeader)>/g, "\t")
    .replace(/<image[^>]*src="([^"]*)"[^>]*\/?>/g, "[รูป]")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** บีบชุดแก้ทั้งหมดเข้า state แล้วลบแถวชุดแก้ — ภายใต้ล็อก */
async function compact(pageId: string, orgId: string, c: CachedDoc) {
  if (c.pending === 0) return;
  // ใส่ทุกแถวที่จะลบซ้ำอีกรอบก่อนบีบ — แถวที่ commit ช้ากว่าเลขถัดไป (ไอดีมาไม่เรียง) จะไม่ถูกลบทิ้งโดยไม่ได้ใส่ในเอกสาร
  const rows = await prisma.reportNoteUpdate.findMany({ where: { pageId, orgId, id: { lte: c.lastId } }, orderBy: { id: "asc" }, select: { data: true } });
  for (const r of rows) Y.applyUpdate(c.doc, new Uint8Array(r.data));
  const state = Y.encodeStateAsUpdate(c.doc);
  const text = docText(c.doc).slice(0, 200_000);
  await prisma.$transaction([
    prisma.reportNotePage.update({ where: { id: pageId }, data: { state: Buffer.from(state), stateUpdateId: c.lastId, stateSize: state.length, searchText: text } }),
    prisma.reportNoteUpdate.deleteMany({ where: { pageId, orgId, id: { lte: c.lastId } } }),
  ]);
  c.pending = 0;
  c.size = state.length;
}

/**
 * ข้อความค้นหา: อัปเดตตามหลังการแก้ไม่เกิน 5 วินาที (รวบหลายชุดแก้เป็นครั้งเดียว ไม่คำนวณทุกการกดแป้น)
 * โปรเซสดับก่อนถึงเวลา = cron/บีบรอบถัดไปเขียนให้เอง
 */
function scheduleSearchText(pageId: string, orgId: string) {
  if (textTimers.has(pageId)) return;
  const t = setTimeout(() => {
    textTimers.delete(pageId);
    void withPageLock(pageId, async () => {
      const c = await loadDoc(pageId, orgId);
      await prisma.reportNotePage.update({ where: { id: pageId }, data: { searchText: docText(c.doc).slice(0, 200_000) } });
    }).catch((e) => console.error("[notes] search text", e));
  }, 5_000);
  t.unref?.();
  textTimers.set(pageId, t);
}

/* ═════════════════════════ ประวัติการแก้ไข ═════════════════════════ */

async function saveVersion(pageId: string, orgId: string, title: string, doc: Y.Doc, editors: string[], reason: "session" | "interval" | "restore") {
  const state = Y.encodeStateAsUpdate(doc);
  // เนื้อหาเหมือนเวอร์ชันล่าสุดเป๊ะ (เช่น พิมพ์แล้วลบกลับ) — ไม่เก็บซ้ำ แค่ปิดรอบ
  const last = await prisma.reportNoteVersion.findFirst({ where: { pageId, orgId }, orderBy: { createdAt: "desc" }, select: { state: true } });
  if (last && Buffer.from(state).equals(Buffer.from(last.state))) {
    await prisma.reportNotePage.update({ where: { id: pageId }, data: { lastVersionAt: new Date(), sessionEditors: [] } });
    return;
  }
  await prisma.reportNoteVersion.create({
    data: { id: randomUUID(), pageId, orgId, state: Buffer.from(state), text: docText(doc).slice(0, 200_000), title, editors, reason },
  });
  await prisma.reportNotePage.update({ where: { id: pageId }, data: { lastVersionAt: new Date(), sessionEditors: [] } });
  await pruneVersions(pageId);
}

/** เก็บครบ 30 วัน · เก่ากว่านั้นเหลือวันละอัน (อันสุดท้ายของวัน) · รวมไม่เกิน 300 */
async function pruneVersions(pageId: string) {
  await prisma.$executeRawUnsafe(
    `DELETE FROM report_task.note_versions v
      WHERE v.page_id = $1::uuid AND v.created_at < now() - ($2 || ' days')::interval
        AND v.id NOT IN (
          SELECT DISTINCT ON (date_trunc('day', created_at)) id FROM report_task.note_versions
           WHERE page_id = $1::uuid AND created_at < now() - ($2 || ' days')::interval
           ORDER BY date_trunc('day', created_at), created_at DESC)`,
    pageId,
    String(NOTE_LIMITS.keepAllVersionsDays),
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM report_task.note_versions WHERE page_id = $1::uuid AND id NOT IN (
       SELECT id FROM report_task.note_versions WHERE page_id = $1::uuid ORDER BY created_at DESC LIMIT $2)`,
    pageId,
    NOTE_LIMITS.maxVersionsPerPage,
  );
  // ขนาดรวม: นับจากใหม่ไปเก่า เกินงบเมื่อไรตัดที่เหลือ (เวอร์ชันล่าสุดอยู่เสมอ เพราะหน้าเดียวเล็กกว่างบ)
  await prisma.$executeRawUnsafe(
    `DELETE FROM report_task.note_versions WHERE id IN (
       SELECT id FROM (
         SELECT id, sum(octet_length(state)) OVER (ORDER BY created_at DESC, id) AS cum
           FROM report_task.note_versions WHERE page_id = $1::uuid) x
        WHERE x.cum > $2)`,
    pageId,
    NOTE_LIMITS.versionBytesPerPage,
  );
}

/** ขนาดเนื้อหาทั้งห้อง (แคช 1 นาที — ไม่ต้องรวมทุกครั้งที่พิมพ์) */
async function assertRoomSpace(orgId: string, topicId: string, adding: number) {
  const key = `${orgId}:${topicId}`;
  let hit = roomBytesCache.get(key);
  if (!hit || Date.now() - hit.at > 60_000) {
    const agg = await prisma.reportNotePage.aggregate({ where: { orgId, topicId, deletedAt: null }, _sum: { stateSize: true } });
    hit = { bytes: agg._sum.stateSize ?? 0, at: Date.now() };
    roomBytesCache.set(key, hit);
    if (roomBytesCache.size > 2000) roomBytesCache.clear();
  }
  if (hit.bytes + adding > NOTE_LIMITS.roomBytes) {
    throw new NoteError(`โน้ตของห้องนี้เต็มแล้ว (${Math.round(NOTE_LIMITS.roomBytes / 1024 / 1024)} MB) — ย้ายหน้าที่ไม่ใช้ไปถังขยะ แล้วลองใหม่`, 413);
  }
  hit.bytes += adding;
}

/* ═════════════════════════ คนที่เปิดดูอยู่ (สด) ═════════════════════════ */

interface Viewer {
  userId: string;
  name: string;
  pageId: string | null;
  awareness: string | null;
  at: number;
}
/** `${orgId}:${topicId}` → clientId → viewer (topic id ไม่ unique ข้ามบริษัท จึงต้องมี orgId) */
const VIEWER_TTL_MS = 60_000;
/** กันหน่วยความจำบวม (เช่น สคริปต์ยิงไอดีใหม่ไม่หยุด) — เกินนี้ตัดคนที่เงียบนานสุดออก */
const MAX_VIEWERS_PER_ROOM = 300;

function roomViewers(orgId: string, topicId: string): Map<string, Viewer> {
  const key = `${orgId}:${topicId}`;
  let m = rooms.get(key);
  if (!m) rooms.set(key, (m = new Map()));
  const now = Date.now();
  for (const [cid, v] of m) if (now - v.at > VIEWER_TTL_MS) m.delete(cid);
  // ห้องอื่นที่ไม่มีคนแล้ว — ลบทิ้ง (ไม่ค้างในหน่วยความจำตลอดอายุโปรเซส)
  for (const [k, other] of rooms) {
    if (k === key) continue;
    for (const [cid, v] of other) if (now - v.at > VIEWER_TTL_MS) other.delete(cid);
    if (other.size === 0) rooms.delete(k);
  }
  return m;
}

function members(m: Map<string, Viewer>, pageId: string | null): NoteMember[] {
  return [...m.entries()].filter(([, v]) => !pageId || v.pageId === pageId).map(([clientId, v]) => ({ clientId, userId: v.userId, name: v.name, pageId: v.pageId }));
}

function sendTo(m: Map<string, Viewer>, filter: (v: Viewer) => boolean, event: Record<string, unknown> & { type: string }) {
  const users = [...new Set([...m.values()].filter(filter).map((v) => v.userId))];
  if (users.length) publishToUsers(users, event);
}

export async function presence(session: Session, input: { topicId: string; pageId: string | null; clientId: string; awareness?: string | null; leave?: boolean }) {
  const room = await requireRoom(session, input.topicId);
  if (input.pageId) {
    const page = await prisma.reportNotePage.findFirst({ where: { id: input.pageId, orgId: session.orgId, topicId: input.topicId }, select: { id: true } });
    if (!page) throw new NoteError("ไม่พบหน้า", 404);
  }
  const clientId = String(input.clientId).slice(0, 64);
  const m = roomViewers(session.orgId, input.topicId);
  const prev = m.get(clientId);
  if (input.leave) {
    m.delete(clientId);
    if (prev?.pageId) sendTo(m, (v) => v.pageId === prev.pageId, { type: "note.leave", topicId: input.topicId, pageId: prev.pageId, clientId });
    return { members: [] as NoteMember[], awareness: [] as { clientId: string; data: string }[] };
  }
  const awareness = input.awareness && input.awareness.length <= 20_000 ? input.awareness : prev?.pageId === input.pageId ? prev?.awareness ?? null : null;
  m.set(clientId, { userId: session.userId, name: nameOf(room.users, session.userId), pageId: input.pageId, awareness, at: Date.now() });
  if (m.size > MAX_VIEWERS_PER_ROOM) {
    const oldest = [...m.entries()].sort((x, y) => x[1].at - y[1].at).slice(0, m.size - MAX_VIEWERS_PER_ROOM);
    for (const [cid] of oldest) m.delete(cid);
  }
  if (prev?.pageId && prev.pageId !== input.pageId) sendTo(m, (v) => v.pageId === prev.pageId, { type: "note.leave", topicId: input.topicId, pageId: prev.pageId, clientId });
  if (input.pageId && (input.awareness || !prev || prev.pageId !== input.pageId)) {
    sendTo(m, (v) => v.pageId === input.pageId, { type: "note.presence", topicId: input.topicId, pageId: input.pageId, clientId, userId: session.userId, name: nameOf(room.users, session.userId), awareness });
  }
  return {
    members: members(m, null),
    awareness: input.pageId ? [...m.entries()].filter(([cid, v]) => cid !== clientId && v.pageId === input.pageId && v.awareness).map(([cid, v]) => ({ clientId: cid, data: v.awareness! })) : [],
  };
}

/** แจ้งทุกคนที่เปิดแท็บโน้ตของห้องนี้อยู่ ให้โหลดรายชื่อหน้าใหม่ */
function announceList(orgId: string, topicId: string) {
  const m = roomViewers(orgId, topicId);
  sendTo(m, () => true, { type: "note.list", topicId });
}

/* ═════════════════════════ หน้า / ส่วน ═════════════════════════ */

export async function listRoom(session: Session, topicId: string, opts: { trash?: boolean; q?: string } = {}) {
  const room = await requireRoom(session, topicId);
  const q = opts.q?.trim().slice(0, 100);
  const [sections, pages] = await Promise.all([
    prisma.reportNoteSection.findMany({ where: { orgId: session.orgId, topicId, deletedAt: null }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    prisma.reportNotePage.findMany({
      where: {
        orgId: session.orgId,
        topicId,
        deletedAt: opts.trash ? { not: null } : null,
        ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { searchText: { contains: q, mode: "insensitive" as const } }] } : {}),
      },
      orderBy: [{ pinned: "desc" }, { sort: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, sectionId: true, sort: true, pinned: true, updatedAt: true, updatedBy: true, deletedAt: true, deletedBy: true, stateSize: true, searchText: q ? true : false },
      take: NOTE_LIMITS.pagesPerRoom,
    }),
  ]);
  const snippet = (text: string | undefined) => {
    if (!q || !text) return undefined;
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return undefined;
    return `${i > 30 ? "…" : ""}${text.slice(Math.max(0, i - 30), i + q.length + 50).replace(/\s+/g, " ")}`;
  };
  return {
    sections: sections.map((s): NoteSectionMeta => ({ id: s.id, name: s.name, color: s.color, sort: s.sort })),
    pages: pages.map(
      (p): NotePageMeta => ({
        id: p.id,
        title: p.title,
        sectionId: p.sectionId,
        sort: p.sort,
        pinned: p.pinned,
        updatedAt: p.updatedAt.toISOString(),
        updatedByName: nameOf(room.users, p.updatedBy),
        deletedAt: p.deletedAt?.toISOString() ?? null,
        deletedByName: nameOf(room.users, p.deletedBy),
        sizeKb: Math.ceil(p.stateSize / 1024),
        snippet: snippet((p as { searchText?: string }).searchText),
      }),
    ),
    viewers: members(roomViewers(session.orgId, topicId), null),
  };
}

const cleanTitle = (t: unknown, fallback: string) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_LIMITS.titleChars) || fallback;

export async function createPage(session: Session, input: { topicId: string; sectionId?: string | null; title?: string; state?: string }) {
  await requireRoom(session, input.topicId);
  const count = await prisma.reportNotePage.count({ where: { orgId: session.orgId, topicId: input.topicId, deletedAt: null } });
  if (count >= NOTE_LIMITS.pagesPerRoom) throw new NoteError(`ห้องนี้มีโน้ตครบ ${NOTE_LIMITS.pagesPerRoom.toLocaleString()} หน้าแล้ว — ลบหน้าที่ไม่ใช้ก่อน`);
  const sectionId = input.sectionId && (await prisma.reportNoteSection.findFirst({ where: { id: input.sectionId, orgId: session.orgId, topicId: input.topicId, deletedAt: null }, select: { id: true } })) ? input.sectionId : null;
  // หน้าสำเร็จรูป: เครื่องสร้างเอกสารเริ่มต้นมาให้ — ตรวจว่าถอดได้และไม่ใหญ่เกิน
  let state = new Uint8Array(0);
  if (input.state) {
    state = fromB64(input.state);
    if (state.length > NOTE_LIMITS.updateBytes) throw new NoteError("หน้าเริ่มต้นใหญ่เกินไป");
    await assertRoomSpace(session.orgId, input.topicId, state.length);
    try {
      Y.applyUpdate(new Y.Doc(), state);
    } catch {
      throw new NoteError("ข้อมูลหน้าเริ่มต้นไม่ถูกต้อง");
    }
  }
  const max = await prisma.reportNotePage.aggregate({ where: { orgId: session.orgId, topicId: input.topicId }, _max: { sort: true } });
  const page = await prisma.reportNotePage.create({
    data: {
      id: randomUUID(),
      orgId: session.orgId,
      topicId: input.topicId,
      sectionId,
      title: cleanTitle(input.title, "หน้าใหม่"),
      sort: (max._max.sort ?? 0) + 1,
      state: Buffer.from(state),
      stateSize: state.length,
      createdBy: session.userId,
      updatedBy: session.userId,
    },
    select: { id: true },
  });
  announceList(session.orgId, input.topicId);
  return page;
}

export async function updatePageMeta(session: Session, input: { pageId: string; title?: string; sectionId?: string | null; pinned?: boolean; sort?: number }) {
  const { page } = await requirePage(session, input.pageId);
  if (page.deletedAt) throw new NoteError("หน้านี้อยู่ในถังขยะ");
  const data: { title?: string; sectionId?: string | null; pinned?: boolean; sort?: number; updatedBy: string; updatedAt: Date } = { updatedBy: session.userId, updatedAt: new Date() };
  if (input.title !== undefined) data.title = cleanTitle(input.title, page.title);
  if (input.pinned !== undefined) data.pinned = !!input.pinned;
  if (input.sort !== undefined && Number.isInteger(input.sort)) data.sort = Math.max(-1_000_000, Math.min(1_000_000, input.sort));
  if (input.sectionId !== undefined) {
    data.sectionId = input.sectionId && (await prisma.reportNoteSection.findFirst({ where: { id: input.sectionId, orgId: session.orgId, topicId: page.topicId, deletedAt: null }, select: { id: true } })) ? input.sectionId : null;
  }
  await prisma.reportNotePage.update({ where: { id: page.id }, data });
  announceList(session.orgId, page.topicId);
}

export async function trashPage(session: Session, pageId: string, restore = false) {
  const { page } = await requirePage(session, pageId);
  await prisma.reportNotePage.update({ where: { id: page.id }, data: restore ? { deletedAt: null, deletedBy: null } : { deletedAt: new Date(), deletedBy: session.userId } });
  announceList(session.orgId, page.topicId);
}

export async function saveSection(session: Session, input: { topicId: string; id?: string; name?: string; color?: string; sort?: number; remove?: boolean }) {
  await requireRoom(session, input.topicId);
  if (input.id) {
    const s = await prisma.reportNoteSection.findFirst({ where: { id: input.id, orgId: session.orgId, topicId: input.topicId, deletedAt: null } });
    if (!s) throw new NoteError("ไม่พบส่วน", 404);
    if (input.remove) {
      // ลบส่วน = หน้าข้างในย้ายออกมาไว้ "ไม่มีส่วน" (หน้าไม่หาย)
      await prisma.$transaction([
        prisma.reportNotePage.updateMany({ where: { orgId: session.orgId, topicId: input.topicId, sectionId: s.id }, data: { sectionId: null } }),
        prisma.reportNoteSection.update({ where: { id: s.id }, data: { deletedAt: new Date() } }),
      ]);
    } else {
      await prisma.reportNoteSection.update({
        where: { id: s.id },
        data: { ...(input.name !== undefined ? { name: cleanTitle(input.name, s.name).slice(0, 60) } : {}), ...(input.color ? { color: String(input.color).slice(0, 20) } : {}), ...(Number.isInteger(input.sort) ? { sort: input.sort } : {}) },
      });
    }
  } else {
    const count = await prisma.reportNoteSection.count({ where: { orgId: session.orgId, topicId: input.topicId, deletedAt: null } });
    if (count >= NOTE_LIMITS.sectionsPerRoom) throw new NoteError(`ห้องนี้มีส่วนครบ ${NOTE_LIMITS.sectionsPerRoom} ส่วนแล้ว`);
    await prisma.reportNoteSection.create({ data: { id: randomUUID(), orgId: session.orgId, topicId: input.topicId, name: cleanTitle(input.name, "ส่วนใหม่").slice(0, 60), color: String(input.color ?? "violet").slice(0, 20), sort: count + 1, createdBy: session.userId } });
  }
  announceList(session.orgId, input.topicId);
}

/* ═════════════════════════ เนื้อหา: เปิด / ส่งชุดแก้ / ซิงก์ ═════════════════════════ */

export async function openPage(session: Session, pageId: string) {
  const { page, room } = await requirePage(session, pageId);
  const state = await withPageLock(pageId, async () => {
    const c = await loadDoc(pageId, session.orgId);
    return Y.encodeStateAsUpdate(c.doc);
  });
  return {
    id: page.id,
    topicId: page.topicId,
    title: page.title,
    deleted: !!page.deletedAt,
    state: b64(state),
    updatedAt: page.updatedAt.toISOString(),
    updatedByName: nameOf(room.users, page.updatedBy),
    limits: { pageBytes: NOTE_LIMITS.pageBytes, updateBytes: NOTE_LIMITS.updateBytes },
  };
}

export async function pushUpdate(session: Session, input: { pageId: string; update: string; clientId: string }) {
  const { page } = await requirePage(session, input.pageId);
  if (page.deletedAt) throw new NoteError("หน้านี้อยู่ในถังขยะ — กู้คืนก่อนแก้", 409);
  const update = fromB64(input.update);
  if (update.length === 0) return { ok: true as const };
  if (update.length > NOTE_LIMITS.updateBytes) throw new NoteError("แก้ครั้งเดียวใหญ่เกินไป (เช่น วางข้อความยาวมาก) — แบ่งวางทีละส่วน", 413);
  try {
    Y.decodeUpdate(update);
  } catch {
    throw new NoteError("ข้อมูลเสีย — โหลดหน้าใหม่", 400);
  }
  const clientId = String(input.clientId).slice(0, 64);

  return withPageLock(input.pageId, async () => {
    const c = await loadDoc(input.pageId, session.orgId);

    // ขีดขนาดหน้า: ใกล้ขีดเมื่อไรคำนวณจริงบนสำเนา — เกินก็ไม่รับ (เอกสารในแคช/ฐานข้อมูลไม่เปลี่ยน)
    if (c.size + update.length > NOTE_LIMITS.pageBytes * 0.8) {
      const probe = new Y.Doc();
      Y.applyUpdate(probe, Y.encodeStateAsUpdate(c.doc));
      Y.applyUpdate(probe, update);
      const exact = Y.encodeStateAsUpdate(probe).length;
      if (exact > NOTE_LIMITS.pageBytes) throw new NoteError(`หน้านี้ใหญ่เกิน ${Math.round(NOTE_LIMITS.pageBytes / 1024 / 1024)} MB แล้ว — แยกเนื้อหาไปหน้าใหม่`, 413);
      c.size = exact - update.length;
    }

    // จุดพักประวัติ: เว้นช่วงแก้นานพอ = จบรอบก่อนหน้า · แก้ต่อเนื่องนาน = พักทุก 30 นาที
    const meta = await prisma.reportNotePage.findUniqueOrThrow({ where: { id: input.pageId }, select: { lastEditAt: true, lastVersionAt: true, sessionEditors: true, title: true } });
    const now = Date.now();
    const gap = meta.lastEditAt ? now - meta.lastEditAt.getTime() : Infinity;
    const sinceVersion = meta.lastVersionAt ? now - meta.lastVersionAt.getTime() : Infinity;
    // เวอร์ชันที่พัก = สถานะ "ก่อน" ชุดแก้นี้ (จบรอบของคนก่อนหน้า) แล้วเริ่มนับคนแก้รอบใหม่
    let editorsNow = meta.sessionEditors;
    if (editorsNow.length > 0 && (gap > NOTE_LIMITS.versionGapMs || sinceVersion > NOTE_LIMITS.versionIntervalMs)) {
      await saveVersion(input.pageId, session.orgId, meta.title, c.doc, editorsNow, gap > NOTE_LIMITS.versionGapMs ? "session" : "interval");
      editorsNow = [];
    }

    await assertRoomSpace(session.orgId, page.topicId, update.length);
    const row = await prisma.reportNoteUpdate.create({ data: { pageId: input.pageId, orgId: session.orgId, data: Buffer.from(update), byUserId: session.userId }, select: { id: true } });
    Y.applyUpdate(c.doc, update);
    c.lastId = row.id;
    c.pending += 1;
    c.size += update.length;
    await prisma.reportNotePage.update({
      where: { id: input.pageId },
      data: {
        lastEditAt: new Date(),
        updatedAt: new Date(),
        updatedBy: session.userId,
        // ขนาดโดยประมาณ (รวมชุดแก้ที่ยังไม่บีบ) — ใช้คุมพื้นที่รวมของห้อง
        stateSize: c.size,
        sessionEditors: [...new Set([...editorsNow, session.userId])],
        // รอบแก้ใหม่เริ่ม (ยังไม่มีคนแก้ค้าง) = เริ่มนับ "แก้ต่อเนื่อง 30 นาที" จากตอนนี้
        // ไม่งั้นหน้าที่พักเวอร์ชันไว้นานแล้ว จะพักซ้ำทันทีตั้งแต่ชุดแก้ที่สอง
        ...(editorsNow.length === 0 ? { lastVersionAt: new Date() } : {}),
      },
    });
    if (c.pending >= NOTE_LIMITS.compactEvery) await compact(input.pageId, session.orgId, c);
    else scheduleSearchText(input.pageId, session.orgId);

    const m = roomViewers(session.orgId, page.topicId);
    sendTo(m, (v) => v.pageId === input.pageId, { type: "note.update", topicId: page.topicId, pageId: input.pageId, clientId, update: input.update });
    return { ok: true as const };
  });
}

/** ส่วนที่เครื่องยังไม่มี (เทียบ state vector) — ใช้ตอนต่อใหม่/กันพลาดชุดแก้ระหว่างโหลด */
export async function syncPage(session: Session, input: { pageId: string; stateVector: string }) {
  await requirePage(session, input.pageId);
  const sv = fromB64(input.stateVector);
  return withPageLock(input.pageId, async () => {
    const c = await loadDoc(input.pageId, session.orgId);
    return { update: b64(Y.encodeStateAsUpdate(c.doc, sv)) };
  });
}

/* ═════════════════════════ ประวัติ ═════════════════════════ */

export async function listVersions(session: Session, pageId: string) {
  const { room } = await requirePage(session, pageId);
  const rows = await prisma.reportNoteVersion.findMany({ where: { pageId, orgId: session.orgId }, orderBy: { createdAt: "desc" }, take: NOTE_LIMITS.maxVersionsPerPage, select: { id: true, createdAt: true, editors: true, reason: true, title: true } });
  return rows.map((r): NoteVersionMeta => ({ id: r.id, at: r.createdAt.toISOString(), editors: r.editors.map((e) => nameOf(room.users, e)), reason: r.reason as NoteVersionMeta["reason"], title: r.title }));
}

export async function getVersion(session: Session, pageId: string, versionId: string) {
  await requirePage(session, pageId);
  const v = await prisma.reportNoteVersion.findFirst({ where: { id: versionId, pageId, orgId: session.orgId } });
  if (!v) throw new NoteError("ไม่พบเวอร์ชัน", 404);
  const prev = await prisma.reportNoteVersion.findFirst({ where: { pageId, orgId: session.orgId, createdAt: { lt: v.createdAt } }, orderBy: { createdAt: "desc" }, select: { text: true } });
  return { id: v.id, state: b64(new Uint8Array(v.state)), text: v.text, prevText: prev?.text ?? "", at: v.createdAt.toISOString() };
}

/** ก่อนกู้คืน: พักสถานะปัจจุบันเป็นเวอร์ชันไว้ก่อน (กู้แล้วย้อนกลับได้เสมอ) */
export async function checkpointBeforeRestore(session: Session, pageId: string) {
  const { page } = await requirePage(session, pageId);
  await withPageLock(pageId, async () => {
    const c = await loadDoc(pageId, session.orgId);
    const meta = await prisma.reportNotePage.findUniqueOrThrow({ where: { id: pageId }, select: { sessionEditors: true } });
    await saveVersion(pageId, session.orgId, page.title, c.doc, [...new Set([...meta.sessionEditors, session.userId])], "restore");
  });
}

/* ═════════════════════════ งานเบื้องหลัง (cron) ═════════════════════════ */

/**
 * - บีบหน้าที่มีชุดแก้ค้าง (แก้แล้วไม่มีใครแก้ต่อ เลยไม่ถึงรอบบีบปกติ)
 * - พักประวัติให้หน้าที่แก้แล้วเงียบไป (ไม่ต้องรอคนแก้ครั้งถัดไป)
 * - ลบถาวรหน้าที่อยู่ในถังขยะเกิน 30 วัน (ชุดแก้/ประวัติลบตาม cascade)
 */
export async function runNotesMaintenance(): Promise<{ compacted: number; versioned: number; purged: number }> {
  let compacted = 0;
  let versioned = 0;
  const stale = await prisma.$queryRawUnsafe<{ page_id: string; org_id: string }[]>(
    `SELECT DISTINCT page_id::text, org_id FROM report_task.note_updates WHERE at < now() - interval '30 minutes' LIMIT 200`,
  );
  for (const s of stale) {
    await withPageLock(s.page_id, async () => {
      const c = await loadDoc(s.page_id, s.org_id).catch(() => null);
      if (c) {
        await compact(s.page_id, s.org_id, c);
        compacted += 1;
      }
    });
  }
  const quiet = await prisma.reportNotePage.findMany({
    where: { deletedAt: null, lastEditAt: { lt: new Date(Date.now() - NOTE_LIMITS.versionGapMs) }, NOT: { sessionEditors: { isEmpty: true } } },
    select: { id: true, orgId: true, title: true, sessionEditors: true },
    take: 200,
  });
  for (const p of quiet) {
    await withPageLock(p.id, async () => {
      const c = await loadDoc(p.id, p.orgId).catch(() => null);
      if (c) {
        await saveVersion(p.id, p.orgId, p.title, c.doc, p.sessionEditors, "session");
        versioned += 1;
      }
    });
  }
  const cutoff = new Date(Date.now() - NOTE_LIMITS.trashDays * 24 * 3600_000);
  const purge = await prisma.reportNotePage.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true }, take: 500 });
  for (const p of purge) docs.delete(p.id);
  const purged = purge.length ? (await prisma.reportNotePage.deleteMany({ where: { id: { in: purge.map((p) => p.id) } } })).count : 0;
  await prisma.reportNoteSection.deleteMany({ where: { deletedAt: { lt: cutoff } } });
  return { compacted, versioned, purged };
}
