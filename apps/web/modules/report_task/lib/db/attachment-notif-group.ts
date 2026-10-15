/**
 * รวมแจ้งเตือน "แนบไฟล์ในงาน" ที่มาติด ๆ กัน (คนเดิมแนบทีละไฟล์ในงานเดิม) เป็นแถวเดียว
 * ("ก แนบไฟล์ 6 ไฟล์ ในงาน ...") แทนการเด้งทีละไฟล์ — ทำที่เซิร์ฟเวอร์ (writeOwnNotifications)
 * เพราะเครื่องคนแนบไม่มีแจ้งเตือนของคนอื่นอยู่ในมือ แก้แถวเดิมของผู้รับเองไม่ได้
 *
 * เฉพาะ kind "task_attachment" เท่านั้น แจ้งเตือนแบบอื่นไม่ผ่านตรงนี้ (ไม่เปลี่ยนอะไร)
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

/** จำนวนไฟล์ที่ข้อความนี้พูดถึง (ไฟล์เดียว = 1) — อ่านรูปแบบไม่ออก = null */
function fileCountOf(message: unknown): number | null {
  if (typeof message !== "string") return null;
  const m = ATTACH_RE.exec(message);
  if (!m) return null;
  return m[2] ? Number(m[2]) : 1;
}

const isAttachment = (n: GroupableNotification) => n.kind === "task_attachment" && typeof n.taskId === "string";

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
  const keyOf = (n: T) => `${String(n.userId)}|${String(n.byUserId)}|${String(n.taskId)}`;
  const canAbsorb = (p: T) => {
    if (!isAttachment(p) || p.read === true || removed.has(p.id)) return false;
    const t = Date.parse(String(p.createdAt ?? ""));
    return Number.isFinite(t) && now - t <= GROUP_WINDOW_MS && fileCountOf(p.message) !== null;
  };
  for (const p of stored) {
    if (!canAbsorb(p)) continue;
    const k = keyOf(p);
    const cur = latest.get(k);
    if (!cur || String(p.createdAt) > String(cur.createdAt)) latest.set(k, p);
  }

  const out: T[] = [];
  for (const n of incoming) {
    const count = isAttachment(n) ? fileCountOf(n.message) : null;
    const prev = count !== null ? latest.get(keyOf(n)) : undefined;
    if (count === null || !prev || !canAbsorb(prev)) {
      out.push(n);
      if (count !== null) latest.set(keyOf(n), n);
      continue;
    }
    const m = ATTACH_RE.exec(n.message as string)!;
    const total = (fileCountOf(prev.message) ?? 1) + count;
    const prevAbsorbed = Array.isArray(prev.absorbedIds) ? (prev.absorbedIds as unknown[]) : [];
    const merged = {
      ...n,
      message: `${m[1]} แนบไฟล์ ${total} ไฟล์ ในงาน ${m[3]}`,
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
