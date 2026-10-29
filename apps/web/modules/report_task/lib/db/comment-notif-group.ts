/**
 * รวมแจ้งเตือน "แสดงความคิดเห็นในงาน" ของงานเดียวกันที่ยังไม่อ่าน เป็นแถวเดียวแบบเฟซบุ๊ก
 * ("ก, ข และอีก 2 คน แสดงความคิดเห็นในงาน "T" 5 ความคิดเห็น — ล่าสุด: …") — ผู้ใช้ขอ 29/10/2569
 * (CEO ได้คอมเมนต์ในงานที่ตัวเองมอบหมาย ~10 ครั้ง/วัน "เวลามีใหม่มาก็เด้งซ้ำ ๆ มันเลยดูรก")
 *
 * ทำที่เซิร์ฟเวอร์ตอนรวมแจ้งเตือน (writeOwnNotifications) เหมือน attachment-notif-group.ts:
 *  - รวมเมื่อ ผู้รับเดิม งานเดิม แถวเดิมยังไม่อ่าน (คนคอมเมนต์ต่างกันได้) — อ่านแล้วค่อยขึ้นแถวใหม่
 *  - แถวที่รวมแล้ว grouped = true ⇒ ไม่เด้ง/ไม่ส่งมือถือซ้ำ (อันแรกเด้งไปแล้ว) · ขึ้นบนสุดของกระดิ่งพร้อมเวลาล่าสุด
 *  - เฉพาะคอมเมนต์ที่มีข้อความ (หมวด pm.comment) — ถูกแท็ก / รับทราบ / ส่งรูปเปล่า ๆ แยกแถวตามเดิม
 *    (แท็กต้องเห็นแยก · รับทราบ/สติกเกอร์อยู่หมวดความเคลื่อนไหวที่หัวหน้าปิดไว้)
 */
import { topicForReportNotification } from "@/modules/notifications/prefs";
import type { GroupableNotification } from "./attachment-notif-group";

export interface CommentGroupable extends GroupableNotification {
  commentCount?: unknown;
  commentAuthors?: unknown;
  commentTitle?: unknown;
  commentPreview?: unknown;
}

/** task-store.ts addComment: `ชื่อ แสดงความคิดเห็นในงาน "ชื่องาน": ข้อความ` */
const TEXT_RE = /^(.+?) แสดงความคิดเห็นในงาน "([\s\S]*)": ([\s\S]*)$/;

interface Info {
  count: number;
  /** ล่าสุดก่อน ไม่ซ้ำ */
  authors: string[];
  title: string;
  preview: string;
}

function info(n: CommentGroupable): Info | null {
  if (n.kind !== "task_comment" || typeof n.message !== "string" || typeof n.taskId !== "string") return null;
  if (typeof n.commentCount === "number" && Array.isArray(n.commentAuthors) && typeof n.commentTitle === "string") {
    return { count: n.commentCount, authors: n.commentAuthors.map(String), title: n.commentTitle, preview: String(n.commentPreview ?? "") };
  }
  if (topicForReportNotification({ message: n.message, kind: "task_comment" }) !== "pm.comment") return null;
  const m = TEXT_RE.exec(n.message);
  if (!m) return null;
  return { count: 1, authors: [m[1]!], title: m[2]!, preview: m[3]! };
}

function authorLabel(authors: string[]): string {
  if (authors.length <= 1) return authors[0] ?? "มีคน";
  if (authors.length === 2) return `${authors[0]} และ ${authors[1]}`;
  return `${authors[0]}, ${authors[1]} และอีก ${authors.length - 2} คน`;
}

export function groupedCommentMessage(i: Info): string {
  return `${authorLabel(i.authors)} แสดงความคิดเห็นในงาน "${i.title}" ${i.count} ความคิดเห็น — ล่าสุด: ${i.preview}`;
}

/**
 * แถวใหม่ (ที่เครื่องนี้เพิ่งสร้างให้คนอื่น) + แถวที่เก็บอยู่ ⇒ แถวใหม่หลังรวม และแถวเก็บที่เหลือ (ตัดแถวที่ถูกรวมออก)
 * ไม่มีอะไรให้รวม = คืนเดิมทุกอย่าง
 */
export function groupTaskCommentNotifications<T extends CommentGroupable>(incoming: T[], stored: T[]): { incoming: T[]; stored: T[] } {
  if (!incoming.some((n) => info(n) !== null)) return { incoming, stored };
  const removed = new Set<unknown>();
  const keyOf = (n: T) => `${String(n.userId)}|${String(n.taskId)}`;
  const latest = new Map<string, T>();
  const canAbsorb = (p: T) => p.read !== true && !removed.has(p.id) && info(p) !== null;
  for (const p of stored) {
    if (!canAbsorb(p)) continue;
    const cur = latest.get(keyOf(p));
    if (!cur || String(p.createdAt) > String(cur.createdAt)) latest.set(keyOf(p), p);
  }

  const out: T[] = [];
  for (const n of incoming) {
    const mine = info(n);
    const prev = mine ? latest.get(keyOf(n)) : undefined;
    const before = prev && canAbsorb(prev) ? info(prev) : null;
    if (!mine || !prev || !before) {
      out.push(n);
      if (mine) latest.set(keyOf(n), n);
      continue;
    }
    const total: Info = {
      count: before.count + mine.count,
      authors: [...new Set([...mine.authors, ...before.authors])],
      title: mine.title,
      preview: mine.preview,
    };
    const prevAbsorbed = Array.isArray(prev.absorbedIds) ? (prev.absorbedIds as unknown[]) : [];
    const merged = {
      ...n,
      message: groupedCommentMessage(total),
      grouped: true,
      absorbedIds: [...prevAbsorbed, prev.id],
      commentCount: total.count,
      commentAuthors: total.authors,
      commentTitle: total.title,
      commentPreview: total.preview,
    } as T;
    removed.add(prev.id);
    const at = out.indexOf(prev);
    if (at >= 0) out.splice(at, 1);
    out.push(merged);
    latest.set(keyOf(n), merged);
  }
  return { incoming: out, stored: stored.filter((p) => !removed.has(p.id)) };
}
