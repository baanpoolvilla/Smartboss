import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/realtime-client", () => ({ realtimeStatus: () => "closed", subscribeRealtime: () => () => {} }));

import { applyTaskDraft } from "./task-sync";
import type { Task } from "@/modules/report_task/types";

const t = (id: string, extra: Partial<Task> = {}) => ({ id, title: id, status: "todo", ...extra }) as unknown as Task;

describe("applyTaskDraft — งานที่บันทึกไม่ผ่านจากครั้งก่อน", () => {
  it("งานใหม่ที่ไม่เคยลงเซิร์ฟเวอร์ ถูกเพิ่มกลับเข้าไป", () => {
    const latest = [t("a"), t("b")];
    const out = applyTaskDraft(latest, { savedAt: Date.now(), changed: [t("new")], base: [], removedIds: [] });
    expect(out.map((x) => x.id)).toEqual(["a", "b", "new"]);
  });

  it("งานที่แก้ไว้ — ใช้ของเรา งานอื่นที่คนอื่นแก้ระหว่างนั้นยังอยู่", () => {
    const latest = [t("a", { title: "a (เพื่อนแก้)" }), t("b")];
    const out = applyTaskDraft(latest, {
      savedAt: Date.now(),
      changed: [t("b", { status: "in_progress" })],
      base: [t("b")],
      removedIds: [],
    });
    expect(out.find((x) => x.id === "a")?.title).toBe("a (เพื่อนแก้)");
    expect(out.find((x) => x.id === "b")?.status).toBe("in_progress");
  });

  it("งานเดียวกัน คนละช่อง — รวมทั้งสองฝั่ง", () => {
    const latest = [t("b", { title: "b ชื่อใหม่" })];
    const out = applyTaskDraft(latest, {
      savedAt: Date.now(),
      changed: [t("b", { status: "done" })],
      base: [t("b")],
      removedIds: [],
    });
    expect(out[0]).toMatchObject({ title: "b ชื่อใหม่", status: "done" });
  });

  it("งานที่ลบไว้ ถูกลบ", () => {
    const latest = [t("a"), t("b")];
    const out = applyTaskDraft(latest, { savedAt: Date.now(), changed: [], base: [t("b")], removedIds: ["b"] });
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });

  it("ส่งถึงไปแล้ว (เซิร์ฟเวอร์มีของเราแล้ว) = ไม่เปลี่ยนอะไร", () => {
    const latest = [t("a", { status: "done" })];
    const out = applyTaskDraft(latest, { savedAt: Date.now(), changed: [t("a", { status: "done" })], base: [t("a")], removedIds: [] });
    expect(JSON.stringify(out)).toBe(JSON.stringify(latest));
  });
});
