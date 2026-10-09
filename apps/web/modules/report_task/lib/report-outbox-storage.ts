import type { ReportPost } from "@/modules/report_task/store/report-feed-store";

/** ที่เก็บของกล่องรอส่งโพสต์รายงาน — แยกจากตัวกู้คืน (report-outbox.ts) ให้ report-feed-store เรียกได้โดยไม่ import วนกัน */
export const OUTBOX_KEY = "sb.report-outbox.v1";
export const OUTBOX_MAX_AGE_MS = 24 * 3_600_000;

export interface OutboxEntry {
  post: ReportPost;
  at: number;
}

export function readOutbox(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    const list = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
    return Array.isArray(list) ? list.filter((e) => e && e.post && typeof e.post.id === "string") : [];
  } catch {
    return [];
  }
}

export function writeOutbox(list: OutboxEntry[]) {
  try {
    if (list.length === 0) localStorage.removeItem(OUTBOX_KEY);
    else localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
  } catch {
    /* เต็ม / โหมดส่วนตัว — แค่ไม่มีตาข่ายกันหาย */
  }
}

export function rememberUnsentPost(post: ReportPost | undefined) {
  if (!post) return;
  writeOutbox([...readOutbox().filter((e) => e.post.id !== post.id), { post, at: Date.now() }]);
}

export function forgetUnsentPost(postId: string) {
  const list = readOutbox();
  if (list.some((e) => e.post.id === postId)) writeOutbox(list.filter((e) => e.post.id !== postId));
}

