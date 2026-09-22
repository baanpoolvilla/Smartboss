import { beforeEach, describe, expect, it } from "vitest";
import { emptyPostFilters, filterPosts, postFiltersActiveCount, type PostFilters } from "@/modules/report_task/components/report-feed/post-filter-bar";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { User } from "@/modules/report_task/types";

/**
 * ตัวกรอง "แผนก" (สรุปงาน-รวมห้องรายงาน 2026-09-22, รอบแก้ที่ 3 — ยกเลิกแนว
 * ทางห้องรวม/สร้างห้องใหม่แล้ว ผู้ใช้ยืนยันให้ทำเป็นห้องจริงธรรมดา +
 * ป้ายแผนกของผู้โพสต์ + ตัวกรองแผนก) — กรองโพสต์ตามแผนกของ "ผู้โพสต์" อ่าน
 * departmentId จาก employee-store ผ่าน getUser (ไม่ใช่จาก topic)
 */
function post(overrides: Partial<ReportPost>): ReportPost {
  return {
    id: "p1",
    topicId: "t1",
    authorId: "u1",
    createdAt: new Date().toISOString(),
    editedAt: null,
    pinned: false,
    savedBy: [],
    unreadFor: [],
    reactions: {},
    replies: [],
    title: "",
    sections: [],
    images: [],
    tagIds: [],
    ...overrides,
  } as ReportPost;
}

const topic: ReportTopic = {
  id: "t1",
  name: "Daily-report",
  color: "#000",
  createdAt: new Date().toISOString(),
  minImages: 0,
  cutoffs: [],
};

const baseFilterOpts = {
  topicOf: () => topic,
  viewingAsUserId: "viewer",
  submitterGroups: [],
};

describe("filterPosts — departmentIds", () => {
  beforeEach(() => {
    const users: User[] = [
      { id: "u-hk", name: "แม่บ้าน คนที่ 1", avatar: "H", role: "พนักงาน", departmentId: "dep-hk" } as User,
      { id: "u-it", name: "ไอที คนที่ 1", avatar: "I", role: "พนักงาน", departmentId: "dep-it" } as User,
    ];
    useEmployeeStore.getState().setEmployees(users);
  });

  it("passes every post through when no department is selected", () => {
    const posts = [post({ id: "p1", authorId: "u-hk" }), post({ id: "p2", authorId: "u-it" })];
    const result = filterPosts(posts, emptyPostFilters, baseFilterOpts);
    expect(result.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("keeps only posts whose author is in a selected department", () => {
    const posts = [post({ id: "p1", authorId: "u-hk" }), post({ id: "p2", authorId: "u-it" })];
    const filters: PostFilters = { ...emptyPostFilters, departmentIds: new Set(["dep-hk"]) };
    const result = filterPosts(posts, filters, baseFilterOpts);
    expect(result.map((p) => p.id)).toEqual(["p1"]);
  });

  it("OR's across multiple selected departments", () => {
    const posts = [post({ id: "p1", authorId: "u-hk" }), post({ id: "p2", authorId: "u-it" })];
    const filters: PostFilters = { ...emptyPostFilters, departmentIds: new Set(["dep-hk", "dep-it"]) };
    const result = filterPosts(posts, filters, baseFilterOpts);
    expect(result.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("drops a post whose author has no resolvable department", () => {
    const posts = [post({ id: "p1", authorId: "deleted-user" })];
    const filters: PostFilters = { ...emptyPostFilters, departmentIds: new Set(["dep-hk"]) };
    expect(filterPosts(posts, filters, baseFilterOpts)).toEqual([]);
  });

  it("counts toward postFiltersActiveCount", () => {
    expect(postFiltersActiveCount({ ...emptyPostFilters, departmentIds: new Set(["dep-hk"]) })).toBe(1);
    expect(postFiltersActiveCount(emptyPostFilters)).toBe(0);
  });
});
