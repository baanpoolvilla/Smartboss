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
let sessionUser = "u-1";
vi.mock("@smartboss/auth", () => ({ requireOrg: vi.fn(async () => ({ orgId: "org-1", userId: sessionUser })) }));

const { writeStore, pruneNotifications } = await import("./org-store");
const { subscribeUser } = await import("@/lib/realtime/server");
const { GET, PUT } = await import("@/app/api/report-task/store/[key]/route");

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
  sessionUser = "u-1";
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

  it("แจ้งเตือนประกาศเฉพาะเจ้าของ ไม่ใช่ทั้งบริษัท", async () => {
    const { events, off } = collect("org-1"); // ฟังในนาม "listener"
    await writeStore("org-1", "notifications", [{ id: "x", userId: "someone-else", createdAt: new Date().toISOString() }], null, "u-1");
    expect(events).toEqual([]);
    await writeStore("org-1", "notifications", [{ id: "y", userId: "listener", createdAt: new Date().toISOString() }], 1, "u-1");
    off();
    // ก้อนที่สองไม่มี "x" แล้ว (เจ้าของ someone-else) + มี "y" ของ listener ⇒ listener ได้ยินแค่ของตัวเอง
    expect(events).toEqual([{ type: "store.changed", key: "notifications", version: 2 }]);
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

// ─── แจ้งเตือน: ของใครของมัน ───────────────────────────────────────────────
const recent = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const n = (id: string, userId: string, extra: Record<string, unknown> = {}) => ({
  id, userId, byUserId: "x", message: id, createdAt: recent(10), read: false, ...extra,
});
const put = (key: string, data: unknown, expectedVersion: number | null) =>
  PUT(
    new Request(`http://x/api/report-task/store/${key}`, { method: "PUT", body: JSON.stringify({ data, expectedVersion }) }) as never,
    { params: Promise.resolve({ key }) }
  );
const stored = () => rows.get("org-1:notifications")!.data as { id: string; userId: string; read: boolean }[];

describe("แจ้งเตือน — ส่ง/รับเฉพาะของตัวเอง", () => {
  beforeEach(() => {
    rows.set("org-1:notifications", {
      data: [n("a1", "u-1"), n("b1", "u-2"), n("c1", "u-3", { message: "หักคะแนน" })],
      version: 5,
    });
  });

  it("GET ได้แค่ของตัวเอง ของคนอื่นไม่ออกจากเซิร์ฟเวอร์", async () => {
    const res = await get("notifications");
    const body = (await res.json()) as { id: string }[];
    expect(body.map((x) => x.id)).toEqual(["a1"]);
  });

  it("อ่านแล้ว + สร้างแจ้งเตือนใหม่ให้คนอื่น → ของคนอื่นเดิมอยู่ครบ ของใหม่ถูกเพิ่ม", async () => {
    const res = await put("notifications", [n("a1", "u-1", { read: true }), n("new-b", "u-2")], 5);
    expect(res.status).toBe(200);
    const ids = stored().map((x) => x.id).sort();
    expect(ids).toEqual(["a1", "b1", "c1", "new-b"]);
    expect(stored().find((x) => x.id === "a1")!.read).toBe(true);
  });

  it("แก้แจ้งเตือนของคนอื่นที่มีอยู่แล้วไม่ได้", async () => {
    await put("notifications", [n("a1", "u-1"), n("b1", "u-2", { read: true, message: "ปลอม" })], 5);
    const b1 = stored().find((x) => x.id === "b1") as unknown as { read: boolean; message: string };
    expect(b1.read).toBe(false);
    expect(b1.message).toBe("b1");
  });

  it("รุ่นล่าสุด: ลบของตัวเองได้", async () => {
    await put("notifications", [], 5);
    expect(stored().map((x) => x.id).sort()).toEqual(["b1", "c1"]);
  });

  it("รุ่นเก่า (มีแจ้งเตือนใหม่เข้ามาหลังเครื่องโหลด) → ไม่ลบของที่เครื่องยังไม่เห็น", async () => {
    rows.set("org-1:notifications", { data: [...stored(), n("a2-new", "u-1")], version: 6 });
    await put("notifications", [n("a1", "u-1", { read: true })], 5);
    const mine = stored().filter((x) => x.userId === "u-1").map((x) => x.id).sort();
    expect(mine).toEqual(["a1", "a2-new"]);
  });

  it("รุ่นเก่าส่ง 'ยังไม่อ่าน' มา → อ่านแล้วไม่ย้อนกลับ", async () => {
    rows.set("org-1:notifications", { data: [n("a1", "u-1", { read: true }), n("b1", "u-2")], version: 6 });
    await put("notifications", [n("a1", "u-1", { read: false })], 5);
    expect(stored().find((x) => x.id === "a1")!.read).toBe(true);
  });

  it("อัปเดตสดไปถึงเฉพาะคนที่ได้แจ้งเตือนใหม่", async () => {
    const forB: unknown[] = [];
    const forC: unknown[] = [];
    const offB = subscribeUser("u-2", "org-x", (e) => forB.push(e));
    const offC = subscribeUser("u-3", "org-x", (e) => forC.push(e));
    await put("notifications", [n("a1", "u-1"), n("new-b", "u-2")], 5);
    offB();
    offC();
    expect(forB).toEqual([{ type: "store.changed", key: "notifications", version: 6 }]);
    expect(forC).toEqual([]);
  });
});

describe("ล้างแจ้งเตือนเก่า", () => {
  it("เกิน 60 วันถูกลบ ไม่เกินเก็บไว้", () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    const out = pruneNotifications(
      [
        { id: "old", userId: "u", createdAt: "2026-07-01T00:00:00Z" },
        { id: "ok", userId: "u", createdAt: "2026-09-01T00:00:00Z" },
      ],
      now
    ) as { id: string }[];
    expect(out.map((x) => x.id)).toEqual(["ok"]);
  });

  it("เกิน 300 ต่อคน เก็บ 300 อันใหม่สุด (คนอื่นไม่โดนตัด)", () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    const many = Array.from({ length: 305 }, (_, i) => ({
      id: `m${i}`, userId: "u", createdAt: new Date(now - i * 60_000).toISOString(),
    }));
    const out = pruneNotifications([...many, { id: "other", userId: "v", createdAt: new Date(now).toISOString() }], now) as { id: string; userId: string }[];
    expect(out.filter((x) => x.userId === "u")).toHaveLength(300);
    expect(out.some((x) => x.id === "m0")).toBe(true);
    expect(out.some((x) => x.id === "m304")).toBe(false);
    expect(out.some((x) => x.id === "other")).toBe(true);
  });
});
