import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@smartboss/database", () => ({ prisma: {} }));

import { sameTaskData } from "./task-repo";

describe("sameTaskData", () => {
  it("ignores key order, because jsonb does not keep it", () => {
    expect(sameTaskData({ a: 1, b: { x: [1, { p: 1, q: 2 }], y: 2 } }, { b: { y: 2, x: [1, { q: 2, p: 1 }] }, a: 1 })).toBe(true);
  });
  it("treats an undefined field as absent", () => {
    expect(sameTaskData({ a: 1 }, { a: 1, b: undefined })).toBe(true);
  });
  it("sees a real change, including deep and array order", () => {
    expect(sameTaskData({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(sameTaskData({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameTaskData({ a: 1 }, { a: 1, b: null })).toBe(false);
  });
  it("a task with no prior row is never the same", () => {
    expect(sameTaskData(undefined, { a: 1 })).toBe(false);
  });
});
