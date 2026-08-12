import "server-only";
import { randomUUID } from "node:crypto";

import { readStore, writeStore } from "./org-store";

export type IcsLinkTarget = "work" | "schedule";

export interface IcsLink {
  id: string;
  url: string;
  label: string;
  connectedAt: string;
  /** Which calendar tab this source's events show up on. */
  target: IcsLinkTarget;
  /** Owner's pause switch — sharing to the team, not this browser's local display. Defaults true. */
  visible: boolean;
}

export interface OwnedIcsLink extends IcsLink {
  ownerUserId: string;
}

/** Keyed by our app's userId — each person can connect several of their own calendars (Google, Outlook, Apple, ...). */
type LinksMap = Record<string, IcsLink[]>;

/*
 * ต้นทางเก็บลงไฟล์ `data/google-calendar/ics-links.json` ไฟล์เดียวรวมทุกคน
 * ที่นี่เก็บลง Postgres แยกตามบริษัท (คีย์ "google-calendar" ในตาราง
 * report_task.stores) ทุกฟังก์ชันจึงต้องรับ orgId เข้ามา
 *
 * ไม่ได้ใช้ optimistic concurrency ที่นี่ เพราะการต่อ/ตัดปฏิทินเป็นการกระทำ
 * ทีละครั้งของเจ้าของเอง ไม่ใช่การแก้เอกสารร่วมกันแบบ store อื่น
 */
const KEY = "google-calendar";

async function readMap(orgId: string): Promise<LinksMap> {
  const { data } = await readStore<LinksMap>(orgId, KEY);
  return data ?? {};
}

async function writeMap(orgId: string, map: LinksMap): Promise<void> {
  await writeStore(orgId, KEY, map, null);
}

// Links saved before `target`/`visible` existed don't have them on disk —
// default rather than crashing consumers that expect them to be set.
function withDefaults(l: IcsLink): IcsLink {
  return { ...l, target: l.target ?? "work", visible: l.visible ?? true };
}

export async function getIcsLinks(orgId: string, userId: string): Promise<IcsLink[]> {
  const map = await readMap(orgId);
  return (map[userId] ?? []).map(withDefaults);
}

/** Every connected calendar across every user — for building the shared, team-visible calendar feed. */
export async function getAllIcsLinks(orgId: string): Promise<OwnedIcsLink[]> {
  const map = await readMap(orgId);
  return Object.entries(map).flatMap(([ownerUserId, links]) =>
    links.map((l) => ({ ...withDefaults(l), ownerUserId }))
  );
}

export async function addIcsLink(
  orgId: string,
  userId: string,
  url: string,
  label: string,
  target: IcsLinkTarget,
  visible = true
): Promise<IcsLink> {
  const map = await readMap(orgId);
  const id = `ics-${randomUUID()}`;
  const entry: IcsLink = { id, url, label, connectedAt: new Date().toISOString(), target, visible };
  map[userId] = [...(map[userId] ?? []), entry];
  await writeMap(orgId, map);
  return entry;
}

export async function removeIcsLink(orgId: string, userId: string, linkId: string): Promise<void> {
  const map = await readMap(orgId);
  map[userId] = (map[userId] ?? []).filter((l) => l.id !== linkId);
  await writeMap(orgId, map);
}

export async function updateIcsLink(
  orgId: string,
  userId: string,
  linkId: string,
  patch: Partial<Pick<IcsLink, "target" | "visible">>
): Promise<void> {
  const map = await readMap(orgId);
  map[userId] = (map[userId] ?? []).map((l) => (l.id === linkId ? { ...l, ...patch } : l));
  await writeMap(orgId, map);
}
