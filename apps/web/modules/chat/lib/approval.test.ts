import { describe, expect, it } from "vitest";

import { daysBetween, taskRequestStatus } from "./approval";

describe("taskRequestStatus", () => {
  const data = {
    dueDateRequests: [
      { id: "r1", status: "pending", requestedBy: "u1" },
      { id: "r2", status: "approved", requestedBy: "u1", decidedBy: "boss", decidedAt: "2026-11-18T03:00:00.000Z", decisionNote: "ok" },
    ],
  };

  it("reads a pending request", () => {
    expect(taskRequestStatus(data, "r1")).toEqual({ status: "pending" });
  });

  it("reads a decided request with who/when/note", () => {
    expect(taskRequestStatus(data, "r2")).toEqual({
      status: "approved",
      decidedBy: "boss",
      decidedAt: "2026-11-18T03:00:00.000Z",
      decisionNote: "ok",
    });
  });

  it("unknown id → null", () => {
    expect(taskRequestStatus(data, "nope")).toBeNull();
  });

  it("malformed data → null", () => {
    expect(taskRequestStatus(null, "r1")).toBeNull();
    expect(taskRequestStatus({ dueDateRequests: "x" }, "r1")).toBeNull();
    expect(taskRequestStatus({ dueDateRequests: [{ id: "r1", status: "weird" }] }, "r1")).toBeNull();
  });
});

describe("daysBetween", () => {
  it("counts calendar days between YYYY-MM-DD / ISO dates", () => {
    expect(daysBetween("2026-11-17", "2026-11-24")).toBe(7);
    expect(daysBetween("2026-11-17T16:59:59.999Z", "2026-11-19T16:59:59.999Z")).toBe(2);
  });
  it("missing date → null", () => {
    expect(daysBetween(null, "2026-11-24")).toBeNull();
  });
});
