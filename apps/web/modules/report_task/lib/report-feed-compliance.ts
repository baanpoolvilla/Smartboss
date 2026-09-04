import { departments, getDepartment, getUser, users } from "@/modules/report_task/lib/directory";
import {
  roundsForUserOnDay,
  mustSubmitToTopic,
  roundRunsOnDay,
  effectiveRoundsOf,
  resolveRoundSubmitters,
  attributePostToRound,
} from "@/modules/report_task/lib/submission-rounds";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { photoCount } from "@/modules/report_task/lib/report-attachment-kind";
import { lateCutoffFor } from "@/modules/report_task/lib/report-cutoff";
import { localDateStr, now, todayIso } from "@/modules/report_task/lib/now";
import { isExemptDate, type DateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";
import type { ReportPost, ReportTopic, SubmissionRound } from "@/modules/report_task/store/report-feed-store";

/**
 * A room only counts toward compliance if it actually has a cutoff — that's
 * the only explicit "you're expected to post by X" signal the data model
 * has (see report-feed-store's ReportTopic). An open check-in room with no
 * cutoffs is optional posting, not a missed obligation, so it's excluded
 * entirely rather than inventing an obligation nothing configured.
 */
export function trackedTopicsOf(topics: ReportTopic[]): ReportTopic[] {
  return topics.filter((t) => t.cutoffs.length > 0 || (t.submissionRounds?.length ?? 0) > 0);
}

/**
 * The one room a department-scoped dashboard chart can deep-link straight
 * into (its "สถิติ" tab, see report-topic-panels.tsx's ตรงเวลา/สาย/ไม่ส่ง
 * breakdown) — only when that's unambiguous. A department with more than one
 * tracked room (or none) has no single room to land on, so callers should
 * fall back to a generic /report-feed link instead of guessing which one.
 */
export function trackedTopicIdForDepartment(topics: ReportTopic[], departmentId: string): string | null {
  const matches = trackedTopicsOf(topics).filter((t) => t.visibility?.departmentIds?.includes(departmentId));
  return matches.length === 1 ? matches[0]!.id : null;
}

function lastCutoffMinutes(topic: ReportTopic): number {
  return topic.cutoffs.reduce((max, c) => {
    const [h, m] = c.time.split(":").map(Number) as [number, number];
    return Math.max(max, h * 60 + m);
  }, 0);
}

/** groups ปัจจุบันจาก store (client) — คืน [] เมื่ออ่านฝั่ง server */
function groupsNow() {
  try {
    return useReportFeedStore.getState().submitterGroups;
  } catch {
    return [];
  }
}

/** เวลาปิดรอบสุดท้ายที่ "ผู้ใช้คนนี้" ต้องส่งในวันนั้น (นาทีของวัน) — null = ไม่ต้องส่งวันนั้น.
 * ห้องเก่า (ไม่มี submissionRounds): ใช้ requiredWeekdays + cutoff สุดท้ายของห้อง = พฤติกรรมเดิม. */
function userRequiredCutoffMinutes(topic: ReportTopic, userId: string, day: string): number | null {
  if (topic.submissionRounds && topic.submissionRounds.length > 0) {
    const rounds = roundsForUserOnDay(topic, userId, day, groupsNow());
    if (rounds.length === 0) return null;
    return rounds.reduce((max, r) => {
      const [h, m] = r.time.split(":").map(Number) as [number, number];
      return Math.max(max, h * 60 + m);
    }, 0);
  }
  if (!isRequiredWeekday(topic, day)) return null;
  return lastCutoffMinutes(topic);
}

/** The room's own final cutoff time-of-day, formatted "HH:MM" — for UI that
 * needs to show a specific room's real cutoff instead of assuming a global
 * one (rooms configure their own rounds independently, see ReportTopic). */
export function lastCutoffLabel(topic: ReportTopic): string {
  const mins = lastCutoffMinutes(topic);
  const h = Math.floor(mins / 60)
    .toString()
    .padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** Minimum photos a post made at `atIso` needed — same rule as report-cutoff.ts's `minImagesNow`, generalized to a specific timestamp instead of always "now" so a past post can be judged against the round it actually fell in. */
function minImagesFor(topic: ReportTopic, atIso: string): number {
  if (topic.submissionRounds && topic.submissionRounds.length > 0) {
    const mins = minutesOfDay(atIso);
    let pickedMin: number | undefined;
    let best = -1;
    for (const r of topic.submissionRounds) {
      const [h, m] = r.time.split(":").map(Number) as [number, number];
      const t = h * 60 + m;
      if (t <= mins && t > best) { best = t; pickedMin = r.minImages; }
    }
    return pickedMin ?? topic.minImages;
  }
  const round = lateCutoffFor(atIso, topic.cutoffs);
  return round?.minImages ?? topic.minImages;
}

function postsForDay(topic: ReportTopic, userId: string, day: string, posts: ReportPost[]): ReportPost[] {
  return posts.filter((p) => p.topicId === topic.id && p.authorId === userId && localDateStr(new Date(p.createdAt)) === day);
}

/** Inclusive list of "YYYY-MM-DD" strings from `startStr` to `endStr` — capped defensively so a bad range can't spin forever. Exported for lib/ai-insight/aggregate.ts, which needs the same day-walking logic server-side against a real DirectoryUser[] instead of the client-only `users`/`departments` this file's own per-viewer functions (reportStatusCountsByUser, mustReportToTopic, ...) read from lib/directory.ts. */
export function eachDay(startStr: string, endStr: string): string[] {
  if (startStr > endStr) return [];
  const out: string[] = [];
  const cursor = new Date(`${startStr}T00:00:00`);
  const end = new Date(`${endStr}T00:00:00`);
  while (cursor.getTime() <= end.getTime() && out.length < 366) {
    out.push(localDateStr(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export type ComplianceStatus = "on-time" | "late" | "missed" | "pending" | "exempt";

/**
 * A room's own creation day and "today" bound every compliance calculation —
 * a room can't have been missed before it existed, and a day that hasn't
 * finished yet can't be judged "missed" (see `dayComplianceStatus`'s
 * "pending" case).
 */
export function iterationBounds(topic: ReportTopic, range: { from: Date; to: Date } | null) {
  const roomStart = localDateStr(new Date(topic.createdAt));
  const todayStr = todayIso();
  const startStr = range ? (localDateStr(range.from) > roomStart ? localDateStr(range.from) : roomStart) : roomStart;
  const rangeEndStr = range ? localDateStr(range.to) : todayStr;
  const endStr = rangeEndStr < todayStr ? rangeEndStr : todayStr;
  return { startStr, endStr };
}

/**
 * One person's status in one room on one calendar day. Day-granularity, not
 * per-cutoff-round — a room can have several rounds a day (เช้า/เที่ยง/...),
 * but nothing elsewhere in the app enforces "one post per round" as a
 * distinct obligation (see report-cutoff.ts's per-post late badge, which
 * only flags an individual post against its nearest round). Day-level
 * compliance captures the meaningful signal — did they check in at all that
 * day, and was it before the day's final cutoff — without over-modeling an
 * obligation the product doesn't actually enforce anywhere else.
 */
/** A room's `requiredWeekdays` (0=Sun..6=Sat) — undefined/empty means every
 * day counts, today's existing behavior (including weekends, which is
 * exactly the "Saturday still shows as 'ไม่ส่ง'" complaint this exists to fix). */
function isRequiredWeekday(topic: ReportTopic, day: string): boolean {
  if (topic.submissionRounds && topic.submissionRounds.length > 0) {
    // Delegates to the same single decider roundsForUserOnDay/userRequiredCutoffMinutes
    // use, rather than re-checking just the weekday here — otherwise this
    // would judge a day "required" (and eventually "missed") even before the
    // round that requires it existed, since only roundRunsOnDay knows about
    // a round's own createdAt cutoff.
    return topic.submissionRounds.some((r) => roundRunsOnDay(r, day));
  }
  if (!topic.requiredWeekdays || topic.requiredWeekdays.length === 0) return true;
  return topic.requiredWeekdays.includes(new Date(`${day}T00:00:00`).getDay());
}

export function dayComplianceStatus(
  topic: ReportTopic,
  userId: string,
  day: string,
  posts: ReportPost[],
  exemptions?: DateExemptions
): ComplianceStatus {
  const lastCutoff = userRequiredCutoffMinutes(topic, userId, day);
  if (lastCutoff === null) return "exempt";
  if (exemptions && isExemptDate(exemptions, userId, day)) return "exempt";
  const dayPosts = postsForDay(topic, userId, day, posts);
  if (dayPosts.length > 0) {
    const onTime = dayPosts.some((p) => minutesOfDay(p.createdAt) <= lastCutoff);
    return onTime ? "on-time" : "late";
  }
  const todayStr = todayIso();
  if (day < todayStr) return "missed";
  // day === today: only "missed" once the day's last cutoff has actually passed.
  return minutesOfDay(now().toISOString()) > lastCutoff ? "missed" : "pending";
}

/** True when the day got a post at all, but none of that day's posts attached enough photos for whichever round they fell in — "showed up, but didn't bring what was required." Only meaningful for on-time/late days; a missed day has no post to check. */
function dayHasAttachmentIssue(
  topic: ReportTopic,
  userId: string,
  day: string,
  posts: ReportPost[],
  exemptions?: DateExemptions
): boolean {
  if (exemptions && isExemptDate(exemptions, userId, day)) return false;
  const dayPosts = postsForDay(topic, userId, day, posts);
  if (dayPosts.length === 0) return false;
  return !dayPosts.some((p) => photoCount(p.images) >= minImagesFor(topic, p.createdAt));
}

function roundMinutes(round: SubmissionRound): number {
  const [h, m] = round.time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Posts by `userId` in `topic` on `day` that `attributePostToRound` actually
 * attributes to `round` specifically — the per-round equivalent of
 * `postsForDay`, which is what every round-level function below needs
 * instead ("2 รอบ = 2 การส่งแยกกัน", not one shared per-day bucket). */
function postsForRound(topic: ReportTopic, userId: string, round: SubmissionRound, day: string, posts: ReportPost[]): ReportPost[] {
  const rounds = effectiveRoundsOf(topic);
  return postsForDay(topic, userId, day, posts).filter((p) => attributePostToRound(p, rounds)?.id === round.id);
}

/**
 * One person's status in one *round* of one room on one calendar day —
 * `dayComplianceStatus`'s per-round replacement (Phase 1.1): a room with 2
 * rounds a day now judges each one as its own obligation instead of
 * collapsing both into a single day-level verdict (see this file's own
 * `roundRunsOnDay`/`effectiveRoundsOf` doc comments in submission-rounds.ts
 * for why that collapsing was wrong). `dayComplianceStatus` itself is left
 * untouched — kpi-buckets.ts and the ai-insight analyzers still read it
 * directly and stay on the day-level path deliberately (out of this phase's
 * scope, see spec-report-rounds-phase1.1).
 */
export function roundComplianceStatus(
  topic: ReportTopic,
  userId: string,
  round: SubmissionRound,
  day: string,
  posts: ReportPost[],
  exemptions?: DateExemptions
): ComplianceStatus {
  if (!roundRunsOnDay(round, day)) return "exempt";
  if (exemptions && isExemptDate(exemptions, userId, day)) return "exempt";
  if (!resolveRoundSubmitters(round, topic.visibility, groupsNow()).includes(userId)) return "exempt";
  const cutoff = roundMinutes(round);
  const roundPosts = postsForRound(topic, userId, round, day, posts);
  if (roundPosts.length > 0) {
    const onTime = roundPosts.some((p) => minutesOfDay(p.createdAt) <= cutoff);
    return onTime ? "on-time" : "late";
  }
  const todayStr = todayIso();
  if (day < todayStr) return "missed";
  return minutesOfDay(now().toISOString()) > cutoff ? "missed" : "pending";
}

/** Per-round counterpart to `dayHasAttachmentIssue` — checks only the posts
 * actually attributed to `round`, against that round's own `minImages`
 * (falling back to the room default), instead of re-deriving "whichever
 * round was active" from the post's timestamp. */
function roundHasAttachmentIssue(
  topic: ReportTopic,
  userId: string,
  round: SubmissionRound,
  day: string,
  posts: ReportPost[],
  exemptions?: DateExemptions
): boolean {
  if (exemptions && isExemptDate(exemptions, userId, day)) return false;
  const roundPosts = postsForRound(topic, userId, round, day, posts);
  if (roundPosts.length === 0) return false;
  const required = round.minImages ?? topic.minImages;
  return !roundPosts.some((p) => photoCount(p.images) >= required);
}

export interface ComplianceRow {
  id: string;
  name: string;
  subtitle: string;
  roomsCount: number;
  /** Count of tracked (round, day) units, not calendar days (Phase 1.1) — a
   * room with 2 rounds a day contributes up to 2 per day, one per round, so
   * this can exceed the number of days actually elapsed. */
  trackedDays: number;
  onTime: number;
  late: number;
  missed: number;
  /** Days they did post, but none of that day's posts met the room's minimum-photo requirement — a subset flag on top of onTime/late, not a fourth mutually-exclusive bucket. */
  attachmentIssues: number;
  /** % of trackedDays that got a post at all (on-time + late) — "did they show up," same idea as Task's completionRate. Historically mislabeled "ตรงเวลา" in a few places — that's actually this field, not onTimeRate below. */
  complianceRate: number;
  /** % of trackedDays posted *before* the room's final cutoff specifically — stricter than complianceRate, which also counts late-but-posted days as a success. */
  onTimeRate: number;
  /** % of trackedDays posted late — a secondary signal, same shape as the Task report's latePercent. */
  lateRate: number;
}

function emptyRow(id: string, name: string, subtitle: string): ComplianceRow {
  return {
    id,
    name,
    subtitle,
    roomsCount: 0,
    trackedDays: 0,
    onTime: 0,
    late: 0,
    missed: 0,
    attachmentIssues: 0,
    complianceRate: 0,
    onTimeRate: 0,
    lateRate: 0,
  };
}

function finalize(row: ComplianceRow): ComplianceRow {
  return {
    ...row,
    complianceRate: row.trackedDays ? Math.round(((row.onTime + row.late) / row.trackedDays) * 100) : 0,
    onTimeRate: row.trackedDays ? Math.round((row.onTime / row.trackedDays) * 100) : 0,
    lateRate: row.trackedDays ? Math.round((row.late / row.trackedDays) * 100) : 0,
  };
}

/** Per-person compliance across every tracked room they're eligible for, within `range` (null = unbounded, still capped at the room's own start day and today). Days that fall on a recorded leave/holiday/routine-day-off (`exemptions`) are excluded entirely — not counted as tracked, not held against the person. */
export function buildUserComplianceReports(
  topics: ReportTopic[],
  posts: ReportPost[],
  range: { from: Date; to: Date } | null,
  exemptions?: DateExemptions
): ComplianceRow[] {
  const tracked = trackedTopicsOf(topics);
  return users.map((u) => {
    const row = emptyRow(u.id, u.name, getDepartment(u.departmentId)?.name ?? u.role);
    for (const topic of tracked) {
      if (!mustSubmitToTopic(topic, u.id)) continue;
      row.roomsCount += 1;
      const { startStr, endStr } = iterationBounds(topic, range);
      const rounds = effectiveRoundsOf(topic);
      for (const day of eachDay(startStr, endStr)) {
        for (const round of rounds) {
          const status = roundComplianceStatus(topic, u.id, round, day, posts, exemptions);
          if (status === "pending" || status === "exempt") continue;
          row.trackedDays += 1;
          if (status === "on-time") row.onTime += 1;
          else if (status === "late") row.late += 1;
          else row.missed += 1;
          if ((status === "on-time" || status === "late") && roundHasAttachmentIssue(topic, u.id, round, day, posts, exemptions)) {
            row.attachmentIssues += 1;
          }
        }
      }
    }
    return finalize(row);
  });
}

/** Same rows, aggregated per department (sum of its members' rows). */
export function buildDepartmentComplianceReports(
  topics: ReportTopic[],
  posts: ReportPost[],
  range: { from: Date; to: Date } | null,
  exemptions?: DateExemptions
): ComplianceRow[] {
  const userRows = buildUserComplianceReports(topics, posts, range, exemptions);
  return departments.map((d) => {
    const members = userRows.filter((r) => getUser(r.id)?.departmentId === d.id);
    const row = emptyRow(d.id, d.name, `${members.length} คน`);
    row.roomsCount = Math.max(0, ...members.map((m) => m.roomsCount));
    for (const m of members) {
      row.trackedDays += m.trackedDays;
      row.onTime += m.onTime;
      row.late += m.late;
      row.missed += m.missed;
      row.attachmentIssues += m.attachmentIssues;
    }
    return finalize(row);
  });
}

export interface ReportFeedKpis {
  /** % of tracked days that got a post at all (on-time + late) — "อัตราสำเร็จรายงาน". */
  complianceRate: number;
  /** % of tracked days posted before the room's final cutoff — "อัตราส่งตรงเวลา", stricter than complianceRate. */
  onTimeRate: number;
  latePercent: number;
  onTimeCount: number;
  lateCount: number;
  missedCount: number;
  totalPosts: number;
}

/** Top-line KPIs: compliance/late rate come from tracked rooms only; totalPosts counts every post in every visible room (tracked or not) within the range — an engagement number, not a compliance one. */
export function overallComplianceKpis(
  topics: ReportTopic[],
  posts: ReportPost[],
  range: { from: Date; to: Date } | null,
  exemptions?: DateExemptions
): ReportFeedKpis {
  const rows = buildUserComplianceReports(topics, posts, range, exemptions);
  const trackedDays = rows.reduce((s, r) => s + r.trackedDays, 0);
  const onTime = rows.reduce((s, r) => s + r.onTime, 0);
  const late = rows.reduce((s, r) => s + r.late, 0);
  const missed = rows.reduce((s, r) => s + r.missed, 0);

  const visibleTopicIds = new Set(topics.map((t) => t.id));
  const totalPosts = posts.filter((p) => {
    if (!visibleTopicIds.has(p.topicId)) return false;
    if (!range) return true;
    const t = new Date(p.createdAt).getTime();
    return t >= range.from.getTime() && t <= range.to.getTime();
  }).length;

  return {
    complianceRate: trackedDays ? Math.round(((onTime + late) / trackedDays) * 100) : 0,
    onTimeRate: trackedDays ? Math.round((onTime / trackedDays) * 100) : 0,
    latePercent: trackedDays ? Math.round((late / trackedDays) * 100) : 0,
    onTimeCount: onTime,
    lateCount: late,
    missedCount: missed,
    totalPosts,
  };
}

/**
 * Same KPIs as `overallComplianceKpis`, narrowed to the Dashboard's own
 * person/department filter (dashboard-filter-store) — so the report widgets
 * on the Dashboard stay in sync with whatever the task widgets up there are
 * already scoped to, instead of always showing the whole company regardless
 * of what's selected.
 */
export function complianceKpisForScope(
  topics: ReportTopic[],
  posts: ReportPost[],
  range: { from: Date; to: Date } | null,
  scope: { personId: string; departmentId: string },
  exemptions?: DateExemptions
): ReportFeedKpis {
  if (scope.personId !== "all") {
    const row = buildUserComplianceReports(topics, posts, range, exemptions).find((r) => r.id === scope.personId);
    const visibleTopicIds = new Set(topics.map((t) => t.id));
    const totalPosts = posts.filter((p) => {
      if (p.authorId !== scope.personId || !visibleTopicIds.has(p.topicId)) return false;
      if (!range) return true;
      const t = new Date(p.createdAt).getTime();
      return t >= range.from.getTime() && t <= range.to.getTime();
    }).length;
    return {
      complianceRate: row?.complianceRate ?? 0,
      onTimeRate: row?.onTimeRate ?? 0,
      latePercent: row?.lateRate ?? 0,
      onTimeCount: row?.onTime ?? 0,
      lateCount: row?.late ?? 0,
      missedCount: row?.missed ?? 0,
      totalPosts,
    };
  }
  if (scope.departmentId !== "all") {
    const row = buildDepartmentComplianceReports(topics, posts, range, exemptions).find((r) => r.id === scope.departmentId);
    const deptUserIds = new Set(users.filter((u) => u.departmentId === scope.departmentId).map((u) => u.id));
    const visibleTopicIds = new Set(topics.map((t) => t.id));
    const totalPosts = posts.filter((p) => {
      if (!deptUserIds.has(p.authorId) || !visibleTopicIds.has(p.topicId)) return false;
      if (!range) return true;
      const t = new Date(p.createdAt).getTime();
      return t >= range.from.getTime() && t <= range.to.getTime();
    }).length;
    return {
      complianceRate: row?.complianceRate ?? 0,
      onTimeRate: row?.onTimeRate ?? 0,
      latePercent: row?.lateRate ?? 0,
      onTimeCount: row?.onTime ?? 0,
      lateCount: row?.late ?? 0,
      missedCount: row?.missed ?? 0,
      totalPosts,
    };
  }
  return overallComplianceKpis(topics, posts, range, exemptions);
}

/** Raw per-day-status counts across every tracked room, for `kpi-buckets.ts`'s
 * §0.1 5-group Report bucket — the one place that needs `pending` and
 * `exempt` too, which `buildUserComplianceReports` deliberately skips (its
 * `trackedDays` denominator is only on-time/late/missed). Scoped up front by
 * person/department, same precedence as `complianceKpisForScope`. */
export interface ReportStatusCounts {
  onTime: number;
  lateDone: number;
  pending: number;
  missed: number;
  exempt: number;
}

/** Same 5-way split as `ReportStatusCounts`, one row per user — the per-person
 * breakdown `reportStatusCountsForScope` sums into a single total. Kept as
 * the one place that walks every tracked topic × round × day × user so the
 * scoped total and the per-person breakdown can never drift apart.
 *
 * Phase 1.1: switched from `dayComplianceStatus` to `roundComplianceStatus`
 * (one count per (person, round, day), not per (person, day)) — this is what
 * `kpi-buckets.ts`'s `reportKpiBuckets` feeds the Dashboard's "KPI รวมของระบบ
 * (Task + Report)" card and `report-feed-status-pie.tsx` with, and leaving it
 * on the old day-level path made a room with 2 rounds silently undercount
 * there while every other report-feed number (header pill, "ยังไม่ส่งวันนี้",
 * per-person stats) had already moved to round-level, so the two disagreed.
 * `dayComplianceStatus` itself is untouched — the ai-insight analyzers
 * (risk.ts, root-cause.ts, aggregate.ts) call it directly and stay on the
 * day-level path, unaffected by this function's own switch. */
export function reportStatusCountsByUser(
  topics: ReportTopic[],
  posts: ReportPost[],
  range: { from: Date; to: Date } | null,
  exemptions?: DateExemptions
): Map<string, ReportStatusCounts> {
  const tracked = trackedTopicsOf(topics);
  const out = new Map<string, ReportStatusCounts>();
  for (const u of users) out.set(u.id, { onTime: 0, lateDone: 0, pending: 0, missed: 0, exempt: 0 });
  for (const topic of tracked) {
    const { startStr, endStr } = iterationBounds(topic, range);
    const days = eachDay(startStr, endStr);
    const rounds = effectiveRoundsOf(topic);
    for (const u of users) {
      if (!mustSubmitToTopic(topic, u.id)) continue;
      const counts = out.get(u.id)!;
      for (const day of days) {
        for (const round of rounds) {
          const status = roundComplianceStatus(topic, u.id, round, day, posts, exemptions);
          if (status === "on-time") counts.onTime += 1;
          else if (status === "late") counts.lateDone += 1;
          else if (status === "pending") counts.pending += 1;
          else if (status === "missed") counts.missed += 1;
          else counts.exempt += 1;
        }
      }
    }
  }
  return out;
}

export function scopedUserIds(scope: { personId: string; departmentId: string }): Set<string> {
  return new Set(
    users
      .filter((u) => {
        if (scope.personId !== "all") return u.id === scope.personId;
        if (scope.departmentId !== "all") return u.departmentId === scope.departmentId;
        return true;
      })
      .map((u) => u.id)
  );
}

export function reportStatusCountsForScope(
  topics: ReportTopic[],
  posts: ReportPost[],
  range: { from: Date; to: Date } | null,
  scope: { personId: string; departmentId: string },
  exemptions?: DateExemptions
): ReportStatusCounts {
  const byUser = reportStatusCountsByUser(topics, posts, range, exemptions);
  const ids = scopedUserIds(scope);
  const counts: ReportStatusCounts = { onTime: 0, lateDone: 0, pending: 0, missed: 0, exempt: 0 };
  for (const [id, c] of byUser) {
    if (!ids.has(id)) continue;
    counts.onTime += c.onTime;
    counts.lateDone += c.lateDone;
    counts.pending += c.pending;
    counts.missed += c.missed;
    counts.exempt += c.exempt;
  }
  return counts;
}

export interface MissedReportEntry {
  userId: string;
  userName: string;
  userAvatar: string;
  departmentName: string;
  topicId: string;
  topicName: string;
  topicColor: string;
  /** "YYYY-MM-DD" the report was due and never showed up. */
  day: string;
}

/**
 * The most recent "should have posted, didn't" entries across every tracked
 * room — the Operations section's "Pending Reports" list. Only looks at
 * each room's last 3 tracked days (not its whole history) since this is a
 * "what needs attention right now" list, not a full audit trail.
 */
export function recentMissedReports(
  topics: ReportTopic[],
  posts: ReportPost[],
  limit = 5,
  exemptions?: DateExemptions
): MissedReportEntry[] {
  const tracked = trackedTopicsOf(topics);
  const entries: MissedReportEntry[] = [];
  for (const topic of tracked) {
    const { startStr, endStr } = iterationBounds(topic, null);
    const recentDays = eachDay(startStr, endStr).slice(-3);
    for (const u of users) {
      if (!mustSubmitToTopic(topic, u.id)) continue;
      for (const day of recentDays) {
        if (dayComplianceStatus(topic, u.id, day, posts, exemptions) === "missed") {
          entries.push({
            userId: u.id,
            userName: u.name,
            userAvatar: u.avatar,
            departmentName: getDepartment(u.departmentId)?.name ?? u.role,
            topicId: topic.id,
            topicName: topic.name,
            topicColor: topic.color,
            day,
          });
        }
      }
    }
  }
  entries.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return entries.slice(0, limit);
}

export interface AttachmentIssueEntry extends MissedReportEntry {
  imagesAttached: number;
  imagesRequired: number;
}

/**
 * "Posted, but didn't attach enough photos" — distinct from
 * `recentMissedReports` (which is "never posted at all"). Same last-3-
 * tracked-days window and shape, plus the actual-vs-required photo count so
 * the UI can say exactly what was short.
 */
export function recentAttachmentIssues(
  topics: ReportTopic[],
  posts: ReportPost[],
  limit = 5,
  exemptions?: DateExemptions
): AttachmentIssueEntry[] {
  const tracked = trackedTopicsOf(topics);
  const entries: AttachmentIssueEntry[] = [];
  for (const topic of tracked) {
    const { startStr, endStr } = iterationBounds(topic, null);
    const recentDays = eachDay(startStr, endStr).slice(-3);
    for (const u of users) {
      if (!mustSubmitToTopic(topic, u.id)) continue;
      for (const day of recentDays) {
        const dayPosts = postsForDay(topic, u.id, day, posts);
        if (dayPosts.length === 0) continue;
        if (!dayHasAttachmentIssue(topic, u.id, day, posts, exemptions)) continue;
        // The post with the most images that day is the closest attempt — report that shortfall, not the worst one.
        const best = dayPosts.reduce((a, b) => (photoCount(b.images) > photoCount(a.images) ? b : a));
        entries.push({
          userId: u.id,
          userName: u.name,
          userAvatar: u.avatar,
          departmentName: getDepartment(u.departmentId)?.name ?? u.role,
          topicId: topic.id,
          topicName: topic.name,
          topicColor: topic.color,
          day,
          imagesAttached: photoCount(best.images),
          imagesRequired: minImagesFor(topic, best.createdAt),
        });
      }
    }
  }
  entries.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return entries.slice(0, limit);
}

export interface PendingTodayEntry {
  userId: string;
  userName: string;
  userAvatar: string;
  departmentName: string;
  topicId: string;
  topicName: string;
  topicColor: string;
  /** Which round (Phase 1.1) this obligation belongs to — a room with 2+
   * rounds a day now produces one entry per still-pending round, not one
   * merged per-day entry. */
  roundId: string;
  roundLabel: string;
  /** "HH:mm" — the round's own cutoff, for UI that wants to say exactly which round without a topic lookup. */
  roundTime: string;
}

/**
 * Straight "who hasn't posted yet today" — every real member (see
 * `mustReportToTopic`) of every cutoff-tracked room who has no post in that
 * room dated today. Simpler than `recentMissedReports` on purpose: today
 * only, no last-3-days window, no "late vs missed" distinction — just a
 * plain nudge list for right now. A day someone's on approved leave/holiday
 * doesn't count against them.
 */
export interface TodayComplianceSummary {
  /** Every real (person, round) obligation today across every tracked room — Phase 1.1: a room with 2 rounds counts each member twice. */
  totalTracked: number;
  postedToday: number;
  lateToday: number;
  missingToday: number;
}

/** Today's headline numbers for the report-feed page header's actionable
 * pills (H1 — "ส่งแล้ววันนี้ 18/24" / "ส่งช้า 3" / "ยังไม่ส่ง 3"), same
 * today-only scope as `pendingToday` above but counting everyone, not just
 * who's missing. Phase 1.1: counts per (person, round), not per person — a
 * room with 2 rounds today gives each of its members up to 2 chances to
 * show up in postedToday/lateToday/missingToday, matching how `pendingToday`
 * and `todayStatusEntries` below now count the same day. */
export function todayComplianceSummary(
  topics: ReportTopic[],
  posts: ReportPost[],
  exemptions?: DateExemptions
): TodayComplianceSummary {
  const tracked = trackedTopicsOf(topics);
  const today = todayIso();
  const groups = groupsNow();
  const summary: TodayComplianceSummary = { totalTracked: 0, postedToday: 0, lateToday: 0, missingToday: 0 };
  for (const topic of tracked) {
    if (today < localDateStr(new Date(topic.createdAt))) continue;
    const allRounds = effectiveRoundsOf(topic);
    for (const u of users) {
      if (exemptions && isExemptDate(exemptions, u.id, today)) continue;
      for (const round of roundsForUserOnDay(topic, u.id, today, groups)) {
        summary.totalTracked += 1;
        const roundPosts = postsForDay(topic, u.id, today, posts).filter((p) => attributePostToRound(p, allRounds)?.id === round.id);
        if (roundPosts.length === 0) {
          summary.missingToday += 1;
          continue;
        }
        summary.postedToday += 1;
        const cutoff = roundMinutes(round);
        if (!roundPosts.some((p) => minutesOfDay(p.createdAt) <= cutoff)) summary.lateToday += 1;
      }
    }
  }
  return summary;
}

export interface TodayStatusEntry {
  userId: string;
  userName: string;
  userAvatar: string;
  departmentName: string;
  topicId: string;
  topicName: string;
  topicColor: string;
  status: "posted" | "late" | "missing";
  /** Which round (Phase 1.1) this status is for — see `PendingTodayEntry`'s own comment. */
  roundId: string;
  roundLabel: string;
  roundTime: string;
}

/** Same today-only scope/loop as `todayComplianceSummary`, but returning the
 * actual per-person rows instead of just totals — what the header pills
 * (H1) link into (ส่งแล้ววันนี้/ส่งช้า/ยังไม่ส่ง), so clicking one lands on
 * the people behind that number instead of a generic merged feed. Phase
 * 1.1: one entry per (person, round) today, not per person — see
 * `todayComplianceSummary`'s own comment. */
export function todayStatusEntries(
  topics: ReportTopic[],
  posts: ReportPost[],
  exemptions?: DateExemptions
): TodayStatusEntry[] {
  const tracked = trackedTopicsOf(topics);
  const today = todayIso();
  const groups = groupsNow();
  const entries: TodayStatusEntry[] = [];
  for (const topic of tracked) {
    if (today < localDateStr(new Date(topic.createdAt))) continue;
    const allRounds = effectiveRoundsOf(topic);
    for (const u of users) {
      if (exemptions && isExemptDate(exemptions, u.id, today)) continue;
      for (const round of roundsForUserOnDay(topic, u.id, today, groups)) {
        const base = {
          userId: u.id,
          userName: u.name,
          userAvatar: u.avatar,
          departmentName: getDepartment(u.departmentId)?.name ?? u.role,
          topicId: topic.id,
          topicName: topic.name,
          topicColor: topic.color,
          roundId: round.id,
          roundLabel: round.label,
          roundTime: round.time,
        };
        const roundPosts = postsForDay(topic, u.id, today, posts).filter((p) => attributePostToRound(p, allRounds)?.id === round.id);
        if (roundPosts.length === 0) {
          entries.push({ ...base, status: "missing" });
          continue;
        }
        const cutoff = roundMinutes(round);
        const onTime = roundPosts.some((p) => minutesOfDay(p.createdAt) <= cutoff);
        entries.push({ ...base, status: onTime ? "posted" : "late" });
      }
    }
  }
  return entries;
}

/** Phase 1.1: one entry per still-pending (person, round) today, not per
 * person — a member of a 2-round room who's missed both shows up twice,
 * once per round, so a caller that wants "which rooms still owe me
 * something" (not "how many separate things") should de-dupe by topicId
 * itself (see PendingTopicsPanel in page.tsx). */
export function pendingToday(topics: ReportTopic[], posts: ReportPost[], exemptions?: DateExemptions): PendingTodayEntry[] {
  const tracked = trackedTopicsOf(topics);
  const today = todayIso();
  const groups = groupsNow();
  const entries: PendingTodayEntry[] = [];
  for (const topic of tracked) {
    if (today < localDateStr(new Date(topic.createdAt))) continue;
    const allRounds = effectiveRoundsOf(topic);
    for (const u of users) {
      if (exemptions && isExemptDate(exemptions, u.id, today)) continue;
      for (const round of roundsForUserOnDay(topic, u.id, today, groups)) {
        const roundPosts = postsForDay(topic, u.id, today, posts).filter((p) => attributePostToRound(p, allRounds)?.id === round.id);
        if (roundPosts.length > 0) continue;
        entries.push({
          userId: u.id,
          userName: u.name,
          userAvatar: u.avatar,
          departmentName: getDepartment(u.departmentId)?.name ?? u.role,
          topicId: topic.id,
          topicName: topic.name,
          topicColor: topic.color,
          roundId: round.id,
          roundLabel: round.label,
          roundTime: round.time,
        });
      }
    }
  }
  return entries;
}

export interface ReportBacklogEntry extends PendingTodayEntry {
  /** "YYYY-MM-DD" the report was/is due. */
  day: string;
}

/**
 * The Dashboard's own version of "who hasn't posted" — unlike `pendingToday`
 * (always today, used by the /report-feed page itself), this walks every
 * required day inside `range` so it actually follows the Dashboard's date
 * filter instead of secretly always showing today regardless of what preset
 * is selected. Split into two buckets using the same per-round status
 * (`roundComplianceStatus`, Phase 1.1) the compliance rows above are built
 * from, so these counts always agree with them:
 *  - `pending` — today only, cutoff hasn't passed yet, still postable
 *  - `missed`  — cutoff already passed (today or any earlier required day in range)
 * This is the one shared source for both the KPI card's 4 backlog cells
 * (§2.4) and this list — don't recompute the same thing a second way.
 */
export function reportBacklogEntries(
  topics: ReportTopic[],
  posts: ReportPost[],
  range: { from: Date; to: Date } | null,
  exemptions?: DateExemptions
): { pending: ReportBacklogEntry[]; missed: ReportBacklogEntry[] } {
  const tracked = trackedTopicsOf(topics);
  const pending: ReportBacklogEntry[] = [];
  const missed: ReportBacklogEntry[] = [];
  for (const topic of tracked) {
    const { startStr, endStr } = iterationBounds(topic, range);
    const rounds = effectiveRoundsOf(topic);
    for (const day of eachDay(startStr, endStr)) {
      for (const u of users) {
        for (const round of rounds) {
          const status = roundComplianceStatus(topic, u.id, round, day, posts, exemptions);
          if (status !== "pending" && status !== "missed") continue;
          const entry: ReportBacklogEntry = {
            userId: u.id,
            userName: u.name,
            userAvatar: u.avatar,
            departmentName: getDepartment(u.departmentId)?.name ?? u.role,
            topicId: topic.id,
            topicName: topic.name,
            topicColor: topic.color,
            roundId: round.id,
            roundLabel: round.label,
            roundTime: round.time,
            day,
          };
          (status === "pending" ? pending : missed).push(entry);
        }
      }
    }
  }
  return { pending, missed };
}
