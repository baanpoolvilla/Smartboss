import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { users as allUsers, isOwner } from "@/modules/report_task/lib/directory";
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

/** วันในสัปดาห์ของรอบตรงกับวันนี้ไหม (undefined/ว่าง = ทุกวัน) */
export function roundRunsOnDay(round: Pick<SubmissionRound, "weekdays">, day: string): boolean {
  if (!round.weekdays || round.weekdays.length === 0) return true;
  return round.weekdays.includes(new Date(`${day}T00:00:00`).getDay());
}

/** คืน userId ที่ต้องส่ง "รอบนี้" (ยังไม่คิดวัน/วันลา — คิดชั้นบน) */
export function resolveRoundSubmitters(
  round: SubmissionRound,
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

/** ใช้ path รอบส่งใหม่ไหม (ห้องที่ตั้ง submissionRounds เอง) — ห้องเก่าตอบ false */
export function usesSubmissionRounds(topic: Pick<ReportTopic, "submissionRounds">): boolean {
  return !!topic.submissionRounds && topic.submissionRounds.length > 0;
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
