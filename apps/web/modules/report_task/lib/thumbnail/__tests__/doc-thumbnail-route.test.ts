import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: { orgId: "org-a" } as { orgId: string } | null,
  exists: false,
  bytes: new Uint8Array([1]) as Uint8Array | null,
  png: Buffer.from("PNG") as Buffer | null,
  put: [] as string[],
}));

vi.mock("@smartboss/auth", () => ({ getSession: async () => h.session }));
vi.mock("@/lib/storage", () => ({
  storedFileExists: async () => h.exists,
  readStoredBytes: async () => h.bytes,
}));
vi.mock("@/modules/report_task/lib/thumbnail/store-doc-thumbnail", () => ({
  storeDocThumbnail: async (url: string) => {
    if (!h.png) return null;
    const key = `${url.replace("/api/files/", "")}.thumb.png`;
    h.put.push(key);
    return `/api/files/${key}`;
  },
}));

import { GET } from "@/app/api/report-task/doc-thumbnail/route";

const call = (file: string) =>
  GET(new Request(`http://x/api/report-task/doc-thumbnail?file=${encodeURIComponent(file)}`));
const own = "/api/files/org-a/report-task/1-a.pdf";

describe("GET /api/report-task/doc-thumbnail", () => {
  beforeEach(() => {
    h.session = { orgId: "org-a" };
    h.exists = false;
    h.bytes = new Uint8Array([1]);
    h.png = Buffer.from("PNG");
    h.put = [];
  });

  it("ไม่ login = 401", async () => {
    h.session = null;
    expect((await call(own)).status).toBe(401);
  });

  it.each([
    ["ไฟล์ของบริษัทอื่น", "/api/files/org-b/report-task/1-a.pdf"],
    ["ไฟล์โมดูลอื่น", "/api/files/org-a/requests/1-a.pdf"],
    ["ไม่ใช่เอกสาร", "/api/files/org-a/report-task/1-a.zip"],
    ["ไต่ path", "/api/files/org-a/report-task/../../org-b/report-task/a.pdf"],
    ["ไม่ใช่ URL ไฟล์", "org-a/report-task/1-a.pdf"],
  ])("%s = 400", async (_label, file) => {
    expect((await call(file)).status).toBe(400);
    expect(h.put).toEqual([]);
  });

  it("ยังไม่มีรูป: สร้าง เก็บที่ key ตายตัว แล้วเด้งไปไฟล์นั้น", async () => {
    const res = await call(own);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/api/files/org-a/report-task/1-a.pdf.thumb.png");
    expect(h.put).toEqual(["org-a/report-task/1-a.pdf.thumb.png"]);
  });

  it("ไฟล์แชทใช้ได้เหมือนกัน", async () => {
    const res = await call("/api/files/org-a/chat/1-a.pdf");
    expect(res.headers.get("location")).toBe("/api/files/org-a/chat/1-a.pdf.thumb.png");
  });

  it("office ไม่มีรูป = 404 ไม่สร้างตอนเปิดดู · มีรูปจากตอนอัปโหลด = ใช้ได้", async () => {
    expect((await call("/api/files/org-a/report-task/1-a.docx")).status).toBe(404);
    expect(h.put).toEqual([]);
    h.exists = true;
    expect((await call("/api/files/org-a/report-task/1-a.docx")).status).toBe(302);
  });

  it("มีรูปอยู่แล้ว: ไม่สร้างซ้ำ", async () => {
    h.exists = true;
    expect((await call(own)).status).toBe(302);
    expect(h.put).toEqual([]);
  });

  it("ไฟล์ต้นทางไม่มี = 404 · สร้างไม่ได้ = 503 แล้วไม่เขียนอะไร", async () => {
    h.bytes = null;
    expect((await call(own)).status).toBe(404);
    h.bytes = new Uint8Array([1]);
    h.png = null;
    expect((await call(own)).status).toBe(503);
    expect(h.put).toEqual([]);
  });
});
