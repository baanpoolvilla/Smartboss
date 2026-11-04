import "server-only";

import { effectiveHardCutoffTime } from "@/modules/report_task/lib/report-cutoff";
import { attributionRounds, effectiveRoundsOf, postsOfRound, roundFrequencyOf, roundRunsOnDay } from "@/modules/report_task/lib/submission-rounds";
import { resolveRoundSubmittersServer } from "@/modules/report_task/lib/report-penalty-sweep";
import { localDateStr } from "@/modules/report_task/lib/now";
import type { DirectoryUser } from "@/modules/report_task/lib/db/employee-directory";
import type { ReportPost, ReportTopic, SubmitterGroup } from "@/modules/report_task/store/report-feed-store";
import type { ReportSubmissionLockSettings } from "@/modules/report_task/store/reminder-settings-store";

/**
 * หลักฐานของคำร้องขอแก้คะแนนรีพอต — ห้องไหน รอบไหน กำหนดกี่โมง โพสต์จริงกี่โมง
 * ระบบดึงจากโพสต์ในห้องเอง เจ้าตัวแก้ไม่ได้ ใช้ทั้งหน้ายื่นคำร้องและคิวของ CEO
 * (ผู้ใช้ 4/11/2569 "ให้เช็คเวลาถูกไหม")
 */

const fmtDayMonth = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" });
const fmtTime = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false });

export function dayMonthText(at: Date): string {
  return fmtDayMonth.format(at);
}

/** "2026-11-03" → "3 พ.ย." */
export function reportDayText(day: string): string {
  return dayMonthText(new Date(`${day}T12:00:00+07:00`));
}

/** รายชื่อสำหรับดูว่าใครต้องส่งรอบไหน — ห้องที่มีหลายรอบคนละกลุ่มต้องใช้ ให้จับโพสต์เข้ารอบตรงกับตัวหักคะแนน */
export interface RoundPeople {
  users: DirectoryUser[];
  groups: SubmitterGroup[];
}

/**
 * โพสต์ของคนนี้ที่นับเข้ารอบนี้ — ไม่มีในวันครบกำหนด และเป็นรอบรายสัปดาห์/รายเดือน ใช้โพสต์แรกหลังวันนั้น
 * (ช่วงเผื่อเวลาส่ง) · รอบรายวันไม่ข้ามวัน: โพสต์วันถัดไปเป็นของรอบวันนั้น
 */
export function roundPostsOf(topic: ReportTopic, posts: ReportPost[], userId: string, day: string, roundId: string, people?: RoundPeople): ReportPost[] {
  const mine = posts.filter((p) => p.topicId === topic.id && p.authorId === userId && !p.excludeFromSubmission);
  const dayPosts = mine.filter((p) => localDateStr(new Date(p.createdAt)) === day);
  const allRounds = effectiveRoundsOf(topic);
  const dayRounds = allRounds.filter((r) => roundRunsOnDay(r, day));
  const rounds = people
    ? attributionRounds(
        dayRounds.filter((r) => resolveRoundSubmittersServer(r, topic.visibility, people.groups, people.users).includes(userId)),
        allRounds
      )
    : dayRounds;
  const targets = rounds.length > 1 ? postsOfRound(dayPosts, rounds, roundId) : dayPosts;
  if (targets.length > 0) return targets;
  const round = allRounds.find((r) => r.id === roundId);
  if (round && roundFrequencyOf(round) === "daily") return [];
  return mine
    .filter((p) => localDateStr(new Date(p.createdAt)) > day)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, 1);
}

/** ช้ากี่นาที → "1 ชม. 22 นาที" / "2 วัน 3 ชม." */
export function lateDurationText(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days} วัน ${hours} ชม.` : `${days} วัน`;
  if (hours > 0) return minutes > 0 ? `${hours} ชม. ${minutes} นาที` : `${hours} ชม.`;
  return `${minutes} นาที`;
}

export interface PenaltyEvidence {
  roomName: string;
  roundLabel: string | null;
  /** "3 พ.ย. 09:00 น." · ไม่รู้เวลารอบ (รอบถูกลบแล้ว) = null */
  dueText: string | null;
  /** เวลาปิดรับของห้อง "23:59" · ไม่ได้ตั้งไว้ = null */
  closeTime: string | null;
  /** โพสต์ที่นับเข้ารอบนี้ — ไม่มี = null */
  post: { href: string; text: string; lateText: string | null } | null;
}

export function penaltyEvidence(
  topics: ReportTopic[],
  posts: ReportPost[],
  input: { userId: string; topicId: string; roundId: string; day: string },
  lock?: ReportSubmissionLockSettings,
  people?: RoundPeople
): PenaltyEvidence | null {
  const topic = topics.find((t) => t.id === input.topicId);
  if (!topic) return null;
  const round = effectiveRoundsOf(topic).find((r) => r.id === input.roundId);
  const first = [...roundPostsOf(topic, posts, input.userId, input.day, input.roundId, people)].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const dueAt = round ? new Date(`${input.day}T${round.time}:00+07:00`) : null;
  const postAt = first ? new Date(first.createdAt) : null;
  return {
    roomName: topic.name,
    roundLabel: round?.label ?? null,
    dueText: round ? `${reportDayText(input.day)} ${round.time} น.` : null,
    closeTime: lock ? effectiveHardCutoffTime(topic, lock) : null,
    post:
      first && postAt
        ? {
            href: `/chat-report/report-feed?topic=${encodeURIComponent(topic.id)}&post=${encodeURIComponent(first.id)}`,
            text: `${dayMonthText(postAt)} ${fmtTime.format(postAt)} น.`,
            lateText: dueAt && postAt.getTime() - dueAt.getTime() >= 60_000 ? lateDurationText(postAt.getTime() - dueAt.getTime()) : null,
          }
        : null,
  };
}
