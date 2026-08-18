import { departments, getDepartment, getUser, users } from "@/modules/report_task/lib/directory";
import { mustReportToTopic } from "@/modules/report_task/lib/permissions";
import { lateCutoffFor } from "@/modules/report_task/lib/report-cutoff";
import { localDateStr, now, todayIso } from "@/modules/report_task/lib/now";
import { isExemptDate, type DateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";

/**
 * A room only counts toward compliance if it actually has a cutoff — that's
 * the only explicit "you're expected to post by X" signal the data model
 * has (see report-feed-store's ReportTopic). An open check-in room with no
 * cutoffs is optional posting, not a missed obligation, so it's excluded
 * entirely rather than inventing an obligation nothing configured.
 */
export function trackedTopicsOf(topics: ReportTopic[]): ReportTopic[] {
  return topics.filter((t) => t.cutoffs.length > 0);
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
  const round = lateCutoffFor(atIso, topic.cutoffs);
  return round?.minImages ?? topic.minImages;
}

function postsForDay(topic: ReportTopic, userId: string, day: string, posts: ReportPost[]): ReportPost[] {
  return posts.filter((p) => p.topicId === topic.id && p.authorId === userId && localDateStr(new Date(p.createdAt)) === day);
}

/** Inclusive list of "YYYY-MM-DD" strings from `startStr` to `endStr` — capped defensively so a bad range can't spin forever. */
function eachDay(startStr: string, endStr: string): string[] {
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
function iterationBounds(topic: ReportTopic, range: { from: Date; to: Date } | null) {
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
  if (!topic.requiredWeekdays || topic.requiredWeekdays.length === 0) return true;
  return topic.requiredWeekdays.includes(new Date(`${day}T00:00:00`).getDay());
}

function dayComplianceStatus(
  topic: ReportTopic,
  userId: string,
  day: string,
  posts: ReportPost[],
  exemptions?: DateExemptions
): ComplianceStatus {
  if (!isRequiredWeekday(topic, day)) return "exempt";
  if (exemptions && isExemptDate(exemptions, userId, day)) return "exempt";
  const dayPosts = postsForDay(topic, userId, day, posts);
  const lastCutoff = lastCutoffMinutes(topic);
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
  return !dayPosts.some((p) => p.images.length >= minImagesFor(topic, p.createdAt));
}

export interface ComplianceRow {
  id: string;
  name: string;
  subtitle: string;
  roomsCount: number;
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
      if (!mustReportToTopic(topic.visibility, u.id)) continue;
      row.roomsCount += 1;
      const { startStr, endStr } = iterationBounds(topic, range);
      for (const day of eachDay(startStr, endStr)) {
        const status = dayComplianceStatus(topic, u.id, day, posts, exemptions);
        if (status === "pending" || status === "exempt") continue;
        row.trackedDays += 1;
        if (status === "on-time") row.onTime += 1;
        else if (status === "late") row.late += 1;
        else row.missed += 1;
        if ((status === "on-time" || status === "late") && dayHasAttachmentIssue(topic, u.id, day, posts, exemptions)) {
          row.attachmentIssues += 1;
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
 * the one place that walks every tracked topic × day × user so the scoped
 * total and the per-person breakdown can never drift apart. */
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
    for (const u of users) {
      if (!mustReportToTopic(topic.visibility, u.id)) continue;
      const counts = out.get(u.id)!;
      for (const day of days) {
        const status = dayComplianceStatus(topic, u.id, day, posts, exemptions);
        if (status === "on-time") counts.onTime += 1;
        else if (status === "late") counts.lateDone += 1;
        else if (status === "pending") counts.pending += 1;
        else if (status === "missed") counts.missed += 1;
        else counts.exempt += 1;
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
      if (!mustReportToTopic(topic.visibility, u.id)) continue;
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
      if (!mustReportToTopic(topic.visibility, u.id)) continue;
      for (const day of recentDays) {
        const dayPosts = postsForDay(topic, u.id, day, posts);
        if (dayPosts.length === 0) continue;
        if (!dayHasAttachmentIssue(topic, u.id, day, posts, exemptions)) continue;
        // The post with the most images that day is the closest attempt — report that shortfall, not the worst one.
        const best = dayPosts.reduce((a, b) => (b.images.length > a.images.length ? b : a));
        entries.push({
          userId: u.id,
          userName: u.name,
          userAvatar: u.avatar,
          departmentName: getDepartment(u.departmentId)?.name ?? u.role,
          topicId: topic.id,
          topicName: topic.name,
          topicColor: topic.color,
          day,
          imagesAttached: best.images.length,
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
  /** Every real member of every cutoff-tracked room, today. */
  totalTracked: number;
  postedToday: number;
  lateToday: number;
  missingToday: number;
}

/** Today's headline numbers for the report-feed page header's actionable
 * pills (H1 — "ส่งแล้ววันนี้ 18/24" / "ส่งช้า 3" / "ยังไม่ส่ง 3"), same
 * today-only scope as `pendingToday` above but counting everyone, not just
 * who's missing. */
export function todayComplianceSummary(
  topics: ReportTopic[],
  posts: ReportPost[],
  exemptions?: DateExemptions
): TodayComplianceSummary {
  const tracked = trackedTopicsOf(topics);
  const today = todayIso();
  const summary: TodayComplianceSummary = { totalTracked: 0, postedToday: 0, lateToday: 0, missingToday: 0 };
  for (const topic of tracked) {
    if (today < localDateStr(new Date(topic.createdAt))) continue;
    if (!isRequiredWeekday(topic, today)) continue;
    for (const u of users) {
      if (!mustReportToTopic(topic.visibility, u.id)) continue;
      if (exemptions && isExemptDate(exemptions, u.id, today)) continue;
      summary.totalTracked += 1;
      const dayPosts = postsForDay(topic, u.id, today, posts);
      if (dayPosts.length === 0) {
        summary.missingToday += 1;
        continue;
      }
      summary.postedToday += 1;
      const lastCutoff = lastCutoffMinutes(topic);
      if (!dayPosts.some((p) => minutesOfDay(p.createdAt) <= lastCutoff)) summary.lateToday += 1;
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
}

/** Same today-only scope/loop as `todayComplianceSummary`, but returning the
 * actual per-person rows instead of just totals — what the header pills
 * (H1) link into (ส่งแล้ววันนี้/ส่งช้า/ยังไม่ส่ง), so clicking one lands on
 * the people behind that number instead of a generic merged feed. */
export function todayStatusEntries(
  topics: ReportTopic[],
  posts: ReportPost[],
  exemptions?: DateExemptions
): TodayStatusEntry[] {
  const tracked = trackedTopicsOf(topics);
  const today = todayIso();
  const entries: TodayStatusEntry[] = [];
  for (const topic of tracked) {
    if (today < localDateStr(new Date(topic.createdAt))) continue;
    if (!isRequiredWeekday(topic, today)) continue;
    for (const u of users) {
      if (!mustReportToTopic(topic.visibility, u.id)) continue;
      if (exemptions && isExemptDate(exemptions, u.id, today)) continue;
      const base = {
        userId: u.id,
        userName: u.name,
        userAvatar: u.avatar,
        departmentName: getDepartment(u.departmentId)?.name ?? u.role,
        topicId: topic.id,
        topicName: topic.name,
        topicColor: topic.color,
      };
      const dayPosts = postsForDay(topic, u.id, today, posts);
      if (dayPosts.length === 0) {
        entries.push({ ...base, status: "missing" });
        continue;
      }
      const lastCutoff = lastCutoffMinutes(topic);
      const onTime = dayPosts.some((p) => minutesOfDay(p.createdAt) <= lastCutoff);
      entries.push({ ...base, status: onTime ? "posted" : "late" });
    }
  }
  return entries;
}

export function pendingToday(topics: ReportTopic[], posts: ReportPost[], exemptions?: DateExemptions): PendingTodayEntry[] {
  const tracked = trackedTopicsOf(topics);
  const today = todayIso();
  const entries: PendingTodayEntry[] = [];
  for (const topic of tracked) {
    if (today < localDateStr(new Date(topic.createdAt))) continue;
    if (!isRequiredWeekday(topic, today)) continue;
    for (const u of users) {
      if (!mustReportToTopic(topic.visibility, u.id)) continue;
      if (exemptions && isExemptDate(exemptions, u.id, today)) continue;
      if (postsForDay(topic, u.id, today, posts).length > 0) continue;
      entries.push({
        userId: u.id,
        userName: u.name,
        userAvatar: u.avatar,
        departmentName: getDepartment(u.departmentId)?.name ?? u.role,
        topicId: topic.id,
        topicName: topic.name,
        topicColor: topic.color,
      });
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
 * is selected. Split into two buckets using the same per-day status
 * (`dayComplianceStatus`) the compliance rows above are built from, so these
 * counts always agree with them:
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
    for (const day of eachDay(startStr, endStr)) {
      for (const u of users) {
        if (!mustReportToTopic(topic.visibility, u.id)) continue;
        const status = dayComplianceStatus(topic, u.id, day, posts, exemptions);
        if (status !== "pending" && status !== "missed") continue;
        const entry: ReportBacklogEntry = {
          userId: u.id,
          userName: u.name,
          userAvatar: u.avatar,
          departmentName: getDepartment(u.departmentId)?.name ?? u.role,
          topicId: topic.id,
          topicName: topic.name,
          topicColor: topic.color,
          day,
        };
        (status === "pending" ? pending : missed).push(entry);
      }
    }
  }
  return { pending, missed };
}
