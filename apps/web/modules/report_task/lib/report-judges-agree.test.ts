import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { roundComplianceStatus } from "@/modules/report_task/lib/report-feed-compliance";
import { roundComplianceStatusServer } from "@/modules/report_task/lib/report-penalty-sweep";
import { buildDateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useReportPenaltySettingsStore } from "@/modules/report_task/store/report-penalty-settings-store";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { CalendarEvent } from "@/modules/report_task/types";
import type { DirectoryUser } from "@/modules/report_task/lib/db/employee-directory";

/**
 * แดชบอร์ด (roundComplianceStatus) กับตัวหักคะแนนฝั่งเซิร์ฟเวอร์
 * (roundComplianceStatusServer) ต้องตัดสินรอบเดียวกันเหมือนกันทุกกรณีของวันที่ผ่านไปแล้ว
 * — ไม่งั้นแดชบอร์ดบอก "ไม่ส่ง" แต่คะแนนไม่หัก (หรือกลับกัน) สถานการณ์จริงจาก 25–28/09/2026
 */
const U = "u1";
const users: DirectoryUser[] = [
  { id: U, name: "Aui", email: "aui@x", avatar: "AU", avatarUrl: null, role: "พนักงาน", departmentId: "d1" },
];
const people = { mode: "people" as const, userIds: [U] };

const daily = {
  id: "daily", name: "daily-report", createdAt: "2026-09-01T00:00:00.000Z", cutoffs: [],
  submissionRounds: [
    { id: "m", label: "Morning", time: "09:00", submitters: people },
    { id: "e", label: "Evening", time: "18:00", submitters: people },
  ],
} as unknown as ReportTopic;
const weekly = {
  id: "weekly", name: "weekly-report", createdAt: "2026-09-01T00:00:00.000Z", cutoffs: [],
  submissionRounds: [{ id: "w", label: "Weekly", time: "18:00", weekdays: [5], submitters: people }],
} as unknown as ReportTopic;

const at = (local: string) => new Date(local).toISOString();
const post = (id: string, topicId: string, local: string, roundId?: string) =>
  ({ id, topicId, authorId: U, createdAt: at(local), ...(roundId ? { roundId } : {}) }) as unknown as ReportPost;

const posts: ReportPost[] = [
  // โพสต์จริงเลือกรอบจากตัวเลือกตอนโพสต์ (roundId) — ไม่มี roundId จะถูกจับเข้ารอบถัดไป
  // (09:03 → Evening) ทั้งสองฝั่ง ดู audit-report-docks.ts ที่นับโพสต์แบบนั้นไว้
  post("p1", "daily", "2026-09-25T09:03:00", "m"), // Morning สาย 3 นาที
  post("p2", "daily", "2026-09-25T17:05:00", "e"), // Evening ตรงเวลา
  post("p3", "weekly", "2026-09-27T08:37:00"), // Weekly ของ 25/09 ส่งตามหลัง 2 วัน (เผื่อเวลา 3 วัน)
];

const leaves: CalendarEvent[] = [
  { id: "l1", title: "Day-Off", type: "dayoff", start: "2026-09-22", end: "2026-09-23", allDay: true, userId: U },
  { id: "l2", title: "WFH", type: "leave", start: "2026-09-24", end: "2026-09-25", allDay: true, userId: U, requiresReports: true },
];
const holidays: CalendarEvent[] = [
  { id: "h1", title: "วันหยุดบริษัท", type: "holiday", start: "2026-09-21", end: "2026-09-22", allDay: true },
];
const exemptions = buildDateExemptions(leaves, holidays, { pickedDates: {}, rules: [], ruleExceptions: {} });
const lock = { useGlobalCutoff: false, time: "23:59" };

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T12:00:00"));
  useEmployeeStore.setState({ employees: users.map((u) => ({ ...u, avatarUrl: undefined })) as never });
  useReportPenaltySettingsStore.setState({ weeklyMonthlyGraceDays: 3 });
});
afterAll(() => vi.useRealTimers());

const cases: [string, ReportTopic, string, string, string][] = [
  ["25/09 Morning ส่ง 09:03", daily, "m", "2026-09-25", "late"],
  ["25/09 Evening ส่ง 17:05", daily, "e", "2026-09-25", "on-time"],
  ["26/09 Morning ไม่ส่ง", daily, "m", "2026-09-26", "missed"],
  ["22/09 Day-Off", daily, "m", "2026-09-22", "exempt"],
  ["24/09 WFH ไม่ส่ง (ยังต้องส่งรายงาน)", daily, "e", "2026-09-24", "missed"],
  ["21/09 วันหยุดบริษัท", daily, "m", "2026-09-21", "exempt"],
  ["25/09 Weekly ส่ง 27/09 (ในเผื่อเวลา)", weekly, "w", "2026-09-25", "late"],
  ["18/09 Weekly ไม่ส่งเลย", weekly, "w", "2026-09-18", "missed"],
  ["23/09 Weekly ไม่มีรอบวันนี้ (พุธ)", weekly, "w", "2026-09-23", "exempt"],
];

describe("dashboard and scoring judge every past round the same", () => {
  it.each(cases)("%s", (_label, topic, roundId, day, expected) => {
    const round = topic.submissionRounds!.find((r) => r.id === roundId)!;
    const client = roundComplianceStatus(topic, U, round, day, posts, exemptions);
    const server = roundComplianceStatusServer(topic, U, round, day, posts, [], users, exemptions, lock, 3);
    expect({ client, server }).toEqual({ client: expected, server: expected });
  });
});
