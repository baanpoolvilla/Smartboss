import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { users as allUsers, isOwner } from "@/modules/report_task/lib/directory";
import { localDateStr } from "@/modules/report_task/lib/now";
import type {
  ReportTopic,
  SubmissionRound,
  SubmitterGroup,
  ReportTopicVisibility,
} from "@/modules/report_task/store/report-feed-store";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";

/**
 * "รอบส่ง" (submission rounds) — ตัวตัดสินแหล่งเดียวว่า *ใครต้องส่งห้องไหน เมื่อไหร่*
 *
 * แยกออกจาก `visibility` (ใครเห็นห้อง) อย่างชัดเจน: เห็นห้อง ≠ ต้องส่ง
 *
 * ของเก่าที่ไม่มี `submissionRounds` จะถูก "แปลงร่าง" (effectiveRoundsOf) เป็นรอบเดียว
 * ต่อ 1 cutoff โดยผู้ส่ง = ทุกคนที่เห็นห้อง ลบคนที่เคยติ๊กยกเว้น (exemptUserIds) และวัน =
 * requiredWeekdays เดิม — ผลลัพธ์จึงเท่าตรรกะเดิม (mustReportToTopic + requiredWeekdays)
 * เป๊ะ ทำให้โค้ดจุดเดียวรองรับทั้งห้องเก่าและห้องใหม่โดยของเก่าไม่เปลี่ยนพฤติกรรม
 */

/**
 * รอบนี้ "มีผล" ในวันนั้นไหม — เช็คทั้งวันในสัปดาห์ (undefined/ว่าง = ทุกวัน) และวันที่
 * รอบถูกสร้าง (`createdAt`, undefined = ไม่กัน เดินพฤติกรรมเดิม — ห้องเก่า/รอบที่มา
 * จาก effectiveRoundsOf ไม่มีฟิลด์นี้). วันก่อนรอบถูกสร้างไม่มีทางนับเป็น "ต้องส่ง"
 * ได้ — วันนั้นไม่มีใครรู้ด้วยซ้ำว่ามีข้อกำหนดนี้อยู่ ไม่งั้นพอเพิ่มรอบใหม่จะโดนตัดสิน
 * "พลาดส่ง" ย้อนหลังไปถึงวันที่ห้องถูกสร้างทันที (บั๊กที่เจอจากการทดสอบจริง).
 */
export function roundRunsOnDay(
  round: Pick<SubmissionRound, "weekdays" | "createdAt" | "dayOfMonth">,
  day: string
): boolean {
  if (round.createdAt && day < localDateStr(new Date(round.createdAt))) return false;
  if (round.dayOfMonth) {
    const d = new Date(`${day}T00:00:00`);
    // เดือนที่ไม่มีวันที่ตั้งไว้ (30 ในเดือน ก.พ.) ตกไปวันสุดท้ายของเดือนนั้น
    // แทนเสมอ — `new Date(y, m+1, 0)` คือ "วันที่ 0 ของเดือนถัดไป" = วันสุดท้าย
    // ของเดือนนี้พอดี, วิธีมาตรฐานของ JS ในการหาจำนวนวันของเดือน
    const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === Math.min(round.dayOfMonth, lastDayOfMonth);
  }
  if (!round.weekdays || round.weekdays.length === 0) return true;
  return round.weekdays.includes(new Date(`${day}T00:00:00`).getDay());
}

/** คืน userId ที่ต้องส่ง "รอบนี้" (ยังไม่คิดวัน/วันลา — คิดชั้นบน) */
export function resolveRoundSubmitters(
  round: Pick<SubmissionRound, "submitters">,
  visibility: ReportTopicVisibility | undefined,
  groups: SubmitterGroup[]
): string[] {
  const canSee = (id: string) => canSeeReportTopic(visibility, id);
  const r = round.submitters;
  let base: string[] = [];
  switch (r.mode) {
    case "everyone":
      base = allUsers.filter((u) => canSee(u.id)).map((u) => u.id);
      break;
    case "groups": {
      const wanted = new Set(r.groupIds ?? []);
      const ids = new Set<string>();
      for (const g of groups) {
        if (!wanted.has(g.id)) continue;
        for (const uid of g.userIds) ids.add(uid);
      }
      base = [...ids];
      break;
    }
    case "departments": {
      const wanted = new Set(r.departmentIds ?? []);
      base = allUsers.filter((u) => !!u.departmentId && wanted.has(u.departmentId)).map((u) => u.id);
      break;
    }
    case "people":
      base = [...(r.userIds ?? [])];
      break;
  }
  const set = new Set(base);
  for (const id of r.addUserIds ?? []) set.add(id);
  for (const id of r.removeUserIds ?? []) set.delete(id);
  // ผู้ส่งต้องเห็นห้องได้จริง และไม่ใช่เจ้าของบริษัท (เจ้าของเห็นทุกห้องแต่ไม่ใช่สมาชิกที่ต้องส่ง)
  return [...set].filter((id) => !isOwner(id) && canSee(id));
}

/**
 * รอบส่งที่ "มีผล" ของห้อง — ถ้ามี submissionRounds ใช้ตามนั้น; ถ้าไม่มี (ห้องเก่า)
 * แปลงจาก cutoffs + requiredWeekdays + exemptUserIds ให้เท่าพฤติกรรมเดิม
 */
export function effectiveRoundsOf(
  topic: Pick<ReportTopic, "submissionRounds" | "cutoffs" | "requiredWeekdays" | "visibility">
): SubmissionRound[] {
  if (topic.submissionRounds && topic.submissionRounds.length > 0) return topic.submissionRounds;
  if (!topic.cutoffs || topic.cutoffs.length === 0) return [];
  const removeUserIds = topic.visibility?.exemptUserIds ?? [];
  return topic.cutoffs.map((c) => ({
    id: c.id,
    label: c.label,
    time: c.time,
    minImages: c.minImages,
    weekdays: topic.requiredWeekdays,
    submitters: { mode: "everyone", removeUserIds } as SubmissionRound["submitters"],
  }));
}

/**
 * แปลง cutoffs + requiredWeekdays + exemptUserIds เป็น submissionRounds จริง
 * (ไม่ใช่แค่สังเคราะห์ชั่วคราวแบบ `effectiveRoundsOf`) — ใช้ตอน auto-migrate
 * ห้องเก่าตอน hydrate (`normalizeReportFeedSlice`) และปุ่ม "แปลงรอบตัดยอดเดิม"
 * (safety fallback) ใน `report-topic-settings-dialog.tsx` เพื่อไม่ให้ตรรกะ
 * แตกกันระหว่าง 2 จุด
 *
 * ตั้งใจไม่ใส่ `createdAt` (ดูคอมเมนต์ `roundRunsOnDay`) — รอบที่ migrate มา
 * จากข้อมูลเก่าไม่ควรถูกตัดสิน "พลาดส่ง" ย้อนหลังไปถึงวันก่อน migration.
 * ใส่ `?? topic.minImages` ที่ minImages ของแต่ละรอบ (effectiveRoundsOf เอง
 * ไม่ทำแบบนี้) เพื่อคงพฤติกรรมเดิมของห้องที่เคยพึ่ง "ค่าเริ่มต้นระดับห้อง" ไว้ —
 * หลัง migrate ค่าเริ่มต้นระดับห้องจะเลิกใช้แล้ว (ขั้นที่ 3), รอบต้องพกค่าติดตัวเอง.
 */
export function legacyRoundsFromCutoffs(
  topic: Pick<ReportTopic, "cutoffs" | "requiredWeekdays" | "minImages" | "visibility">
): SubmissionRound[] {
  const removeUserIds = topic.visibility?.exemptUserIds ?? [];
  return topic.cutoffs.map((c) => ({
    id: c.id,
    label: c.label,
    time: c.time,
    minImages: c.minImages ?? topic.minImages,
    weekdays: topic.requiredWeekdays,
    submitters: { mode: "everyone", removeUserIds } as SubmissionRound["submitters"],
  }));
}

/** ใช้ path รอบส่งใหม่ไหม (ห้องที่ตั้ง submissionRounds เอง) — ห้องเก่าตอบ false */
export function usesSubmissionRounds(topic: Pick<ReportTopic, "submissionRounds">): boolean {
  return !!topic.submissionRounds && topic.submissionRounds.length > 0;
}

export type RoundFrequency = "daily" | "weekly" | "monthly";

/** จัดประเภทความถี่ของรอบจากฟิลด์ที่มีอยู่ — `dayOfMonth` = รายเดือน,
 * `weekdays` ไม่ว่าง = รายสัปดาห์, ไม่มีทั้งคู่ = รายวัน (ค่าเริ่มต้น วิ่งทุกวัน) */
export function roundFrequencyOf(round: Pick<SubmissionRound, "weekdays" | "dayOfMonth">): RoundFrequency {
  if (round.dayOfMonth) return "monthly";
  if (round.weekdays && round.weekdays.length > 0) return "weekly";
  return "daily";
}

/**
 * รอบรายสัปดาห์/รายเดือน "ไม่ยกเว้น" ให้วันหยุดบริษัทหรือวันลาส่วนตัวที่ตรงกับ
 * วันครบกำหนดพอดี — ต่างจากรอบรายวัน ที่ความหมายคือ "วันนี้บริษัทเปิดไหม คน
 * มาไหม" (หยุดจริงก็ไม่มีอะไรให้ส่ง) รอบรายสัปดาห์/รายเดือนคือรายงานสรุปของ
 * "ช่วงเวลา" ที่ต้องส่งภายในกำหนดเสมอไม่ว่าวันนั้นจะเป็นวันหยุดหรือวันลาของ
 * คนที่ต้องส่งหรือไม่ (product decision — ดู docs/spec-report-submission-rounds.md
 * และการยืนยันจากเจ้าของระบบ: "ให้ส่งวันเดิมไม่ว่าคนนั้นจะหยุดแบบไหนก็ตาม")
 */
export function roundIgnoresDateExemptions(round: Pick<SubmissionRound, "weekdays" | "dayOfMonth">): boolean {
  return roundFrequencyOf(round) !== "daily";
}

/**
 * "ส่งล่วงหน้า" — รอบรายสัปดาห์/รายเดือนส่งก่อนวันครบกำหนดได้กี่วัน (ตั้งค่า → ห้อง Report)
 * โพสต์ในช่วงนี้ต้องเลือกรอบไว้ตอนโพสต์ (roundId) เท่านั้น ไม่เดาจากเวลา และนับเป็น "ตรงเวลา" ของ
 * วันครบกำหนดถัดไป — รอบรายวันไม่มีผล (0 เสมอ)
 */
export interface EarlySubmitDays {
  weekly: number;
  monthly: number;
}

export const DEFAULT_EARLY_SUBMIT_DAYS: EarlySubmitDays = { weekly: 1, monthly: 5 };

/** ค่าที่อ่านมาจาก store (อาจยังไม่เคยตั้ง/รูปแบบเก่า) → ค่าที่ใช้ได้ · รายสัปดาห์สูงสุด 6 วัน (ไม่ทับรอบก่อน) */
export function normalizeEarlySubmitDays(raw: unknown): EarlySubmitDays {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<EarlySubmitDays>;
  const pick = (v: unknown, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v)) : fallback;
  return {
    weekly: pick(r.weekly, 6, DEFAULT_EARLY_SUBMIT_DAYS.weekly),
    monthly: pick(r.monthly, 20, DEFAULT_EARLY_SUBMIT_DAYS.monthly),
  };
}

function addDaysStr(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

/** ส่งล่วงหน้าได้กี่วันสำหรับรอบนี้ — รายวัน = 0 */
export function earlyDaysOf(round: Pick<SubmissionRound, "weekdays" | "dayOfMonth">, cfg: EarlySubmitDays): number {
  const f = roundFrequencyOf(round);
  return f === "weekly" ? cfg.weekly : f === "monthly" ? cfg.monthly : 0;
}

/**
 * วันครบกำหนดที่วัน `day` "ส่งล่วงหน้า" ให้ได้ — null เมื่อ `day` เป็นวันครบกำหนดของรอบนี้เอง
 * (ส่งวันนั้นตามปกติ) หรือยังไกลเกินช่วงส่งล่วงหน้า
 */
export function earlyDueDayOf(
  round: Pick<SubmissionRound, "weekdays" | "createdAt" | "dayOfMonth">,
  day: string,
  cfg: EarlySubmitDays
): string | null {
  const n = earlyDaysOf(round, cfg);
  if (n <= 0 || roundRunsOnDay(round, day)) return null;
  for (let i = 1; i <= n; i++) {
    const d = addDaysStr(day, i);
    if (roundRunsOnDay(round, d)) return d;
  }
  return null;
}

/** โพสต์ของ `userId` ที่ส่งล่วงหน้าให้รอบ `round` ของวันครบกำหนด `dueDay` (เลือกรอบไว้ตอนโพสต์เท่านั้น) */
export function earlyPostsForRound<
  P extends { topicId: string; authorId: string; createdAt: string; roundId?: string; excludeFromSubmission?: boolean },
>(
  posts: readonly P[],
  topicId: string,
  userId: string,
  round: Pick<SubmissionRound, "id" | "weekdays" | "createdAt" | "dayOfMonth">,
  dueDay: string,
  cfg: EarlySubmitDays
): P[] {
  const n = earlyDaysOf(round, cfg);
  if (n <= 0) return [];
  const from = addDaysStr(dueDay, -n);
  return posts.filter((p) => {
    if (p.topicId !== topicId || p.authorId !== userId || p.excludeFromSubmission || p.roundId !== round.id) return false;
    const d = localDateStr(new Date(p.createdAt));
    return d >= from && d < dueDay && earlyDueDayOf(round, d, cfg) === dueDay;
  });
}

/** รอบรายสัปดาห์/รายเดือนที่ user คนนี้ "ส่งล่วงหน้า" ได้ในวัน `day` (ยังไม่ถึงวันครบกำหนด) พร้อมวันครบกำหนด */
export function earlyRoundsForUserOnDay(
  topic: Pick<ReportTopic, "submissionRounds" | "cutoffs" | "requiredWeekdays" | "visibility">,
  userId: string,
  day: string,
  groups: SubmitterGroup[],
  cfg: EarlySubmitDays
): { round: SubmissionRound; dueDay: string }[] {
  const out: { round: SubmissionRound; dueDay: string }[] = [];
  for (const round of effectiveRoundsOf(topic)) {
    const dueDay = earlyDueDayOf(round, day, cfg);
    if (!dueDay) continue;
    if (!resolveRoundSubmitters(round, topic.visibility, groups).includes(userId)) continue;
    out.push({ round, dueDay });
  }
  return out;
}

/** รอบที่ user "คนนี้" ต้องส่งในวันนั้น (คิดวันในสัปดาห์ + เป็นผู้ส่งของรอบ) */
export function roundsForUserOnDay(
  topic: Pick<ReportTopic, "submissionRounds" | "cutoffs" | "requiredWeekdays" | "visibility">,
  userId: string,
  day: string,
  groups: SubmitterGroup[]
): SubmissionRound[] {
  return effectiveRoundsOf(topic).filter(
    (r) => roundRunsOnDay(r, day) && resolveRoundSubmitters(r, topic.visibility, groups).includes(userId)
  );
}

/** user ต้องส่งห้องนี้ไหม (โดยรวม ไม่คิดวัน) — pure, รับ groups เข้ามา */
export function mustSubmitToTopicPure(
  topic: Pick<ReportTopic, "submissionRounds" | "cutoffs" | "requiredWeekdays" | "visibility">,
  userId: string,
  groups: SubmitterGroup[]
): boolean {
  return effectiveRoundsOf(topic).some((r) =>
    resolveRoundSubmitters(r, topic.visibility, groups).includes(userId)
  );
}

/** เวอร์ชันสะดวก — อ่าน groups จาก store ให้เอง (ใช้ในโค้ดฝั่ง client ทั่วไป) */
export function mustSubmitToTopic(
  topic: Pick<ReportTopic, "submissionRounds" | "cutoffs" | "requiredWeekdays" | "visibility">,
  userId: string
): boolean {
  return mustSubmitToTopicPure(topic, userId, useReportFeedStore.getState().submitterGroups);
}

/** นาทีในวันของ "HH:mm" — ตัวช่วยภายในไฟล์นี้ */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/**
 * จับโพสต์เข้า "รอบ" — ใช้ `post.roundId` ก่อนเสมอถ้ามี (คนเลือกเองตอนโพสต์ ไม่ต้อง
 * เดา — ดู C4/report-composer.tsx); ถ้าไม่มี (โพสต์เก่าก่อนมีฟิลด์นี้ หรือห้องมีรอบ
 * เดียวเลยไม่มี picker ให้เลือก) เดาจากเวลา: แบ่งวันด้วยเดดไลน์ของแต่ละรอบ
 * (เรียงเวลา) โพสต์เข้ารอบแรกที่ deadline ≥ เวลาโพสต์; ถ้าเลยทุกเดดไลน์แล้ว → รอบ
 * สุดท้าย (สาย) — ยังไงก็ต้องมีรอบให้ตัดสินว่า "สาย" ของรอบไหน ไม่ใช่ลอยไม่มีรอบเลย.
 *
 * `dayPosts` = โพสต์ทั้งวันของคนเดียวกันในห้องเดียวกัน (รวมตัวเอง ไม่รวมที่ "ไม่นับ") —
 * ใส่มาเมื่อไหร่ โพสต์ที่ไม่มี roundId จะ "ตามรอบที่ค้าง" ก่อน: ถ้ามีรอบที่เลยเวลาแล้วแต่ยังไม่มี
 * โพสต์ไหนของวันนั้น (ก่อนหน้าโพสต์นี้) นับให้ ⇒ เข้ารอบที่เก่าสุดนั้น (สาย) ไม่งั้นค่อยเดาจากเวลา
 * ทำไม: เดาจากเวลาอย่างเดียว โพสต์เช้า 9:28 (เลยรอบเช้า 09:00) ไปเข้ารอบเย็น ⇒ รอบเช้า "ไม่ส่ง"
 * และโพสต์เย็นจริงกลายเป็นซ้ำ ไม่ขึ้นป้าย (เจอจริง 13/10/2569: วันนั้นเคยถือเป็นวันหยุด
 * กล่องโพสต์เลยไม่ให้เลือกรอบ ทุกโพสต์ไม่มี roundId)
 */
export function attributePostToRound(
  post: { id?: string; createdAt: string; roundId?: string },
  rounds: SubmissionRound[],
  dayPosts?: readonly { id: string; createdAt: string; roundId?: string }[]
): SubmissionRound | null {
  if (rounds.length === 0) return null;
  if (post.roundId) {
    const byId = rounds.find((r) => r.id === post.roundId);
    if (byId) return byId;
  }
  if (dayPosts && post.id) {
    const caught = catchUpRound(post as { id: string; createdAt: string }, rounds, dayPosts);
    if (caught) return caught;
  }
  return attributeByTime(post, rounds);
}

/**
 * รอบที่ใช้จับคู่โพสต์ของคนหนึ่ง = เฉพาะรอบที่ "คนนั้น" ต้องส่งในวันนั้น ไม่ใช่ทุกรอบของห้อง
 * ทำไม: ห้องรวมหลายแผนกมีรอบของแต่ละแผนกปนกัน เดาจากทุกรอบ โพสต์ไปตกรอบของแผนกอื่น
 * (โดยเฉพาะรอบที่ "ค้าง" ซึ่งไม่ใช่ของเขา) ⇒ รอบของตัวเองกลายเป็น "ไม่ส่ง" ทั้งที่ป้ายบนโพสต์
 * บอกตรงเวลา (เจอจริง 13/10/2569) · ไม่มีรอบของตัวเองเลย ใช้ทุกรอบแทน (ผลไม่ถูกนับอยู่แล้ว)
 */
export function attributionRounds(userRounds: SubmissionRound[], allRounds: SubmissionRound[]): SubmissionRound[] {
  return userRounds.length > 0 ? userRounds : allRounds;
}

/** โพสต์ของวันหนึ่ง (คนเดียว ห้องเดียว) ที่นับเข้ารอบ `roundId` — ใช้ attributePostToRound แบบดูทั้งวัน */
export function postsOfRound<P extends { id: string; createdAt: string; roundId?: string }>(
  dayPosts: readonly P[],
  rounds: SubmissionRound[],
  roundId: string
): P[] {
  return dayPosts.filter((p) => attributePostToRound(p, rounds, dayPosts)?.id === roundId);
}

/** โพสต์ที่ไม่มี roundId → รอบที่เลยเวลาแล้วแต่ยังค้างอยู่ ณ ตอนโพสต์ (เก่าสุดก่อน) หรือ null ถ้าไม่มีค้าง */
function catchUpRound(
  post: { id: string; createdAt: string },
  rounds: SubmissionRound[],
  dayPosts: readonly { id: string; createdAt: string; roundId?: string }[]
): SubmissionRound | null {
  const day = localDateStr(new Date(post.createdAt));
  const running = rounds.filter((r) => roundRunsOnDay(r, day));
  const sorted = [...(running.length > 0 ? running : rounds)].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  const minutesOf = (iso: string) => {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  };
  // ไล่โพสต์ของวันตามลำดับเวลา จนถึงโพสต์นี้ — รอบที่ถูกนับไปแล้วไม่ค้าง
  const ordered = [...dayPosts]
    .filter((p) => localDateStr(new Date(p.createdAt)) === day)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  // เลือกรอบเองไว้ = รอบนั้นไม่ค้างทั้งวัน (ไม่ว่าจะโพสต์ก่อนหรือหลัง) — กันโพสต์อื่นแย่งรอบเดียวกัน
  const fulfilled = new Set(ordered.filter((p) => p.roundId).map((p) => p.roundId!));
  for (const p of ordered) {
    if (p.roundId && sorted.some((r) => r.id === p.roundId)) continue;
    const pMinutes = minutesOf(p.createdAt);
    const overdue = sorted.find((r) => !fulfilled.has(r.id) && timeToMinutes(r.time) < pMinutes);
    const round = overdue ?? attributeByTime(p, sorted);
    if (p.id === post.id) return overdue ?? null;
    if (round) fulfilled.add(round.id);
  }
  return null;
}

function attributeByTime(post: { createdAt: string }, rounds: SubmissionRound[]): SubmissionRound | null {
  if (rounds.length === 0) return null;
  // จำกัดผู้ท้าชิงเหลือแค่รอบที่ "วิ่ง" ในวันนี้จริง ๆ ก่อนเดา — เดิมไม่กรอง
  // เพราะทุกรอบของทุกห้องวิ่งทุกวันเหมือนกันหมด (ไม่เคยผสม Daily กับ
  // Weekly/Monthly คนละความถี่กันในห้องเดียว) พอห้องเริ่มมีรอบความถี่ต่างกัน
  // (Daily ทุกวัน + Weekly เฉพาะศุกร์ + Monthly เฉพาะวันที่ 30) โพสต์วันอังคาร
  // ธรรมดาจะเดาผิดไปเข้ารอบ Weekly/Monthly ได้ถ้าเวลาใกล้เคียงกัน ทั้งที่รอบ
  // นั้นไม่ได้วิ่งวันอังคารเลย — กรองก่อนตัดปัญหานี้ทิ้ง; เผื่อไม่มีรอบไหนวิ่งเลย
  // (ไม่ควรเกิดจริง) ใช้ทั้งก้อนเดิมกันไม่ให้คืน null ทั้งที่ห้องนี้มีรอบ
  const day = localDateStr(new Date(post.createdAt));
  const candidates = rounds.filter((r) => roundRunsOnDay(r, day));
  const pool = candidates.length > 0 ? candidates : rounds;
  const sorted = [...pool].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  const created = new Date(post.createdAt);
  const postMinutes = created.getHours() * 60 + created.getMinutes();
  return sorted.find((r) => timeToMinutes(r.time) >= postMinutes) ?? sorted[sorted.length - 1]!;
}

/** รายชื่อ "คนที่ต้องส่งจริง" ของห้อง (รวมทุกรอบ) — สำหรับกล่องสรุปในหน้าตั้งค่า */
export function resolvedSubmittersOfTopic(
  topic: Pick<ReportTopic, "submissionRounds" | "cutoffs" | "requiredWeekdays" | "visibility">,
  groups: SubmitterGroup[]
): string[] {
  const ids = new Set<string>();
  for (const r of effectiveRoundsOf(topic)) {
    for (const id of resolveRoundSubmitters(r, topic.visibility, groups)) ids.add(id);
  }
  return [...ids];
}
