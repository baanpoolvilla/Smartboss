import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * บอร์ดงานแสดงเฉพาะใบงานซ่อมที่ "เกี่ยวกับตัวเอง" — ทุกคน รวม CEO / ผู้ดูแลระบบสูงสุด / คนที่มีสิทธิ์เห็นทั้งบริษัท
 * ("ถ้ามีอะไรเกี่ยวกับเค้าค่อยมาแสดงในนี้" · "ดูของคนอื่นๆด้วย ห้ามให้เกิดอีก") ใบอื่นไปดูที่โมดูลแจ้งซ่อม
 * และไม่มีใบสั่งซื้อ (PR/PO) บนบอร์ดเลย ไม่ว่าจะมีสิทธิ์อนุมัติหรือไม่
 */

const queries: { model: string; where: unknown }[] = [];
let viewAll = true;

vi.mock("@smartboss/database", () => ({
  prisma: {
    workOrder: {
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        queries.push({ model: "workOrder", where });
        return [];
      }),
    },
    purchaseOrder: {
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        queries.push({ model: "purchaseOrder", where });
        return [];
      }),
    },
    property: {
      findMany: vi.fn(async () => [{ id: "house-1" }]),
    },
  },
}));
vi.mock("@/modules/maintenance/data/work-order-access", async (orig) => {
  const real = await orig<typeof import("@/modules/maintenance/data/work-order-access")>();
  return {
    ...real,
    // คนที่มีสิทธิ์เห็นทั้งบริษัทในแจ้งซ่อม (CEO, ADMIN, ผู้ดูแลระบบสูงสุด) ได้ seeAll: true
    workOrderAccess: vi.fn(async (s: { userId: string }) =>
      viewAll ? { seeAll: true, userId: s.userId, caretakerPropertyIds: [] } : { seeAll: false, userId: s.userId, caretakerPropertyIds: ["house-1"] }
    ),
  };
});
vi.mock("./work-order-reactions", () => ({ listWorkOrderReactions: vi.fn(async () => []) }));

const { listMaintenanceBoardItems } = await import("./maintenance-board");

function session(roles: string[], perms: string[], superAdmin = false) {
  return {
    orgId: "org",
    userId: "me",
    roles,
    permissions: perms,
    isSuperAdmin: superAdmin,
  } as never;
}

const ALL_MAINT = ["maintenance.workorder.view", "maintenance.po.view", "maintenance.po.approve", "core.data.view_all"];

/** เงื่อนไขของ query ใบงานต้องมีตัวกรอง "เกี่ยวกับฉัน" เสมอ */
function expectRelatedOnly() {
  const wo = queries.find((q) => q.model === "workOrder");
  expect(wo).toBeDefined();
  const json = JSON.stringify(wo!.where);
  expect(json).toContain('"assignedTo":"me"');
  expect(json).toContain('"createdBy":"me"');
  expect(json).toContain('"ccUserIds":{"has":"me"}');
  // ผู้ดูแลบ้านเห็นใบของบ้านตัวเอง
  expect(json).toContain("house-1");
}

beforeEach(() => {
  queries.length = 0;
  viewAll = true;
});

describe("บอร์ดงาน — ใบงานซ่อมเฉพาะที่เกี่ยวกับตัวเอง", () => {
  it("CEO เห็นแค่ของตัวเอง ไม่ใช่ทั้งบริษัท", async () => {
    await listMaintenanceBoardItems(session(["CEO"], ALL_MAINT));
    expectRelatedOnly();
  });

  it("ผู้ดูแลระบบสูงสุด เห็นแค่ของตัวเอง", async () => {
    await listMaintenanceBoardItems(session(["SUPER_ADMIN"], ALL_MAINT, true));
    expectRelatedOnly();
  });

  it("แอดมินฝ่ายขายที่อนุมัติ PR ได้ เห็นแค่ของตัวเอง", async () => {
    await listMaintenanceBoardItems(session(["SALE_ADMIN"], ALL_MAINT));
    expectRelatedOnly();
  });

  it("พนักงานทั่วไป เห็นแค่ของตัวเอง", async () => {
    viewAll = false;
    await listMaintenanceBoardItems(session(["STAFF"], ["maintenance.workorder.view"]));
    expectRelatedOnly();
  });

  it("ไม่ดึงใบสั่งซื้อ (PR/PO) มาแสดงเลย แม้มีสิทธิ์อนุมัติ", async () => {
    await listMaintenanceBoardItems(session(["CEO"], ALL_MAINT));
    expect(queries.some((q) => q.model === "purchaseOrder")).toBe(false);
  });

  it("ไม่มีสิทธิ์ดูใบงาน = บอร์ดว่าง ไม่ query เลย", async () => {
    const items = await listMaintenanceBoardItems(session(["STAFF"], []));
    expect(items).toEqual([]);
    expect(queries).toHaveLength(0);
  });
});
