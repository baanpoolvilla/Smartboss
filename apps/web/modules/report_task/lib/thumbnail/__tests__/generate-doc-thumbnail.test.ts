import { writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  free: 0,
  running: 0,
  maxRunning: 0,
  calls: [] as string[],
  /** ปล่อยงานที่ค้างอยู่ — ให้เทสต์คุมได้ว่างานแรกยังวิ่งตอนงานถัดไปเข้ามา */
  gates: [] as Array<() => void>,
}));

vi.mock("node:os", async (orig) => ({
  ...(await orig<typeof import("node:os")>()),
  freemem: () => h.free,
}));

vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
    h.calls.push(cmd);
    h.running++;
    h.maxRunning = Math.max(h.maxRunning, h.running);
    h.gates.push(() => {
      const finish = () => {
        h.running--;
        cb(null);
      };
      if (cmd === "pdftoppm") void writeFile(`${args[args.length - 1]}-1.png`, "PNG").then(finish);
      else finish();
    });
  },
}));

import { generateDocThumbnail } from "../generate-doc-thumbnail";

const MB = 1024 * 1024;
const pdf = new Uint8Array([1]);

/** รอจนมีงานค้างที่ execFile แล้วปล่อยตัวแรก */
async function releaseNext() {
  await vi.waitFor(() => expect(h.gates.length).toBeGreaterThan(0));
  h.gates.shift()!();
}

describe("generateDocThumbnail", () => {
  beforeEach(() => {
    h.free = 4096 * MB;
    h.running = 0;
    h.maxRunning = 0;
    h.calls = [];
    h.gates = [];
  });

  it("แรมต่ำกว่า 600MB ข้ามทั้ง PDF และ office เหมือนเดิม", async () => {
    h.free = 300 * MB;
    expect(await generateDocThumbnail(pdf, "pdf")).toBeNull();
    expect(await generateDocThumbnail(pdf, "docx")).toBeNull();
    expect(h.calls).toEqual([]);
  });

  it("PDF สองไฟล์พร้อมกันได้รูปทั้งคู่ และทำทีละงาน", async () => {
    const jobs = [generateDocThumbnail(pdf, "pdf"), generateDocThumbnail(pdf, "pdf")];
    await releaseNext();
    await releaseNext();
    const out = await Promise.all(jobs);
    expect(out.map((b) => b?.toString())).toEqual(["PNG", "PNG"]);
    expect(h.maxRunning).toBe(1);
  });

  it("office ที่มาตอนติดงานอื่นยังข้ามทันที ไม่ต่อคิว", async () => {
    const first = generateDocThumbnail(pdf, "pdf");
    expect(await generateDocThumbnail(pdf, "docx")).toBeNull();
    await releaseNext();
    await first;
    expect(h.calls).toEqual(["pdftoppm"]);
  });

  it("คิว PDF เต็มแล้วตัวถัดไปข้าม และคิวว่างแล้วเริ่มงานใหม่ได้", async () => {
    const jobs = Array.from({ length: 11 }, () => generateDocThumbnail(pdf, "pdf")); // 1 ทำอยู่ + 10 รอ
    expect(await generateDocThumbnail(pdf, "pdf")).toBeNull();
    for (let i = 0; i < jobs.length; i++) await releaseNext();
    expect((await Promise.all(jobs)).every((b) => b?.toString() === "PNG")).toBe(true);
    // คิวว่างแล้ว ต้องเริ่มงานใหม่ได้ทันที
    const again = generateDocThumbnail(pdf, "pdf");
    await releaseNext();
    expect((await again)?.toString()).toBe("PNG");
  });
});
