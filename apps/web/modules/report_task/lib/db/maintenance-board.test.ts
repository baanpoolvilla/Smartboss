import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * บอร์ดงานแสดงเฉพาะใบงานซ่อมที่ "เกี่ยวกับตัวเอง" — ยกเว้นผู้ดูแลระบบสูงสุด และ CEO (ตั้งแต่ 19/10/2569 ไว้ดูภาระงาน)
 * ยกเว้นผู้ดูแลระบบสูงสุดคนเดียวที่เห็นทุกใบ ("ผู้ดูแลสูงสุดคือคนดูระบบ มันต้องเห็นได้หมด")
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
  // เปลี่ยน 19/10/2569: CEO เห็นทุกใบ เพื่อดูภาระงานของแต่ละคน (task + ใบงานซ่อม) — แจ้งเตือนไม่เปลี่ยน
  it("CEO เห็นทุกใบ (ไว้ดูภาระงานของแต่ละคน)", async () => {
    await listMaintenanceBoardItems(session(["CEO"], ALL_MAINT));
    const json = JSON.stringify(queries.find((q) => q.model === "workOrder")!.where);
    expect(json).not.toContain('"assignedTo":"me"');
    expect(json).not.toContain('"createdBy":"me"');
  });

  // เปลี่ยน 20/10/2569: CEO เห็นทุกใบแม้ไม่มีสิทธิ์ "เห็นทั้งบริษัท" ในแจ้งซ่อม — เดิมเห็นแค่ของตัวเอง (ใบเดียว)
  // ("ceo เห็นใบงานแจ้งซ่อมทั้งหมด ... จะได้รู้งานของแต่ละคน") · ยังต้องมีสิทธิ์ดูใบงาน (maintenance.workorder.view)
  it("CEO ที่ไม่มีสิทธิ์เห็นทั้งบริษัทในแจ้งซ่อม ก็เห็นทุกใบบนบอร์ดงาน", async () => {
    viewAll = false;
    await listMaintenanceBoardItems(session(["CEO"], ["maintenance.workorder.view"]));
    const json = JSON.stringify(queries.find((q) => q.model === "workOrder")!.where);
    expect(json).not.toContain('"assignedTo":"me"');
    expect(json).not.toContain('"createdBy":"me"');
  });

  it("ผู้ดูแลระบบสูงสุด เห็นทุกใบ (ไม่มีตัวกรองคน)", async () => {
    await listMaintenanceBoardItems(session(["SUPER_ADMIN"], ALL_MAINT, true));
    const json = JSON.stringify(queries.find((q) => q.model === "workOrder")!.where);
    expect(json).not.toContain('"assignedTo":"me"');
    expect(json).not.toContain('"createdBy":"me"');
  });

  it("ADMIN (IT) ที่ไม่ใช่ผู้ดูแลระบบสูงสุด เห็นแค่ของตัวเอง", async () => {
    await listMaintenanceBoardItems(session(["ADMIN"], ALL_MAINT));
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
