import { expect, test } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderRichBulletText } from "./report-feed-rich-text";

(globalThis as unknown as { React: typeof React }).React = React;

const U = "https://claude.ai/artifact/Jcnc1viEinA45eW7pghZk5";
const html = (t: string) => renderToStaticMarkup(React.createElement(React.Fragment, null, renderRichBulletText(t)));

test("URL ในข้อความธรรมดา / ตัวหนา / เอียง / ขีดเส้นใต้ / ขีดฆ่า / มีสี กดได้ทุกแบบ", () => {
  for (const t of [`- Demo: ${U}`, `**- Demo: ${U}**`, `*ดู ${U}*`, `__- Demo: ${U}__`, `~~${U}~~`, `{{c:red}}- Demo: ${U}{{/c}}`]) {
    expect(html(t), t).toContain(`href="${U}"`);
  }
});

test("ตัวหนาที่ไม่มีลิงก์ยังเป็นตัวหนาเหมือนเดิม", () => {
  expect(html("**สวัสดี**")).toBe("<strong>สวัสดี</strong>");
});
