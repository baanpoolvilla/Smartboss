import { beforeAll, describe, expect, it } from "vitest";
import { canEditRecord, canEditReportTopic, canReviewTaskRecord, canSeeReportTopic, canSeeTask, canToggleOwnChecklistItem } from "@/modules/report_task/lib/permissions";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import type { Department, User } from "@/modules/report_task/types";
import { setSessionOwner } from "@/modules/report_task/lib/directory";

// usr-01 heads dep-eng, usr-15 is the owner — fixtures of this test only (the app no longer ships demo people).
const ENG_HEAD = "usr-01";
const OTHER_ENG = "usr-02";
const DESIGN_HEAD = "usr-04";
const OWNER = "usr-15";

// แผนกและคนโหลดจากเซิร์ฟเวอร์ (store เริ่มว่าง) — ใส่ที่เทสต์อ้างถึงเอง
beforeAll(() => {
  const person = (id: string, departmentId: string, isOwner = false): User =>
    ({ id, name: id, email: `${id}@test`, avatar: "", role: "", departmentId, ...(isOwner ? { isOwner } : {}) }) as User;
  useEmployeeStore.setState({
    employees: [
      person("usr-01", "dep-eng"),
      person("usr-02", "dep-eng"),
      person("usr-03", "dep-eng"),
      person("usr-04", "dep-design"),
      person("usr-06", "dep-marketing"),
      person("usr-15", "dep-eng", true),
    ],
  });
  useDepartmentStore.setState({
    departments: [
      { id: "dep-eng", name: "Engineering", headId: ENG_HEAD },
      { id: "dep-design", name: "Design", headId: DESIGN_HEAD },
    ] as Department[],
  });
});

describe("canEditRecord", () => {
  it("lets the owner edit anything", () => {
    expect(canEditRecord(OTHER_ENG, ["dep-eng"], OWNER)).toBe(true);
  });

  it("lets the creator edit their own record", () => {
    expect(canEditRecord(OTHER_ENG, ["dep-eng"], OTHER_ENG)).toBe(true);
  });

  it("lets a department head edit a record touching their department", () => {
    expect(canEditRecord(OTHER_ENG, ["dep-eng"], ENG_HEAD)).toBe(true);
  });

  it("blocks a head of an unrelated department", () => {
    expect(canEditRecord(OTHER_ENG, ["dep-eng"], DESIGN_HEAD)).toBe(false);
  });

  it("blocks a non-creator, non-head, non-owner", () => {
    expect(canEditRecord(ENG_HEAD, ["dep-eng"], "usr-03")).toBe(false);
  });
});

describe("canToggleOwnChecklistItem", () => {
  it("lets the owner toggle their own item", () => {
    expect(canToggleOwnChecklistItem({ id: "c1", text: "x", done: false, ownerId: OTHER_ENG }, OTHER_ENG)).toBe(true);
  });

  it("blocks a teammate from toggling someone else's item", () => {
    expect(canToggleOwnChecklistItem({ id: "c1", text: "x", done: false, ownerId: OTHER_ENG }, ENG_HEAD)).toBe(false);
  });

  it("lets the company-wide owner (CEO) toggle anyone's item", () => {
    expect(canToggleOwnChecklistItem({ id: "c1", text: "x", done: false, ownerId: OTHER_ENG }, OWNER)).toBe(true);
  });
});

describe("canEditReportTopic", () => {
  it("lets the owner edit any room, even a company-wide one", () => {
    expect(canEditReportTopic(undefined, OWNER)).toBe(true);
    expect(canEditReportTopic({ departmentIds: ["dep-design"] }, OWNER)).toBe(true);
  });

  it("lets a department head edit a room scoped to their own department", () => {
    expect(canEditReportTopic({ departmentIds: ["dep-eng"] }, ENG_HEAD)).toBe(true);
  });

  it("blocks a department head from a room scoped to another department", () => {
    expect(canEditReportTopic({ departmentIds: ["dep-design"] }, ENG_HEAD)).toBe(false);
  });

  it("blocks a department head from a company-wide room (no department scoping)", () => {
    expect(canEditReportTopic(undefined, ENG_HEAD)).toBe(false);
  });

  it("blocks a department head from a manager-only or person-specific room", () => {
    expect(canEditReportTopic({ managerOnly: true }, ENG_HEAD)).toBe(false);
    expect(canEditReportTopic({ userIds: [ENG_HEAD] }, ENG_HEAD)).toBe(false);
  });

  it("blocks a plain member of the department who isn't its head", () => {
    expect(canEditReportTopic({ departmentIds: ["dep-eng"] }, OTHER_ENG)).toBe(false);
  });
});

describe("canSeeReportTopic", () => {
  it("lets an outsider see a department room if listed in extraUserIds", () => {
    expect(canSeeReportTopic({ departmentIds: ["dep-eng"], extraUserIds: [DESIGN_HEAD] }, DESIGN_HEAD)).toBe(true);
  });

  it("still blocks an outsider not in the department or extraUserIds", () => {
    expect(canSeeReportTopic({ departmentIds: ["dep-eng"], extraUserIds: [DESIGN_HEAD] }, "usr-06")).toBe(false);
  });

  it("lets a department member see it regardless of extraUserIds", () => {
    expect(canSeeReportTopic({ departmentIds: ["dep-eng"], extraUserIds: [] }, OTHER_ENG)).toBe(true);
  });
});

describe("canSeeTask — personal tasks", () => {
  const personal = { assignedById: OTHER_ENG, assigneeIds: [OTHER_ENG], departmentIds: ["dep-eng"] };
  it("only its creator sees a task they opened for themselves — not the owner or their department head", () => {
    expect(canSeeTask(personal, OTHER_ENG)).toBe(true);
    expect(canSeeTask(personal, OWNER)).toBe(false);
    expect(canSeeTask(personal, ENG_HEAD)).toBe(false);
  });
  it("becomes a normal task as soon as someone else is added", () => {
    expect(canSeeTask({ ...personal, assigneeIds: [OTHER_ENG, "usr-03"] }, OWNER)).toBe(true);
  });
});

// 20/10/2569: CEO ตรวจ (ผ่าน/ไม่ผ่าน) เฉพาะงานที่ตัวเองมอบหมาย — ยังเห็นทุกงานบนบอร์ดเหมือนเดิม
describe("canReviewTaskRecord", () => {
  const S = { headsCanReview: true, extraReviewerIds: [] as string[] };
  it("CEO ตรวจงานที่ตัวเองมอบหมายได้", () => {
    expect(canReviewTaskRecord({ departmentIds: ["dep-eng"], assignedById: OWNER }, OWNER, S)).toBe(true);
  });
  it("CEO ตรวจงานที่คนอื่นมอบหมายไม่ได้ ถ้ามีหัวหน้าแผนกตรวจแทนได้", () => {
    expect(canReviewTaskRecord({ departmentIds: ["dep-eng"], assignedById: ENG_HEAD }, OWNER, S)).toBe(false);
  });
  it("งานที่ไม่มีใครตรวจได้ (แผนกไม่มีหัวหน้า + คนมอบหมายเป็นผู้รับผิดชอบเอง) → CEO ยังตรวจได้ กันงานค้าง", () => {
    expect(canReviewTaskRecord({ departmentIds: ["dep-marketing"], assignedById: OTHER_ENG, assigneeIds: [OTHER_ENG] }, OWNER, S)).toBe(true);
    expect(canReviewTaskRecord({ departmentIds: [], assignedById: OTHER_ENG, assigneeIds: [OTHER_ENG] }, OWNER, S)).toBe(true);
  });
  it("แผนกไม่มีหัวหน้า แต่คนมอบหมายตรวจได้ → ไม่ตกมาที่ CEO", () => {
    expect(canReviewTaskRecord({ departmentIds: ["dep-marketing"], assignedById: OTHER_ENG, assigneeIds: ["usr-03"] }, OWNER, S)).toBe(false);
    expect(canReviewTaskRecord({ departmentIds: [], assignedById: OTHER_ENG }, OWNER, S)).toBe(false);
  });
  it("ผู้ดูแลระบบสูงสุด (SUPER_ADMIN ที่ล็อกอิน) ตรวจได้ทุกงาน", () => {
    setSessionOwner("usr-sa");
    try {
      expect(canReviewTaskRecord({ departmentIds: ["dep-eng"], assignedById: ENG_HEAD }, "usr-sa", S)).toBe(true);
      expect(canReviewTaskRecord({ departmentIds: ["dep-eng"], assignedById: ENG_HEAD }, OWNER, S)).toBe(false);
    } finally {
      setSessionOwner(null);
    }
  });
  it("มีผู้ตรวจที่ตั้งไว้ → CEO ไม่ต้องรับงานที่ไม่มีหัวหน้า", () => {
    expect(canReviewTaskRecord({ departmentIds: ["dep-marketing"], assignedById: OTHER_ENG }, OWNER, { headsCanReview: true, extraReviewerIds: ["usr-06"] })).toBe(false);
  });
  it("หัวหน้าแผนก / ผู้ตรวจที่ตั้งไว้ เหมือนเดิม", () => {
    expect(canReviewTaskRecord({ departmentIds: ["dep-eng"], assignedById: OTHER_ENG }, ENG_HEAD, S)).toBe(true);
    expect(canReviewTaskRecord({ departmentIds: ["dep-eng"], assignedById: OTHER_ENG }, DESIGN_HEAD, S)).toBe(false);
    expect(canReviewTaskRecord({ departmentIds: ["dep-eng"], assignedById: OTHER_ENG }, "usr-06", { headsCanReview: true, extraReviewerIds: ["usr-06"] })).toBe(true);
    expect(canReviewTaskRecord({ departmentIds: ["dep-eng"], assignedById: ENG_HEAD }, OTHER_ENG, S)).toBe(false);
  });
  // 20/10/2569: คนมอบหมายงาน (ไม่ใช่หัวหน้า) ตรวจงานที่ตัวเองมอบหมายได้ — แต่ไม่ใช่งานที่ตัวเองทำด้วย
  it("คนมอบหมายงานตรวจได้ ยกเว้นตัวเองเป็นผู้รับผิดชอบด้วย", () => {
    expect(canReviewTaskRecord({ departmentIds: ["dep-eng"], assignedById: OTHER_ENG, assigneeIds: ["usr-03"] }, OTHER_ENG, S)).toBe(true);
    expect(canReviewTaskRecord({ departmentIds: ["dep-eng"], assignedById: OTHER_ENG, assigneeIds: ["usr-03", OTHER_ENG] }, OTHER_ENG, S)).toBe(false);
    expect(canReviewTaskRecord({ departmentIds: ["dep-eng"], assignedById: OTHER_ENG, assigneeIds: ["usr-03"] }, "usr-03", S)).toBe(false);
  });
});
