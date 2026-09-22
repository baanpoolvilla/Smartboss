import "server-only";

import {
  effectiveRoundsOf,
  roundRunsOnDay,
  roundIgnoresDateExemptions,
  attributePostToRound,
} from "@/modules/report_task/lib/submission-rounds";
import { trackedTopicsOf, iterationBounds, eachDay, type ComplianceStatus } from "@/modules/report_task/lib/report-feed-compliance";
import { isExemptDate, type DateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";
import { localDateStr, now, todayIso } from "@/modules/report_task/lib/now";
import type { DirectoryUser } from "@/modules/report_task/lib/db/employee-directory";
import type {
  ReportPost,
  ReportTopic,
  ReportTopicVisibility,
  SubmissionRound,
  SubmitterGroup,
} from "@/modules/report_task/store/report-feed-store";

/**
 * เฟส 2 ของ docs/spec-report-submission-rounds.md — sweep ที่ทำให้ "พลาดส่ง /
 * ส่งรายงานสาย" หักคะแนน HR จริง (category `report_missed`/`report_late`)
 *
 * แยกไฟล์นี้ออกจาก report-feed-compliance.ts (ที่แดชบอร์ด/สถิติใช้แสดงผล)
 * เพราะฟังก์ชันตัวตัดสินที่นั่น (`roundComplianceStatus`, `mustSubmitToTopic`,
 * `resolveRoundSubmitters`) อ่าน `users`/`departments`/`isOwner`/group ปัจจุบัน
 * จาก **module-level ของฝั่ง client** (`lib/directory.ts`, zustand
 * `useReportFeedStore.getState()`) ซึ่งฝั่งเซิร์ฟเวอร์ไม่มีทาง hydrate ให้ตรง
 * ต่อบริษัทได้ (เห็นได้จาก reminder-sweep.ts ที่ทำแบบเดียวกันอยู่แล้วโดยไม่มี
 * ใครสังเกต — เป็นความเสี่ยงเดิมที่ไม่ควรเอามาต่อยอดกับงานที่ "หักคะแนนจริง"
 * แบบนี้) ไฟล์นี้จึงเขียนตัวตัดสินคู่ขนานที่ **รับ `DirectoryUser[]` จริงจาก
 * DB เข้ามาเป็นพารามิเตอร์เสมอ** (ตามแบบ ai-insight/aggregate.ts's
 * `mustReportToTopicServer`) แทนที่จะพึ่ง global ใด ๆ — ตัวตัดสินการแสดงผล
 * (แดชบอร์ด) กับตัวตัดสินการหักคะแนนจึงเป็นคนละฟังก์ชันเชิงโค้ด แต่คำนวณ
 * ตรรกะเดียวกันทุกจุด (รอบ/วัน/ผู้ส่ง/ข้อยกเว้นวันลา) — ผิดพลาดที่ไหนแก้ที่นั่น
 * แยกกันได้ ไม่ปนกับ path เดิมที่แดชบอร์ดพึ่งอยู่
 *
 * `managerOnly` ประมาณเป็น "ไม่มีใครเข้าเงื่อนไขนี้" เหมือนกับที่
 * `mustReportToTopicServer` ทำไว้แล้ว (ไม่มีข้อมูลหัวหน้าแผนกส่งมาให้ที่นี่) —
 * ยอมรับได้เพราะห้องที่ตั้ง managerOnly เป็นส่วนน้อยมาก และผลที่แย่ที่สุดคือ
 * "ไม่หักคะแนนคนที่ควรหัก" (ปลอดภัยกว่าฝั่ง "หักคนที่ไม่ควรโดน")
 */

function canSeeReportTopicServer(
  visibility: ReportTopicVisibility | undefined,
  user: DirectoryUser
): boolean {
  if (user.isOwner) return true;
  if (!visibility || (!visibility.managerOnly && !visibility.departmentIds?.length && !visibility.userIds?.length)) return true;
  if (visibility.userIds?.length) return visibility.userIds.includes(user.id);
  if (visibility.managerOnly) return false; // ประมาณ — ดูคอมเมนต์บนสุดของไฟล์
  if (visibility.departmentIds?.length) {
    const inDept = !!user.departmentId && visibility.departmentIds.includes(user.departmentId);
    const inExtra = visibility.extraUserIds?.includes(user.id) ?? false;
    if (!inDept && !inExtra) return false;
  }
  return true;
}

/** เวอร์ชันของ `resolveRoundSubmitters` (submission-rounds.ts) ที่รับ
 * `DirectoryUser[]` จริงแทนที่จะอ่าน `allUsers`/`isOwner` global — ดูคอมเมนต์บนสุด */
export function resolveRoundSubmittersServer(
  round: Pick<SubmissionRound, "submitters">,
  visibility: ReportTopicVisibility | undefined,
  groups: SubmitterGroup[],
  users: DirectoryUser[]
): string[] {
  const canSee = (u: DirectoryUser) => canSeeReportTopicServer(visibility, u);
  const r = round.submitters;
  let base: string[] = [];
  switch (r.mode) {
    case "everyone":
      base = users.filter(canSee).map((u) => u.id);
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
      base = users.filter((u) => !!u.departmentId && wanted.has(u.departmentId)).map((u) => u.id);
      break;
    }
    case "people":
      base = [...(r.userIds ?? [])];
      break;
  }
  const set = new Set(base);
  for (const id of r.addUserIds ?? []) set.add(id);
  for (const id of r.removeUserIds ?? []) set.delete(id);
  const byId = new Map(users.map((u) => [u.id, u] as const));
  return [...set].filter((id) => {
    const u = byId.get(id);
    if (!u || u.isOwner) return false;
    return canSee(u);
  });
}

function roundMinutes(round: SubmissionRound): number {
  const [h, m] = round.time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** เทียบเท่า `postsForRound` (report-feed-compliance.ts) — คัดลอกเองเพราะตัว
 * ต้นฉบับไม่ได้ export (private ของไฟล์นั้น) และไม่มีอะไรให้ใช้ร่วมได้จริง */
function postsForRoundServer(
  topic: ReportTopic,
  userId: string,
  round: SubmissionRound,
  day: string,
  posts: ReportPost[],
  rounds: SubmissionRound[]
): ReportPost[] {
  return posts.filter(
    (p) =>
      p.topicId === topic.id &&
      p.authorId === userId &&
      !p.excludeFromSubmission &&
      localDateStr(new Date(p.createdAt)) === day &&
      attributePostToRound(p, rounds)?.id === round.id
  );
}

/** เทียบเท่า `roundComplianceStatus` (report-feed-compliance.ts) — ตัดสินสถานะ
 * (คน, รอบ, วัน) หนึ่งชุด ด้วย `DirectoryUser[]`/`groups` ที่รับเข้ามาตรง ๆ
 * แทนที่จะอ่าน global (ดูคอมเมนต์บนสุดของไฟล์) */
export function roundComplianceStatusServer(
  topic: ReportTopic,
  userId: string,
  round: SubmissionRound,
  day: string,
  posts: ReportPost[],
  groups: SubmitterGroup[],
  users: DirectoryUser[],
  exemptions: DateExemptions
): ComplianceStatus {
  if (!roundRunsOnDay(round, day)) return "exempt";
  if (!roundIgnoresDateExemptions(round) && isExemptDate(exemptions, userId, day)) return "exempt";
  if (!resolveRoundSubmittersServer(round, topic.visibility, groups, users).includes(userId)) return "exempt";

  const rounds = effectiveRoundsOf(topic);
  const cutoff = roundMinutes(round);
  const roundPosts = postsForRoundServer(topic, userId, round, day, posts, rounds);
  if (roundPosts.length > 0) {
    const onTime = roundPosts.some((p) => minutesOfDay(p.createdAt) <= cutoff || p.lateBadgeHidden);
    return onTime ? "on-time" : "late";
  }
  const todayStr = todayIso();
  if (day < todayStr) return "missed";
  return minutesOfDay(now().toISOString()) > cutoff ? "missed" : "pending";
}

export interface ReportPenaltyCandidate {
  userId: string;
  topicId: string;
  roundId: string;
  /** "YYYY-MM-DD" ที่ต้องส่ง */
  day: string;
  /** มาตรฐานเดียวกับที่ spec วางไว้ — กันหักซ้ำที่ระดับ DB (ดู performance.ts) */
  refId: string;
  status: "missed" | "late";
}

/**
 * ไล่ทุกห้องที่ track อยู่ × ทุกรอบ × ทุกวันใน `lookbackDays` ที่ผ่านมา × ทุกคน
 * คืนเฉพาะ (คน, รอบ, วัน) ที่ "พลาด" หรือ "สาย" — ตัวเรียก (route.ts) เป็นคน
 * ตัดสินว่าจะเขียน event จริงไหม (เทียบกับที่เคยเขียนไปแล้ว, on/off ของบริษัท)
 *
 * จำกัดด้วย `lookbackDays` (ไม่ไล่ทั้งประวัติห้องทุกครั้ง) เหมือนแนวทางเดียวกับ
 * `dockAttendance`'s ATTENDANCE_LOOKBACK_DAYS — ห้อง/รอบ/วันที่เก่ากว่านั้นถือว่า
 * นิ่งแล้ว (ถ้าเคยพลาดไปนานแล้วไม่เคยหักเพราะฟีเจอร์นี้เพิ่งเปิด ก็ไม่ไล่ย้อน
 * หักคะแนนเก่าเป็นสิบ ๆ วันตอนเปิดใช้งานครั้งแรก)
 */
export function computeReportPenaltyCandidates(
  topics: ReportTopic[],
  posts: ReportPost[],
  users: DirectoryUser[],
  groups: SubmitterGroup[],
  exemptions: DateExemptions,
  lookbackDays: number
): ReportPenaltyCandidate[] {
  const tracked = trackedTopicsOf(topics);
  const out: ReportPenaltyCandidate[] = [];
  const todayStr = todayIso();
  const earliestStr = localDateStr(new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000));

  for (const topic of tracked) {
    const { startStr, endStr } = iterationBounds(topic, { from: new Date(`${earliestStr}T00:00:00`), to: new Date(`${todayStr}T00:00:00`) });
    const rounds = effectiveRoundsOf(topic);
    for (const day of eachDay(startStr, endStr)) {
      for (const round of rounds) {
        for (const u of users) {
          const status = roundComplianceStatusServer(topic, u.id, round, day, posts, groups, users, exemptions);
          if (status !== "missed" && status !== "late") continue;
          out.push({
            userId: u.id,
            topicId: topic.id,
            roundId: round.id,
            day,
            refId: `${day}:${topic.id}:${round.id}:${u.id}`,
            status,
          });
        }
      }
    }
  }
  return out;
}
