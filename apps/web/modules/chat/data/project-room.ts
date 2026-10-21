import "server-only";
import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";

/*
 * ห้องแชทของโปรเจกต์ (แท็บ "ข้อความ" ในโปรเจกต์ — project.chatChannelId) — ผู้ใช้ขอ 20/10/2569:
 * เปลี่ยนชื่อห้อง · ปิดห้องตอนงานจบ (อ่านย้อนหลังได้ ส่งใหม่ไม่ได้) · ลบห้อง (กู้คืนได้) · หัวหน้าโปรเจกต์จัดการห้องได้
 *
 * ไฟล์นี้อ่านอย่างเดียว ไม่ import channels.ts (กัน import วน) — การกระทำจริงอยู่ใน channels.ts
 * ห้องกลุ่มอื่นที่ไม่ได้ผูกกับโปรเจกต์ไม่โดนอะไรเลย
 */

/** ห้องที่ปิดแล้ว (อ่านอย่างเดียว) — store ของบริษัท ไม่ต้องเพิ่มคอลัมน์ในตาราง */
const CLOSED_KEY = "chat-closed-channels";
export type ClosedChannelMap = Record<string, { by: string; at: string }>;

interface ProjectLite {
  id: string;
  name: string;
  ownerId: string;
  members?: { userId: string; role: string }[];
  chatChannelId?: string;
}

export interface ProjectRoom {
  projectId: string;
  projectName: string;
  ownerId: string;
  /** ผู้ดูแลโปรเจกต์ + สมาชิกที่ "แก้ได้" — จัดการห้องได้เหมือนแอดมินห้อง */
  managerIds: Set<string>;
}

const TTL_MS = 15_000;
const g = globalThis as unknown as {
  __chatProjectRooms?: Map<string, { at: number; rooms: Map<string, ProjectRoom> }>;
  __chatClosed?: Map<string, { at: number; map: ClosedChannelMap; version: number }>;
};
const roomCache = (g.__chatProjectRooms ??= new Map());
const closedCache = (g.__chatClosed ??= new Map());

/** channelId → โปรเจกต์ที่ใช้ห้องนั้น (แคช 15 วิ — getChannelAccess เรียกทุกข้อความ) */
export async function projectRooms(orgId: string): Promise<Map<string, ProjectRoom>> {
  const hit = roomCache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rooms;
  const { data } = await readStore<ProjectLite[]>(orgId, "projects");
  const rooms = new Map<string, ProjectRoom>();
  for (const p of Array.isArray(data) ? data : []) {
    if (!p?.chatChannelId) continue;
    const managerIds = new Set<string>([p.ownerId]);
    for (const m of p.members ?? []) if (m.role === "owner" || m.role === "editor") managerIds.add(m.userId);
    rooms.set(p.chatChannelId, { projectId: p.id, projectName: p.name, ownerId: p.ownerId, managerIds });
  }
  roomCache.set(orgId, { at: Date.now(), rooms });
  return rooms;
}

export async function projectRoomOf(orgId: string, channelId: string): Promise<ProjectRoom | null> {
  return (await projectRooms(orgId)).get(channelId) ?? null;
}

/** ลืมแคช — เรียกหลังเพิ่งผูกห้องใหม่กับโปรเจกต์ (สร้างห้องจากแท็บข้อความ) */
export function forgetProjectRooms(orgId: string) {
  roomCache.delete(orgId);
}

async function readClosed(orgId: string, fresh = false): Promise<{ map: ClosedChannelMap; version: number }> {
  const hit = closedCache.get(orgId);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit;
  const { data, version } = await readStore<ClosedChannelMap>(orgId, CLOSED_KEY);
  const entry = { at: Date.now(), map: data ?? {}, version };
  closedCache.set(orgId, entry);
  return entry;
}

export async function closedChannels(orgId: string): Promise<ClosedChannelMap> {
  return (await readClosed(orgId)).map;
}

export async function isChannelClosed(orgId: string, channelId: string): Promise<boolean> {
  return channelId in (await readClosed(orgId)).map;
}

/** ปิด/เปิดห้อง — เขียนแบบ optimistic lock กันสองคนกดพร้อมกันทับกัน */
export async function writeChannelClosed(orgId: string, channelId: string, closed: boolean, userId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { map, version } = await readClosed(orgId, true);
    if ((channelId in map) === closed) return false;
    const next = { ...map };
    if (closed) next[channelId] = { by: userId, at: new Date().toISOString() };
    else delete next[channelId];
    const res = await writeStore(orgId, CLOSED_KEY, next, version === 0 ? null : version, userId);
    if (res.ok) {
      closedCache.set(orgId, { at: Date.now(), map: next, version: res.version });
      return true;
    }
  }
  throw new Error("บันทึกสถานะห้องไม่สำเร็จ ลองใหม่อีกครั้ง");
}
