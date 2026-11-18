import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const db = { version: 1, data: [] as { id: string; userId: string }[], reads: 0 };
vi.mock("@/modules/report_task/lib/db/org-store", () => ({
  readStoreVersion: vi.fn(async () => db.version),
  readStore: vi.fn(async () => {
    db.reads++;
    return { data: db.data, version: db.version };
  }),
  ownNotifications: (data: unknown, userId: string) =>
    Array.isArray(data) ? data.filter((n: { userId: string }) => n.userId === userId) : data,
}));
vi.mock("@/modules/report_task/lib/db/employee-directory", () => ({ listDirectory: vi.fn() }));
vi.mock("@/modules/report_task/lib/db/departments", () => ({ listDepartmentsWithOverlay: vi.fn() }));

const { readStorePayload } = await import("./store-read");

describe("notifications shared read", () => {
  beforeEach(() => {
    db.version = 10;
    db.data = [{ id: "a", userId: "u1" }, { id: "b", userId: "u2" }];
    db.reads = 0;
  });

  it("parses once per version and still gives each user only their own", async () => {
    const r1 = await readStorePayload("org-x", "u1", "notifications");
    const r2 = await readStorePayload("org-x", "u2", "notifications");
    expect(r1).toEqual({ payload: [{ id: "a", userId: "u1" }], version: 10 });
    expect(r2).toEqual({ payload: [{ id: "b", userId: "u2" }], version: 10 });
    expect(db.reads).toBe(1);
  });

  it("re-reads as soon as the version moves (new notification shows up)", async () => {
    await readStorePayload("org-y", "u1", "notifications");
    db.version = 11;
    db.data = [...db.data, { id: "c", userId: "u1" }];
    const r = await readStorePayload("org-y", "u1", "notifications");
    expect(r.version).toBe(11);
    expect(r.payload).toEqual([{ id: "a", userId: "u1" }, { id: "c", userId: "u1" }]);
    expect(db.reads).toBe(2);
  });
});
