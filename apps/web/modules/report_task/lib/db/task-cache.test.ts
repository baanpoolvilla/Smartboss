import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = { version: 1, tasks: [{ id: "t1", title: "งานเดิม" }] as { id: string; title: string }[], reads: 0 };
vi.mock("@/modules/report_task/lib/db/task-repo", () => ({
  readTasksVersion: vi.fn(async () => db.version),
  readTasks: vi.fn(async () => {
    db.reads += 1;
    return { tasks: JSON.parse(JSON.stringify(db.tasks)), version: db.version };
  }),
}));

const { readTasksCached } = await import("./task-cache");

describe("readTasksCached — งานเบื้องหลังใช้ชุดที่จำไว้เมื่อไม่มีใครแก้งาน", () => {
  beforeEach(() => {
    (globalThis as { __taskCache?: Map<string, unknown> }).__taskCache?.clear();
    db.version = 1;
    db.tasks = [{ id: "t1", title: "งานเดิม" }];
    db.reads = 0;
  });

  it("ไม่มีใครแก้ → อ่านฐานข้อมูลครั้งเดียว รอบถัดไปใช้ชุดที่จำไว้", async () => {
    await readTasksCached("org");
    await readTasksCached("org");
    const third = await readTasksCached("org");
    expect(db.reads).toBe(1);
    expect(third.tasks).toEqual([{ id: "t1", title: "งานเดิม" }]);
    expect(third.version).toBe(1);
  });

  it("มีคนแก้งาน (เลขรุ่นขยับ) → อ่านใหม่ เห็นของล่าสุดทันที", async () => {
    await readTasksCached("org");
    db.version = 2;
    db.tasks = [{ id: "t1", title: "แก้แล้ว" }, { id: "t2", title: "งานใหม่" }];
    const next = await readTasksCached("org");
    expect(db.reads).toBe(2);
    expect(next.tasks.map((t) => t.title)).toEqual(["แก้แล้ว", "งานใหม่"]);
    expect(next.version).toBe(2);
  });

  it("ผู้เรียกแก้ข้อมูลที่ได้ไป (ตัวหักคะแนนทำแบบนี้) → ชุดที่จำไว้ไม่เพี้ยน", async () => {
    const first = await readTasksCached("org");
    (first.tasks[0] as { title: string }).title = "ถูกแก้ในหน่วยความจำ";
    first.tasks.push({ id: "x", title: "เพิ่มเอง" } as never);
    const second = await readTasksCached("org");
    (second.tasks[0] as { title: string }).title = "แก้อีกรอบ";
    const third = await readTasksCached("org");
    expect(third.tasks).toEqual([{ id: "t1", title: "งานเดิม" }]);
    expect(db.reads).toBe(1);
  });

  it("แยกตามบริษัท — คนละบริษัทไม่ใช้ชุดเดียวกัน", async () => {
    await readTasksCached("org-a");
    await readTasksCached("org-b");
    expect(db.reads).toBe(2);
  });
});
