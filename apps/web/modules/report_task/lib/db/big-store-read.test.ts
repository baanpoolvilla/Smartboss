import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * ก้อนใหญ่ (report-feed / notifications / activity-log) อ่านผ่านชุดที่จำไว้ — ผลต้องเหมือนอ่านฐานข้อมูลตรงทุกครั้ง
 */
vi.mock("server-only", () => ({}));

const rows = new Map<string, { data: unknown; version: number; updatedAt: Date }>();
let dataReads = 0;
let tick = 1;

vi.mock("@smartboss/database", () => ({
  prisma: {
    reportTaskStore: {
      findUnique: vi.fn(async ({ where, select }: { where: { orgId_key: { orgId: string; key: string } }; select?: { data?: boolean } }) => {
        const row = rows.get(`${where.orgId_key.orgId}:${where.orgId_key.key}`);
        if (!row) return null;
        if (select?.data) {
          dataReads++;
          return { data: JSON.parse(JSON.stringify(row.data)), version: row.version, updatedAt: row.updatedAt };
        }
        return { version: row.version, updatedAt: row.updatedAt };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { orgId: string; key: string; version: number }; data: { data: unknown } }) => {
        const k = `${where.orgId}:${where.key}`;
        const row = rows.get(k);
        if (!row || row.version !== where.version) return { count: 0 };
        rows.set(k, { data: data.data, version: row.version + 1, updatedAt: new Date(tick++) });
        return { count: 1 };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { orgId: string; key: string } }) => {
        rows.delete(`${where.orgId}:${where.key}`);
        return { count: 1 };
      }),
    },
  },
}));
vi.mock("@/lib/notify-push", () => ({ announceNotification: vi.fn() }));
vi.mock("@/lib/realtime/server", () => ({ publishToOrg: vi.fn(), publishToUsers: vi.fn() }));
vi.mock("@/modules/chat/data/task-cards", () => ({ postTaskCard: vi.fn() }));
vi.mock("@/modules/chat/data/approval-cards", () => ({ postTaskDueRequestCard: vi.fn(), postTaskReviewCard: vi.fn() }));
vi.mock("@/lib/notification-prefs", () => ({ loadNotificationPrefs: vi.fn(async () => new Map()) }));

const { readStore, writeStore, clearStore } = await import("./org-store");

beforeEach(() => {
  rows.clear();
  dataReads = 0;
  (globalThis as { __bigStoreRead?: Map<string, unknown> }).__bigStoreRead?.clear();
  rows.set("o:report-feed", { data: { posts: [{ id: "p1" }] }, version: 3, updatedAt: new Date(tick++) });
});

describe("อ่านก้อนใหญ่ผ่านชุดที่จำไว้", () => {
  it("อ่านซ้ำรุ่นเดิม = ไม่ดึงก้อนจากฐานข้อมูลอีก แต่ได้ข้อมูลเท่าเดิม", async () => {
    const a = await readStore<{ posts: { id: string }[] }>("o", "report-feed");
    const b = await readStore<{ posts: { id: string }[] }>("o", "report-feed");
    expect(dataReads).toBe(1);
    expect(b).toEqual(a);
  });

  it("ผู้เรียกแก้ของที่ได้ไป ไม่กระทบการอ่านครั้งถัดไป", async () => {
    const a = await readStore<{ posts: { id: string }[] }>("o", "report-feed");
    a.data!.posts.push({ id: "hack" });
    const b = await readStore<{ posts: { id: string }[] }>("o", "report-feed");
    b.data!.posts[0]!.id = "changed";
    const c = await readStore<{ posts: { id: string }[] }>("o", "report-feed");
    expect(c.data).toEqual({ posts: [{ id: "p1" }] });
  });

  it("เขียนแล้ว (ทางนี้หรือโปรเซสอื่น) อ่านได้ของใหม่", async () => {
    await readStore("o", "report-feed");
    await writeStore("o", "report-feed", { posts: [{ id: "p2" }] }, 3);
    expect((await readStore("o", "report-feed")).data).toEqual({ posts: [{ id: "p2" }] });
    rows.set("o:report-feed", { data: { posts: [{ id: "other" }] }, version: 5, updatedAt: new Date(tick++) });
    expect(await readStore("o", "report-feed")).toEqual({ data: { posts: [{ id: "other" }] }, version: 5 });
  });

  it("ล้างคีย์แล้วสร้างใหม่ด้วยเลขรุ่นเดิม ไม่ได้ของเก่าที่จำไว้", async () => {
    await readStore("o", "report-feed");
    await clearStore("o", "report-feed");
    expect(await readStore("o", "report-feed")).toEqual({ data: null, version: 0 });
    rows.set("o:report-feed", { data: { posts: [] }, version: 3, updatedAt: new Date(tick++) });
    expect((await readStore("o", "report-feed")).data).toEqual({ posts: [] });
  });

  it("คีย์เล็กอ่านตรงเหมือนเดิม", async () => {
    rows.set("o:projects", { data: [1], version: 1, updatedAt: new Date(tick++) });
    await readStore("o", "projects");
    await readStore("o", "projects");
    expect(dataReads).toBe(2);
  });
});
