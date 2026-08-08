import { describe, expect, it } from "vitest";
import { canEditRecord, canDockPenalty, canEditReportTopic, canSeeReportTopic } from "@/modules/report_task/lib/permissions";

// Fixtures from src/data/mock.ts: usr-01 heads dep-eng, usr-15 is the owner.
const ENG_HEAD = "usr-01";
const OTHER_ENG = "usr-02";
const DESIGN_HEAD = "usr-04";
const OWNER = "usr-15";

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

describe("canDockPenalty", () => {
  it("lets the owner dock", () => {
    expect(canDockPenalty(OTHER_ENG, ["dep-eng"], OWNER)).toBe(true);
  });

  it("lets whoever assigned the task dock it, even if not a head", () => {
    expect(canDockPenalty(OTHER_ENG, ["dep-eng"], OTHER_ENG)).toBe(true);
  });

  it("lets a department head dock a task touching their department", () => {
    expect(canDockPenalty(OTHER_ENG, ["dep-eng"], ENG_HEAD)).toBe(true);
  });

  it("blocks an unrelated employee", () => {
    expect(canDockPenalty(ENG_HEAD, ["dep-eng"], "usr-03")).toBe(false);
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
