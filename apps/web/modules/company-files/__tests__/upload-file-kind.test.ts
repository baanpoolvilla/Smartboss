import { describe, expect, it } from "vitest";

import { genericUploadExt, isPhotoFile } from "@/lib/upload-file-kind";

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
