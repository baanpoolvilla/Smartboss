/**
 * รวมแจ้งเตือน "แนบไฟล์ในงาน" ที่มาติด ๆ กัน (คนเดิมแนบทีละไฟล์ในงานเดิม) เป็นแถวเดียว
 * ("ก แนบไฟล์ 6 ไฟล์ ในงาน ...") แทนการเด้งทีละไฟล์ — ทำที่เซิร์ฟเวอร์ (writeOwnNotifications)
 * เพราะเครื่องคนแนบไม่มีแจ้งเตือนของคนอื่นอยู่ในมือ แก้แถวเดิมของผู้รับเองไม่ได้
 *
 * เฉพาะ kind "task_attachment" และ "task_comment" ที่เป็นรูป/ไฟล์อย่างเดียว (ไม่มีข้อความ — ส่งรูปทีละรูปแบบ LINE
 * "ส่ง 3 รูปได้แจ้งเตือน 3 อัน ซ้ำซ้อน" 18/10/2569) · คอมเมนต์ที่มีข้อความ/แท็ก และแจ้งเตือนแบบอื่น ไม่ผ่านตรงนี้
 * รวมเมื่อ: ผู้รับเดิม คนแนบเดิม งานเดิม แถวเดิมยังไม่อ่าน และแถวเดิมเกิดไม่เกิน GROUP_WINDOW_MS
 * แถวที่รวมแล้วได้ id ใหม่ (ของแถวที่เพิ่งมา) + grouped = true ⇒ ไม่เด้ง/ไม่ส่งมือถือซ้ำ
 * (อันแรกเด้งไปแล้ว) · id ของแถวที่ถูกรวมเก็บไว้ใน absorbedIds กันเครื่องที่ยังถือแถวเก่าส่งกลับมาเพิ่มซ้ำ
 */

export const GROUP_WINDOW_MS = 10 * 60_000;

export interface GroupableNotification {
  id?: unknown;
  userId?: unknown;
  byUserId?: unknown;
  message?: unknown;
  createdAt?: unknown;
  read?: unknown;
  kind?: unknown;
  taskId?: unknown;
  grouped?: unknown;
  absorbedIds?: unknown;
}

const ATTACH_RE = /^(.+?) แนบไฟล์ (?:(\d+) ไฟล์|"[\s\S]*?") ในงาน ("[\s\S]*")$/;
/** คอมเมนต์รูป/ไฟล์อย่างเดียว — task-store.ts addComment: `X แสดงความคิดเห็นในงาน "T": ส่งรูป 3 รูป` / `: แนบไฟล์` */
const COMMENT_FILES_RE = /^(.+?) แสดงความคิดเห็นในงาน ("[\s\S]*"): (ส่งรูป|แนบไฟล์)(?: (\d+) (?:รูป|ไฟล์))?$/;

interface Parsed {
  count: number;
  /** ข้อความใหม่เมื่อรวมได้ทั้งหมด `total` ชิ้น (`photosOnly` = ทุกชิ้นที่รวมเป็นรูป) */
  format: (total: number, photosOnly: boolean) => string;
  photosOnly: boolean;
}

/** อ่านข้อความแจ้งเตือนที่รวมได้ — อ่านรูปแบบไม่ออก = null (ไม่รวม) */
function parse(n: GroupableNotification): Parsed | null {
  if (typeof n.message !== "string" || typeof n.taskId !== "string") return null;
  if (n.kind === "task_attachment") {
    const m = ATTACH_RE.exec(n.message);
    if (!m) return null;
    return { count: m[2] ? Number(m[2]) : 1, photosOnly: false, format: (total) => `${m[1]} แนบไฟล์ ${total} ไฟล์ ในงาน ${m[3]}` };
  }
  if (n.kind === "task_comment") {
    const m = COMMENT_FILES_RE.exec(n.message);
    if (!m) return null;
    return {
      count: m[4] ? Number(m[4]) : 1,
      photosOnly: m[3] === "ส่งรูป",
      format: (total, photosOnly) => `${m[1]} แสดงความคิดเห็นในงาน ${m[2]}: ${photosOnly ? `ส่งรูป ${total} รูป` : `แนบไฟล์ ${total} ไฟล์`}`,
    };
  }
  return null;
}

const isAttachment = (n: GroupableNotification) => parse(n) !== null;

/** id ทั้งหมดที่ถูกรวมเข้าแถวอื่นไปแล้ว — เครื่องไหนส่ง id พวกนี้มาอีก ให้ทิ้ง */
export function absorbedIdSet(rows: GroupableNotification[]): Set<string> {
  const out = new Set<string>();
  for (const n of rows) {
    if (Array.isArray(n?.absorbedIds)) for (const id of n.absorbedIds) if (typeof id === "string") out.add(id);
  }
  return out;
}

/**
 * แถวใหม่ (ของคนอื่นที่เครื่องนี้เพิ่งสร้าง) + แถวที่เก็บอยู่ ⇒ แถวใหม่หลังรวม และแถวเก็บที่เหลือ (ตัดแถวที่ถูกรวมออก)
 * ไม่มีอะไรให้รวม = คืนเดิมทุกอย่าง
 */
export function groupAttachmentNotifications<T extends GroupableNotification>(
  incoming: T[],
  stored: T[],
  now: number = Date.now()
): { incoming: T[]; stored: T[] } {
  if (!incoming.some(isAttachment)) return { incoming, stored };
  const removed = new Set<unknown>();
  // แถวที่รวมได้ล่าสุดของแต่ละ ผู้รับ|คนแนบ|งาน (แถวใหม่ในรอบเดียวกันก็รวมกันเองได้)
  const latest = new Map<string, T>();
  const keyOf = (n: T) => `${String(n.kind)}|${String(n.userId)}|${String(n.byUserId)}|${String(n.taskId)}`;
  const canAbsorb = (p: T) => {
    if (!isAttachment(p) || p.read === true || removed.has(p.id)) return false;
    const t = Date.parse(String(p.createdAt ?? ""));
    return Number.isFinite(t) && now - t <= GROUP_WINDOW_MS && parse(p) !== null;
  };
  for (const p of stored) {
    if (!canAbsorb(p)) continue;
    const k = keyOf(p);
    const cur = latest.get(k);
    if (!cur || String(p.createdAt) > String(cur.createdAt)) latest.set(k, p);
  }

  const out: T[] = [];
  for (const n of incoming) {
    const mine = parse(n);
    const prev = mine ? latest.get(keyOf(n)) : undefined;
    const before = prev ? parse(prev) : null;
    if (!mine || !prev || !before || !canAbsorb(prev)) {
      out.push(n);
      if (mine) latest.set(keyOf(n), n);
      continue;
    }
    const total = before.count + mine.count;
    const prevAbsorbed = Array.isArray(prev.absorbedIds) ? (prev.absorbedIds as unknown[]) : [];
    const merged = {
      ...n,
      message: mine.format(total, mine.photosOnly && before.photosOnly),
      grouped: true,
      absorbedIds: [...prevAbsorbed, prev.id],
    } as T;
    removed.add(prev.id);
    const at = out.indexOf(prev);
    if (at >= 0) out.splice(at, 1);
    out.push(merged);
    latest.set(keyOf(n), merged);
  }
  return { incoming: out, stored: stored.filter((p) => !removed.has(p.id)) };
}
