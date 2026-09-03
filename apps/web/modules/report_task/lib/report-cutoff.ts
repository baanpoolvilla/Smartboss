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
 * Minimum photos a post made right now needs attached. A round's own
 * `minImages` wins when set (lets เช้า require 2 photos while เย็น needs
 * none); otherwise falls back to the room's blanket `minImages`.
 */
export function minImagesNow(topic: Pick<ReportTopic, "minImages" | "cutoffs">): number {
  const round = currentCutoff(topic.cutoffs);
  return round?.minImages ?? topic.minImages;
}
