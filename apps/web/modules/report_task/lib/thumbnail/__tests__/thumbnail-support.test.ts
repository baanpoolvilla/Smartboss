import { test } from "node:test";
import assert from "node:assert/strict";

import { needsOfficeConversion, supportsDocThumbnail } from "../thumbnail-support";

test("supportsDocThumbnail: pdf และไฟล์ office ทำ thumbnail ได้ ไฟล์อื่นไม่ได้", () => {
  assert.equal(supportsDocThumbnail("pdf"), true);
  for (const ext of ["doc", "docx", "xls", "xlsx", "ppt", "pptx"]) {
    assert.equal(supportsDocThumbnail(ext), true, ext);
  }
  for (const ext of ["txt", "csv", "zip", "jpg", "mp4"]) {
    assert.equal(supportsDocThumbnail(ext), false, ext);
  }
});

test("needsOfficeConversion: เฉพาะไฟล์ office ต้องผ่าน soffice ก่อน — pdf ไม่ต้อง", () => {
  assert.equal(needsOfficeConversion("pdf"), false);
  assert.equal(needsOfficeConversion("docx"), true);
  assert.equal(needsOfficeConversion("xlsx"), true);
  assert.equal(needsOfficeConversion("pptx"), true);
});
