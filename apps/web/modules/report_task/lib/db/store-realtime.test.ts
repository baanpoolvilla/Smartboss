import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * อัปเดตสด: บันทึกสำเร็จแล้วต้องประกาศ store.changed ผ่านท่อสดถึงทั้งบริษัท
 * (ไม่ใช่รอให้แท็บอื่น poll) และ GET ที่ถือรุ่นล่าสุดอยู่แล้วต้องได้ 204 ไม่มี body
 */

const rows = new Map<string, { data: unknown; version: number }>();

vi.mock("@smartboss/database", () => ({
  prisma: {
    reportTaskStore: {
      findUnique: vi.fn(async ({ where, select }: { where: { orgId_key: { orgId: string; key: string } }; select?: Record<string, boolean> }) => {
        const row = rows.get(`${where.orgId_key.orgId}:${where.orgId_key.key}`);
        if (!row) return null;
        return select?.data ? row : { version: row.version };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { orgId: string; key: string; version: number }; data: { data: unknown } }) => {
        const k = `${where.orgId}:${where.key}`;
        const row = rows.get(k);
        if (!row || row.version !== where.version) return { count: 0 };
        rows.set(k, { data: data.data, version: row.version + 1 });
        return { count: 1 };
      }),
      upsert: vi.fn(async ({ where, create }: { where: { orgId_key: { orgId: string; key: string } }; create: { data: unknown } }) => {
        const k = `${where.orgId_key.orgId}:${where.orgId_key.key}`;
        const row = rows.get(k);
        const next = { data: create.data, version: (row?.version ?? 0) + 1 };
        rows.set(k, next);
        return { version: next.version };
      }),
    },
  },
}));
vi.mock("@/lib/notify-push", () => ({ announceNotification: vi.fn() }));
vi.mock("@smartboss/auth", () => ({ requireOrg: vi.fn(async () => ({ orgId: "org-1", userId: "u-1" })) }));

const { writeStore } = await import("./org-store");
const { subscribeUser } = await import("@/lib/realtime/server");
const { GET } = await import("@/app/api/report-task/store/[key]/route");

function collect(orgId: string) {
  const events: unknown[] = [];
  const off = subscribeUser("listener", orgId, (e) => events.push(e));
  return { events, off };
}
const get = (key: string, known?: string) =>
  GET(
    new Request(`http://x/api/report-task/store/${key}`, { headers: known ? { "X-Known-Version": known } : {} }) as never,
    { params: Promise.resolve({ key }) }
  );

beforeEach(() => {
  rows.clear();
  rows.set("org-1:report-feed", { data: { topics: [], posts: [] }, version: 7 });
});

describe("store.changed ผ่านท่อสด", () => {
  it("บันทึกสำเร็จ → ทั้งบริษัทได้ { key, version } ใหม่ (ไม่มีข้อมูลติดไป)", async () => {
    const { events, off } = collect("org-1");
    const r = await writeStore("org-1", "report-feed", { topics: [], posts: [{ id: "p1" }] }, 7, "u-1");
    off();
    expect(r).toEqual({ ok: true, version: 8 });
    expect(events).toEqual([{ type: "store.changed", key: "report-feed", version: 8 }]);
  });

  it("บันทึกชนกัน (409) → ไม่ประกาศ", async () => {
    const { events, off } = collect("org-1");
    const r = await writeStore("org-1", "report-feed", { posts: [] }, 3, "u-1");
    off();
    expect(r.ok).toBe(false);
    expect(events).toEqual([]);
  });

  it("บริษัทอื่นไม่ได้ยิน", async () => {
    const { events, off } = collect("org-2");
    await writeStore("org-1", "report-feed", { posts: [] }, 7, "u-1");
    off();
    expect(events).toEqual([]);
  });

  it("แจ้งเตือนก็ประกาศเหมือนกัน", async () => {
    const { events, off } = collect("org-1");
    await writeStore("org-1", "notifications", [], null, "u-1");
    off();
    expect(events).toEqual([{ type: "store.changed", key: "notifications", version: 1 }]);
  });
});

describe("GET พร้อม X-Known-Version", () => {
  it("รุ่นเดิม → 204 ไม่มี body", async () => {
    const res = await get("report-feed", "7");
    expect(res.status).toBe(204);
    expect(res.headers.get("X-Data-Version")).toBe("7");
    expect(await res.text()).toBe("");
  });

  it("รุ่นเก่ากว่า → ได้ข้อมูลเต็ม + รุ่นใหม่", async () => {
    const res = await get("report-feed", "6");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Data-Version")).toBe("7");
    expect(await res.json()).toEqual({ topics: [], posts: [] });
  });

  it("ไม่ส่งรุ่นมา (โหลดครั้งแรก) → ได้ข้อมูลเต็ม", async () => {
    const res = await get("report-feed");
    expect(res.status).toBe(200);
  });

  it("คีย์ลา/วันหยุด (รุ่นคงที่ 1) ที่ถือ 1 อยู่ → 204 โดยไม่แตะฐานข้อมูล HR", async () => {
    const res = await get("leaves", "1");
    expect(res.status).toBe(204);
  });
});
