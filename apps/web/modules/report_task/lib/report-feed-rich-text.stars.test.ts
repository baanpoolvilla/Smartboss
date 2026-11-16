import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bulletsTextToHtml, mentionMarkersToPlainText, renderRichBulletText } from "./report-feed-rich-text";

(globalThis as unknown as { React: typeof React }).React = React;

const html = (t: string) => renderToStaticMarkup(React.createElement(React.Fragment, null, renderRichBulletText(t)));

// 16/11/2569 "พิมพ์ * แล้วกดส่งมันหาย ต้องกลับมาแก้พิมใหม่ตลอด"
describe("ดอกจันที่พิมพ์เอง", () => {
  it("เก็บเป็น \\* → แสดงเป็น * ไม่กลายเป็นตัวเอียง", () => {
    expect(html("\\*เหล็กเพตหัวเสา จำนวน14\\*3 = 42 ชิ้น")).toBe("*เหล็กเพตหัวเสา จำนวน14*3 = 42 ชิ้น");
  });

  it("ตัวเอียงจากปุ่มยังเป็นตัวเอียง แม้ในบรรทัดมีดอกจันที่พิมพ์เอง", () => {
    expect(html("*สำคัญ* ราคา 8\\*8 นิ้ว")).toBe("<em>สำคัญ</em> ราคา 8*8 นิ้ว");
  });

  it("ดอกจันในตัวหนาก็ไม่หาย", () => {
    expect(html("**ยอด 2\\*3**")).toBe("<strong>ยอด 2*3</strong>");
  });

  it("เปิดแก้ในกล่องพิมพ์ เห็น * ธรรมดา", () => {
    expect(bulletsTextToHtml("14\\*3 = 42")).toBe("14*3 = 42");
  });

  it("ข้อความแจ้งเตือน / ข้อความล้วน ไม่มี \\ ติดมา", () => {
    expect(mentionMarkersToPlainText("\\*น้ำมันสน 3 ถัง")).toBe("*น้ำมันสน 3 ถัง");
  });

  it("โพสต์เก่า (ไม่มี \\) แสดงเหมือนเดิม", () => {
    expect(html("*ตัวเอียงเดิม*")).toBe("<em>ตัวเอียงเดิม</em>");
  });
});

// กล่องพิมพ์จริงเป็น DOM — สร้างโหนดจำลองเท่าที่ตัวอ่านใช้ (TEXT / ELEMENT · tagName · childNodes)
type FakeNode = { nodeType: number; textContent?: string; tagName?: string; childNodes?: FakeNode[]; classList?: { contains: () => boolean }; getAttribute?: () => null; style?: object };
const txt = (t: string): FakeNode => ({ nodeType: 3, textContent: t });
const el = (tag: string, ...kids: FakeNode[]): FakeNode => ({ nodeType: 1, tagName: tag, childNodes: kids, classList: { contains: () => false }, getAttribute: () => null, style: {} });

describe("บันทึกจากกล่องพิมพ์", () => {
  (globalThis as unknown as { Node: object }).Node ??= { TEXT_NODE: 3, ELEMENT_NODE: 1 };

  it("ดอกจันที่พิมพ์เองถูกเก็บเป็น \\* · กลับมาแสดงครบ", async () => {
    const { htmlEditorToBulletsText } = await import("./report-feed-rich-text");
    const root = el("DIV", txt("*เหล็กเพตหัวเสา จำนวน14*3 = 42 ชิ้น"), el("BR"), txt("*น้ำมันสน 3 ถัง"));
    const saved = htmlEditorToBulletsText(root as unknown as HTMLElement);
    expect(saved).toBe("\\*เหล็กเพตหัวเสา จำนวน14\\*3 = 42 ชิ้น\n\\*น้ำมันสน 3 ถัง");
    expect(saved.split("\n").map(html)).toEqual(["*เหล็กเพตหัวเสา จำนวน14*3 = 42 ชิ้น", "*น้ำมันสน 3 ถัง"]);
  });

  it("ตัวเอียงจากปุ่ม (<i>) ยังเก็บเป็น *…* และแสดงเป็นตัวเอียง", async () => {
    const { htmlEditorToBulletsText } = await import("./report-feed-rich-text");
    const saved = htmlEditorToBulletsText(el("DIV", el("I", txt("สำคัญ")), txt(" 2*3")) as unknown as HTMLElement);
    expect(saved).toBe("*สำคัญ* 2\\*3");
    expect(html(saved)).toBe("<em>สำคัญ</em> 2*3");
  });
});
