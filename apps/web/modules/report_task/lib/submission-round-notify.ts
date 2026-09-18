import { resolveRoundSubmitters } from "@/modules/report_task/lib/submission-rounds";
import type { ReportTopicVisibility, SubmissionRound, SubmitterGroup } from "@/modules/report_task/store/report-feed-store";

const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/** "ก่อน 09:00 น. · จ อ พ" — the same "when" phrasing every round-editing
 * screen already uses (report-topic-settings-dialog.tsx's `daysLabel`),
 * duplicated here in miniature since this lib has no UI to import it from. */
function whenLabel(r: Pick<SubmissionRound, "time" | "weekdays" | "dayOfMonth">): string {
  const day = r.dayOfMonth
    ? `วันที่ ${r.dayOfMonth} ของเดือน`
    : r.weekdays && r.weekdays.length > 0
      ? r.weekdays.slice().sort((a, b) => a - b).map((d) => WD[d]).join(" ")
      : "ทุกวัน";
  return `ก่อน ${r.time} น. · ${day}`;
}

/** Whether two versions of the *same* round (matched by id) differ in any
 * way a submitter would actually care about — time, which days it runs, or
 * how many photos it requires. Submitter *membership* is diffed separately
 * (a person added/removed from the round) so this only covers "the rest of
 * the round changed under you while you're still on it". */
function roundConfigChanged(
  a: Pick<SubmissionRound, "time" | "weekdays" | "dayOfMonth" | "minImages">,
  b: Pick<SubmissionRound, "time" | "weekdays" | "dayOfMonth" | "minImages">
): boolean {
  return (
    a.time !== b.time ||
    a.dayOfMonth !== b.dayOfMonth ||
    (a.minImages ?? 0) !== (b.minImages ?? 0) ||
    JSON.stringify((a.weekdays ?? []).slice().sort()) !== JSON.stringify((b.weekdays ?? []).slice().sort())
  );
}

export interface RoundChangeNotice {
  userId: string;
  message: string;
}

/**
 * Diffs a room's submission rounds before/after a save and returns one
 * notice per (affected person, meaningful change) — added to a round,
 * dropped from one, the round's own time/days/minImages changed under them,
 * or the whole round got deleted. Silent on anything that doesn't actually
 * change what a person is on the hook for (renaming a round's label,
 * reordering, editing a *different* round entirely).
 *
 * "ใครโดนแจ้งเตือน" — this is the single source both the live preview inside
 * SubmissionRoundDialog and the actual notification sweep in
 * report-feed-store.ts's `updateTopicSettings` read from, so what an admin
 * is shown before saving always matches who actually gets notified after.
 */
export function submissionRoundChangeNotices(
  topicName: string,
  before: SubmissionRound[],
  after: SubmissionRound[],
  visibility: ReportTopicVisibility | undefined,
  groups: SubmitterGroup[]
): RoundChangeNotice[] {
  const notices: RoundChangeNotice[] = [];
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const afterById = new Map(after.map((r) => [r.id, r]));
  const allIds = new Set([...beforeById.keys(), ...afterById.keys()]);

  for (const id of allIds) {
    const oldR = beforeById.get(id);
    const newR = afterById.get(id);
    const oldSubs = new Set(oldR ? resolveRoundSubmitters(oldR, visibility, groups) : []);
    const newSubs = new Set(newR ? resolveRoundSubmitters(newR, visibility, groups) : []);

    if (!newR) {
      for (const uid of oldSubs) {
        notices.push({ userId: uid, message: `รอบส่ง "${oldR!.label}" ในห้อง "${topicName}" ถูกยกเลิกแล้ว — ไม่ต้องส่งรอบนี้อีกต่อไป` });
      }
      continue;
    }
    if (!oldR) {
      for (const uid of newSubs) {
        notices.push({ userId: uid, message: `มีรอบส่งใหม่ "${newR.label}" ในห้อง "${topicName}" — ต้องส่ง${whenLabel(newR)}` });
      }
      continue;
    }

    const changed = roundConfigChanged(oldR, newR);
    for (const uid of newSubs) {
      if (!oldSubs.has(uid)) {
        notices.push({ userId: uid, message: `คุณถูกเพิ่มเป็นผู้ต้องส่งรอบ "${newR.label}" ในห้อง "${topicName}" — ต้องส่ง${whenLabel(newR)}` });
      } else if (changed) {
        notices.push({ userId: uid, message: `รอบส่ง "${newR.label}" ในห้อง "${topicName}" เปลี่ยนกำหนดใหม่ — ต้องส่ง${whenLabel(newR)}` });
      }
    }
    for (const uid of oldSubs) {
      if (!newSubs.has(uid)) {
        notices.push({ userId: uid, message: `คุณถูกถอดออกจากผู้ต้องส่งรอบ "${oldR.label}" ในห้อง "${topicName}" แล้ว — ไม่ต้องส่งรอบนี้อีก` });
      }
    }
  }

  return notices;
}
