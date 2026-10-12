import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * คะแนนจากสติกเกอร์ — โพสต์รายงาน (เลือกคนโดนได้) และการ์ดใบงานซ่อม
 * ทุกเคสต้องลง core.performance_events ถูกคน ถูกแต้ม และยกเลิกแล้วคืนให้คนเดิม
 */

interface Ev {
  userId: string;
  points?: number;
  refType?: string;
  refId?: string;
  occurredAt: Date;
  note?: string;
  createdBy?: string;
}
const recorded: Ev[] = [];
const stores = new Map<string, { data: unknown; version: number }>();
let workOrder: { id: string; code: string; title: string; assignedTo: string | null; status: string } | null = null;

vi.mock("@/lib/performance", () => ({
  recordPerformanceEvents: vi.fn(async (evs: Ev[]) => {
    recorded.push(...evs);
  }),
}));
vi.mock("@smartboss/database", () => ({
  prisma: {
    performanceEvent: {
      findMany: vi.fn(async ({ where }: { where: { refType: string; refId: { in: string[] } } }) =>
        recorded
          .filter((e) => e.refType === where.refType && where.refId.in.includes(e.refId!))
          .map((e) => ({ refId: e.refId, occurredAt: e.occurredAt }))
      ),
      findFirst: vi.fn(async ({ where }: { where: { refType: string; refId: string } }) => {
        const e = recorded.find((x) => x.refType === where.refType && x.refId === where.refId);
        return e ? { occurredAt: e.occurredAt, points: e.points, userId: e.userId, note: e.note } : null;
      }),
    },
    workOrder: { findFirst: vi.fn(async () => workOrder) },
  },
}));
vi.mock("./org-store", () => ({
  readStore: vi.fn(async (_org: string, key: string) => stores.get(key) ?? { data: null, version: 0 }),
  writeStore: vi.fn(async (_org: string, key: string, data: unknown, version: number) => {
    const cur = stores.get(key);
    if ((cur?.version ?? 0) !== version) return { ok: false, conflict: true, currentVersion: cur?.version ?? 0 };
    stores.set(key, { data, version: version + 1 });
    return { ok: true, version: version + 1 };
  }),
  createStoreIfAbsent: vi.fn(async (_org: string, key: string, data: unknown) => {
    stores.set(key, { data, version: 1 });
    return { ok: true, version: 1 };
  }),
}));
vi.mock("./employee-directory", () => ({
  listDirectory: vi.fn(async () => [
    { id: "ceo", name: "CEO", isOwner: true, isCeo: true },
    { id: "head", name: "หัวหน้า", isOwner: true },
    { id: "author", name: "คนโพสต์" },
    { id: "aui", name: "Aui" },
    { id: "staff", name: "พนักงาน" },
  ]),
}));

const { recordReportStickerEvents } = await import("./report-feed-performance");
const { addWorkOrderReaction, removeWorkOrderReaction, ReactionError } = await import("./work-order-reactions");

// หัวร้อนตั้งไว้ -2 ในบริษัทนี้ (แบบในรูปจริง) · ด่วนมาก 0
const STICKERS = [
  { id: "angry", emoji: "😡", label: "หัวร้อน", points: -2 },
  { id: "fire", emoji: "🔥", label: "ด่วนมาก", points: 0 },
  { id: "star", emoji: "⭐", label: "ผลงานเด่น", points: 3 },
];

interface R {
  id: string;
  stickerId: string;
  byUserId: string;
  createdAt: string;
  targetUserId?: string;
}
const post = (reactions: R[]) => ({
  posts: [{ id: "p1", title: "PVC เคสM5", authorId: "author", stickerReactions: reactions }],
});
const r = (id: string, stickerId: string, byUserId: string, targetUserId?: string): R => ({
  id,
  stickerId,
  byUserId,
  createdAt: "2026-10-11T14:00:00.000Z",
  ...(targetUserId ? { targetUserId } : {}),
});

beforeEach(() => {
  recorded.length = 0;
  stores.clear();
  stores.set("stickers", { data: STICKERS, version: 1 });
  workOrder = { id: "wo1", code: "WO-2569-0267", title: "ล้างแอร์", assignedTo: "aui", status: "completed" };
});

describe("สติกเกอร์บนโพสต์ — เลือกคนโดนได้", () => {
  it("เลือกคนอื่น → หักคนนั้น ไม่ใช่คนโพสต์", async () => {
    await recordReportStickerEvents("org", post([]), post([r("x1", "angry", "head", "aui")]), "head");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ userId: "aui", points: -2, refType: "report_post_reaction", refId: "x1" });
  });

  it("เลือกหลายคน → หักทุกคน คนละเต็มแต้ม", async () => {
    await recordReportStickerEvents(
      "org",
      post([]),
      post([r("x1", "angry", "head", "aui"), r("x2", "angry", "head", "staff")]),
      "head"
    );
    expect(recorded.map((e) => [e.userId, e.points])).toEqual([
      ["aui", -2],
      ["staff", -2],
    ]);
  });

  it("ของเก่าไม่มีคนโดน → หักคนโพสต์เหมือนเดิม", async () => {
    await recordReportStickerEvents("org", post([]), post([r("x1", "angry", "head")]), "head");
    expect(recorded[0]).toMatchObject({ userId: "author", points: -2 });
  });

  it("คนโดนไม่ใช่คนในบริษัท → ตกเป็นคนโพสต์ (ปลอม id มาไม่ได้)", async () => {
    await recordReportStickerEvents("org", post([]), post([r("x1", "angry", "head", "outsider")]), "head");
    expect(recorded[0]).toMatchObject({ userId: "author" });
  });

  it("เลือก CEO → ไม่หักใครเลย", async () => {
    await recordReportStickerEvents("org", post([]), post([r("x1", "angry", "head", "ceo")]), "head");
    expect(recorded).toHaveLength(0);
  });

  it("คนกดไม่ใช่หัวหน้า → ไม่หัก", async () => {
    await recordReportStickerEvents("org", post([]), post([r("x1", "angry", "staff", "aui")]), "staff");
    expect(recorded).toHaveLength(0);
  });

  it("สติกเกอร์ 0 แต้ม → ไม่ลงคะแนน", async () => {
    await recordReportStickerEvents("org", post([]), post([r("x1", "fire", "head", "aui")]), "head");
    expect(recorded).toHaveLength(0);
  });

  it("บันทึกซ้ำก้อนเดิม (สติกเกอร์อยู่แล้ว) → ไม่หักซ้ำ", async () => {
    const same = post([r("x1", "angry", "head", "aui")]);
    await recordReportStickerEvents("org", same, same, "head");
    expect(recorded).toHaveLength(0);
  });

  it("ยกเลิก → คืนแต้มให้คนที่โดนจริง ลงวันเดิม", async () => {
    const withIt = post([r("x1", "angry", "head", "aui")]);
    await recordReportStickerEvents("org", post([]), withIt, "head");
    await recordReportStickerEvents("org", withIt, post([]), "head");
    expect(recorded).toHaveLength(2);
    expect(recorded[1]).toMatchObject({ userId: "aui", points: 2, refType: "report_post_reaction_undo", refId: "x1" });
    expect(recorded[1]!.occurredAt).toEqual(recorded[0]!.occurredAt);
  });

  it("ยกเลิกอันที่เลือก CEO (ไม่เคยหัก) → ไม่คืนแต้มฟรี", async () => {
    const withIt = post([r("x1", "angry", "head", "ceo")]);
    await recordReportStickerEvents("org", post([]), withIt, "head");
    await recordReportStickerEvents("org", withIt, post([]), "head");
    expect(recorded).toHaveLength(0);
  });

  it("ยกเลิกอันที่ติดก่อนมีระบบคะแนน (ไม่มีรายการหักเดิม) → ไม่คืน", async () => {
    await recordReportStickerEvents("org", post([r("old", "angry", "head", "aui")]), post([]), "head");
    expect(recorded).toHaveLength(0);
  });

  it("ยกเลิกโดยคนที่ไม่ใช่หัวหน้า → ไม่คืน", async () => {
    const withIt = post([r("x1", "angry", "head", "aui")]);
    await recordReportStickerEvents("org", post([]), withIt, "head");
    await recordReportStickerEvents("org", withIt, post([]), "staff");
    expect(recorded).toHaveLength(1);
  });
});

describe("สติกเกอร์บนการ์ดใบงานซ่อม", () => {
  it("หัวหน้าติด → หักผู้รับผิดชอบใบงาน", async () => {
    const reaction = await addWorkOrderReaction("org", "head", "wo1", "angry");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ userId: "aui", points: -2, refType: "work_order_reaction", refId: reaction.id });
    expect(recorded[0]!.note).toContain("WO-2569-0267");
  });

  it("ให้คะแนนบวกได้", async () => {
    await addWorkOrderReaction("org", "head", "wo1", "star");
    expect(recorded[0]).toMatchObject({ userId: "aui", points: 3 });
  });

  it("ไม่ใช่หัวหน้า → ปฏิเสธ ไม่หัก", async () => {
    await expect(addWorkOrderReaction("org", "staff", "wo1", "angry")).rejects.toBeInstanceOf(ReactionError);
    expect(recorded).toHaveLength(0);
  });

  it("ใบงานยังไม่มีผู้รับผิดชอบ → ปฏิเสธ (ไม่หักคนเปิดใบแทน)", async () => {
    workOrder = { ...workOrder!, assignedTo: null };
    await expect(addWorkOrderReaction("org", "head", "wo1", "angry")).rejects.toThrow("ยังไม่มีผู้รับผิดชอบ");
    expect(recorded).toHaveLength(0);
  });

  it("ใบงานถูกยกเลิก → ปฏิเสธ", async () => {
    workOrder = { ...workOrder!, status: "cancelled" };
    await expect(addWorkOrderReaction("org", "head", "wo1", "angry")).rejects.toBeInstanceOf(ReactionError);
  });

  it("สติกเกอร์ 0 แต้ม → เก็บบนการ์ดแต่ไม่ลงคะแนน", async () => {
    await addWorkOrderReaction("org", "head", "wo1", "fire");
    expect(recorded).toHaveLength(0);
    const saved = stores.get("work-order-reactions")!.data as { reactions: unknown[] };
    expect(saved.reactions).toHaveLength(1);
  });

  it("ยกเลิก → คืนแต้มให้คนเดิม ลงวันเดิม และหายจากการ์ด", async () => {
    const reaction = await addWorkOrderReaction("org", "head", "wo1", "angry");
    // ระหว่างนั้นเปลี่ยนผู้รับผิดชอบ — คืนต้องไปที่คนที่โดนจริง ไม่ใช่คนใหม่
    workOrder = { ...workOrder!, assignedTo: "staff" };
    await removeWorkOrderReaction("org", "head", reaction.id);
    expect(recorded).toHaveLength(2);
    expect(recorded[1]).toMatchObject({ userId: "aui", points: 2, refType: "work_order_reaction_undo", refId: reaction.id });
    expect(recorded[1]!.occurredAt).toEqual(recorded[0]!.occurredAt);
    const saved = stores.get("work-order-reactions")!.data as { reactions: unknown[] };
    expect(saved.reactions).toHaveLength(0);
  });

  it("สองครั้งติดกัน → เก็บครบทั้งสอง (ไม่เขียนทับกัน)", async () => {
    await addWorkOrderReaction("org", "head", "wo1", "angry");
    await addWorkOrderReaction("org", "head", "wo1", "star");
    const saved = stores.get("work-order-reactions")!.data as { reactions: unknown[] };
    expect(saved.reactions).toHaveLength(2);
    expect(recorded.map((e) => e.points)).toEqual([-2, 3]);
  });
});
