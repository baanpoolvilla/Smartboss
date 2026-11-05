import { describe, expect, it } from "vitest";

import { fileTooLargeMessage, MB } from "@/lib/file-limits";
import { genericUploadExt, isPhotoFile, programFileError } from "@/lib/upload-file-kind";

describe("genericUploadExt", () => {
  it.each([
    ["บริษัท ซัน สไมล์ เซอร์วิส789 จำกัด-190724.dwg", "dwg"],
    ["PLAN.DXF", "dxf"],
    ["model.skp", "skp"],
    ["art.psd", "psd"],
    ["archive.rar", "rar"],
    ["ไม่มีนามสกุล", "bin"],
  ])("รับ %s", (name, ext) => {
    expect(genericUploadExt(name)).toEqual({ ext });
  });

  it.each(["setup.exe", "run.BAT", "a.ps1", "page.html", "x.svg", "a.js"])("ไม่รับ %s", (name) => {
    expect(genericUploadExt(name)).toHaveProperty("error");
  });

  it.each(["virus.pdf", "fake.jpg", "fake.docx"])("เนื้อไฟล์ไม่ตรงกับนามสกุล %s ไม่รับ", (name) => {
    expect(genericUploadExt(name)).toHaveProperty("error");
  });
});

describe("isPhotoFile", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "image/heic"])("%s เป็นรูป", (t) => {
    expect(isPhotoFile(t)).toBe(true);
  });
  it.each(["image/vnd.dwg", "image/vnd.dxf", "image/vnd.adobe.photoshop", "application/acad", ""])("%s ไม่ใช่รูป", (t) => {
    expect(isPhotoFile(t)).toBe(false);
  });
});

describe("programFileError", () => {
  it.each(["setup.exe", "RUN.BAT", "a.ps1", "a.js", "app.apk"])("ไม่รับ %s", (name) => {
    expect(programFileError(name)).toContain(".zip");
  });
  it.each(["page.html", "plan.dwg", "a.pdf", "a.zip", "ไม่มีนามสกุล"])("รับ %s", (name) => {
    expect(programFileError(name)).toBeNull();
  });
});

describe("fileTooLargeMessage", () => {
  const msg = (name: string | null) => fileTooLargeMessage({ name, size: 30 * MB }, 25 * MB);
  it("บอกขนาดจริง เพดาน และชวนบีบอัดไฟล์ทั่วไป", () => {
    expect(msg("plan.dwg")).toContain("30 MB");
    expect(msg("plan.dwg")).toContain("25 MB");
    expect(msg("plan.dwg")).toContain(".zip");
  });
  it("ไฟล์ที่บีบอัดแล้วไม่เล็กลงไม่ชวนบีบอัด", () => {
    expect(msg("a.zip")).toContain("Google Drive");
    expect(msg("a.zip")).not.toContain("บีบอัดเป็น");
    expect(msg("a.mp4")).not.toContain("บีบอัดเป็น");
    expect(msg("a.jpg")).toContain("ย่อรูป");
  });
  it("ไม่มีชื่อไฟล์ไม่ต่อท้ายคำแนะนำ", () => {
    expect(msg(null)).not.toContain("บีบอัด");
  });
});
