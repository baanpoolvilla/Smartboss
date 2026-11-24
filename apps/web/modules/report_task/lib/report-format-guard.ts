import { checkReportFormat, formatProblem } from "./report-format";

/**
 * ตรวจรูปแบบรายงานซ้ำที่เซิร์ฟเวอร์ (ผู้ใช้ 24/11/2569 "เช็คเลย") — เดิมเช็กแค่หน้าจอ (report-composer / report-card)
 * แอปรุ่นเก่าที่ยังเปิดค้าง หรือยิง API ตรง ส่งรีพอตที่ขาดหัวข้อได้
 *
 * กติกาเดียวกับหน้าจอทุกอย่าง และตรวจเฉพาะโพสต์ที่ "เนื้อหาเปลี่ยน" ในการบันทึกครั้งนี้ (โพสต์ใหม่ หรือแก้ชื่อ/เนื้อหา)
 *  - โพสต์ใหม่: รอบที่เลือก (roundId) หรือรอบที่ส่งย้อนหลัง (retroFor.roundId) ตั้งหัวข้อไว้ → ต้องผ่าน
 *    โพสต์ที่ติ๊ก "ไม่ใช่รีพอตของวันนี้" (ไม่ใช่ย้อนหลัง) ไม่ตรวจ — เหมือนหน้าจอ
 *  - แก้โพสต์: ตรวจตามรอบของโพสต์ (roundId, ไม่ใช่ย้อนหลัง) เมื่อโพสต์นับเป็นรีพอต (เดิมและตอนนี้ไม่ได้ติ๊ก "ไม่ใช่รีพอต")
 *  - โพสต์ที่ไม่ได้แก้เนื้อหา (ติดสติกเกอร์/ปักหมุด/อ่านแล้ว ฯลฯ) และโพสต์เก่าก่อนตั้งหัวข้อ ไม่ถูกตรวจย้อนหลัง
 *  - รอบที่ไม่ได้ตั้งหัวข้อ = ไม่ตรวจ (พฤติกรรมเดิม)
 *
 * รอบอ่านจาก submissionRounds ของห้องในก้อนที่ส่งมา (ห้องเก่าที่ยังเป็น cutoffs ไม่มีหัวข้ออยู่แล้ว)
 */

interface GuardRound {
  id?: unknown;
  requiredTopics?: unknown;
  requireStatusColor?: unknown;
}
interface GuardTopic {
  id?: unknown;
  submissionRounds?: unknown;
}
interface GuardPost {
  id?: unknown;
  topicId?: unknown;
  title?: unknown;
  sections?: unknown;
  roundId?: unknown;
  excludeFromSubmission?: unknown;
  retroFor?: unknown;
}
export interface FeedLike {
  posts?: unknown;
  topics?: unknown;
}

export interface FormatViolation {
  postId: string;
  title: string;
  problem: string;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** ข้อความที่ใช้ตรวจ — ประกอบแบบเดียวกับหน้าจอ: ชื่อโพสต์ + หัวข้อ/บรรทัดของแต่ละส่วน */
function postText(p: GuardPost): string {
  const sections = asArray<{ heading?: unknown; bullets?: unknown; bulletsText?: unknown }>(p.sections);
  const lines: string[] = [typeof p.title === "string" ? p.title : ""];
  for (const s of sections) {
    lines.push(typeof s.heading === "string" ? s.heading : "");
    if (typeof s.bulletsText === "string") lines.push(s.bulletsText);
    else lines.push(...asArray<unknown>(s.bullets).map((b) => (typeof b === "string" ? b : "")));
  }
  return lines.join("\n");
}

function contentKey(p: GuardPost): string {
  return JSON.stringify([p.title ?? "", p.sections ?? []]);
}

export function findReportFormatViolations(before: FeedLike | null | undefined, after: FeedLike | null | undefined): FormatViolation[] {
  const roundsByTopic = new Map<string, Map<string, GuardRound>>();
  for (const t of asArray<GuardTopic>(after?.topics)) {
    if (typeof t?.id !== "string") continue;
    const m = new Map<string, GuardRound>();
    for (const r of asArray<GuardRound>(t.submissionRounds)) if (typeof r?.id === "string") m.set(r.id, r);
    roundsByTopic.set(t.id, m);
  }
  const prevById = new Map<string, GuardPost>();
  for (const p of asArray<GuardPost>(before?.posts)) if (typeof p?.id === "string") prevById.set(p.id, p);

  const out: FormatViolation[] = [];
  for (const p of asArray<GuardPost>(after?.posts)) {
    if (typeof p?.id !== "string" || typeof p.topicId !== "string") continue;
    const prev = prevById.get(p.id);
    if (prev && contentKey(prev) === contentKey(p)) continue; // เนื้อหาไม่เปลี่ยน

    const retroRoundId =
      p.retroFor && typeof p.retroFor === "object" && typeof (p.retroFor as { roundId?: unknown }).roundId === "string"
        ? ((p.retroFor as { roundId: string }).roundId)
        : null;
    let roundId: string | null = null;
    if (!prev) {
      if (retroRoundId) roundId = retroRoundId;
      else if (p.excludeFromSubmission !== true && typeof p.roundId === "string") roundId = p.roundId;
    } else if (!p.retroFor && typeof p.roundId === "string" && prev.excludeFromSubmission !== true && p.excludeFromSubmission !== true) {
      roundId = p.roundId;
    }
    if (!roundId) continue;
    const round = roundsByTopic.get(p.topicId)?.get(roundId);
    const topics = asArray<unknown>(round?.requiredTopics).filter((x): x is string => typeof x === "string");
    if (topics.length === 0) continue;
    const check = checkReportFormat(postText(p), topics, round?.requireStatusColor !== false);
    if (check.ok) continue;
    out.push({
      postId: p.id,
      title: typeof p.title === "string" ? p.title : "",
      problem: formatProblem(check) ?? "รายงานยังไม่ครบตามรูปแบบของรอบนี้",
    });
  }
  return out;
}
