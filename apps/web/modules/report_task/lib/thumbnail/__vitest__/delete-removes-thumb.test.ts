import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteFile } from "@/lib/storage";

/** ไฟล์หมดอายุ/ถูกลบแล้ว เนื้อหาหน้าแรกต้องไม่ค้างอยู่ในที่เก็บ */
describe("deleteFile ลบรูปหน้าแรกตามไฟล์", () => {
  let dir: string;
  const old = process.env.UPLOAD_DIR;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "del-thumb-"));
    process.env.UPLOAD_DIR = dir;
    await mkdir(join(dir, "org/chat"), { recursive: true });
  });
  afterAll(async () => {
    process.env.UPLOAD_DIR = old;
    await rm(dir, { recursive: true, force: true });
  });

  it("ลบ PDF แล้วรูปหน้าแรกหาย", async () => {
    await writeFile(join(dir, "org/chat/a.pdf"), "x");
    await writeFile(join(dir, "org/chat/a.pdf.thumb.png"), "x");
    expect(await deleteFile("/api/files/org/chat/a.pdf")).toBe(true);
    expect(existsSync(join(dir, "org/chat/a.pdf"))).toBe(false);
    expect(existsSync(join(dir, "org/chat/a.pdf.thumb.png"))).toBe(false);
  });

  it("เอกสารที่ไม่มีรูปหน้าแรกก็ลบได้ปกติ", async () => {
    await writeFile(join(dir, "org/chat/b.docx"), "x");
    expect(await deleteFile("org/chat/b.docx")).toBe(true);
    expect(existsSync(join(dir, "org/chat/b.docx"))).toBe(false);
  });
});
