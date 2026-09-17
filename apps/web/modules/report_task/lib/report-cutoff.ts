import type { ReportSubmissionLockSettings } from "@/modules/report_task/store/reminder-settings-store";
import type { ReportCutoff, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { effectiveRoundsOf, roundRunsOnDay } from "@/modules/report_task/lib/submission-rounds";

/**
 * The cutoffs/rounds actually in force on `day` — merges the legacy
 * `cutoffs` field and the newer submission-rounds system into the one shape
 * every helper below already understands (id/label/time/minImages), via
 * `effectiveRoundsOf` (which itself synthesizes one cutoff-shaped round per
 * legacy `ReportCutoff` when a room has no real `submissionRounds` yet).
 *
 * Every call site below used to read `topic.cutoffs` directly, which meant
 * the "✓ ตรงเวลา · รอบ X" post badge, the reply/composer's live minimum-photo
 * requirement, and the "ส่งช้า" filter all stayed silently blank for any room
 * using only the new rounds system (no legacy cutoffs configured) — found by
 * testing a real round live: a post that should have shown "ตรงเวลา" showed
 * nothing at all. Routing through this one function fixes every one of those
 * spots at once, and also drops any round that doesn't run on `day` at all
 * (a Mon/Wed/Fri-only round shouldn't badge a Tuesday post against it).
 */
export function cutoffsOnDay(
  topic: Pick<ReportTopic, "cutoffs" | "submissionRounds" | "requiredWeekdays" | "visibility">,
  day: string
): ReportCutoff[] {
  return effectiveRoundsOf(topic).filter((r) => roundRunsOnDay(r, day));
}

/** Nearest cutoff at/before the post's created time, on the same calendar day — null if none apply or it's on time. */
export function lateCutoffFor(createdAt: string, cutoffs: ReportCutoff[]): ReportCutoff | null {
  if (cutoffs.length === 0) return null;
  const created = new Date(createdAt);
  const minutesOfDay = created.getHours() * 60 + created.getMinutes();

  let latest: ReportCutoff | null = null;
  let latestMinutes = -1;
  for (const c of cutoffs) {
    const [h, m] = c.time.split(":").map(Number) as [number, number];
    const cutoffMinutes = h * 60 + m;
    if (cutoffMinutes <= minutesOfDay && cutoffMinutes > latestMinutes) {
      latest = c;
      latestMinutes = cutoffMinutes;
    }
  }
  return latest;
}

/** The round a post satisfied by arriving before it — the earliest cutoff at/after the post's time-of-day, or null if it's past every round that day (in which case `lateCutoffFor` already returns non-null instead). Used for the "✓ ตรงเวลา · รอบเช้า" badge (C10) — the positive counterpart to lateCutoffFor's "ส่งช้า" one. */
export function onTimeCutoffFor(createdAt: string, cutoffs: ReportCutoff[]): ReportCutoff | null {
  if (cutoffs.length === 0) return null;
  const created = new Date(createdAt);
  const minutesOfDay = created.getHours() * 60 + created.getMinutes();

  let earliest: ReportCutoff | null = null;
  let earliestMinutes = Infinity;
  for (const c of cutoffs) {
    const [h, m] = c.time.split(":").map(Number) as [number, number];
    const cutoffMinutes = h * 60 + m;
    if (cutoffMinutes >= minutesOfDay && cutoffMinutes < earliestMinutes) {
      earliest = c;
      earliestMinutes = cutoffMinutes;
    }
  }
  return earliest;
}

/** Which round "now" falls into — same reasoning as lateCutoffFor, just for the live clock instead of a post's timestamp. */
export function currentCutoff(cutoffs: ReportCutoff[]): ReportCutoff | null {
  return lateCutoffFor(new Date().toISOString(), cutoffs);
}

/**
 * Minimum photos a post made right now needs attached, given today's
 * effective rounds (pass `cutoffsOnDay(topic, today)` — the caller already
 * has `topic` and `today` to hand). No more room-level blanket default: a
 * round that doesn't set its own `minImages` requires none (0), matching the
 * "รูปขั้นต่ำผูกกับรอบเท่านั้น" decision in docs/report-room-unify-submission-
 * rounds-spec.md — a room with no round in force right now requires nothing.
 */
export function minImagesNow(topic: Pick<ReportTopic, "cutoffs">): number {
  const round = currentCutoff(topic.cutoffs);
  return round?.minImages ?? 0;
}

/**
 * The one "HH:mm" past which this room's submit button locks for the rest of
 * "today" — distinct from `submissionRounds[].time`/`cutoffs[].time`, which
 * only ever badge a post "ส่งช้า" and never block it. `null` = no lock (a
 * post can always be submitted), matching every room's behavior before this
 * feature existed. The company-wide toggle wins over whatever the room set
 * for itself — one shared deadline is the point of turning it on.
 */
export function effectiveHardCutoffTime(
  topic: Pick<ReportTopic, "hardCutoffTime">,
  lock: ReportSubmissionLockSettings
): string | null {
  if (lock.useGlobalCutoff) return lock.time;
  return topic.hardCutoffTime || null;
}

/** Minutes-of-day `hardCutoff` ("HH:mm") has already passed, given `nowMinutes` (also minutes-of-day) — `null`/empty never locks. */
export function isPastHardCutoff(hardCutoff: string | null | undefined, nowMinutes: number): boolean {
  if (!hardCutoff) return false;
  const [h, m] = hardCutoff.split(":").map(Number) as [number, number];
  return h * 60 + m <= nowMinutes;
}
