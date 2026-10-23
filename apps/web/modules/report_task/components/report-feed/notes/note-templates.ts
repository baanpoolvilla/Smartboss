import type { JSONContent } from "@tiptap/react";

/** หน้าสำเร็จรูป — ไม่ต้องเริ่มจากหน้าว่าง (ตารางรายชื่อติดต่อหัวเขียวแบบในรูปของผู้ใช้ · เช็กลิสต์) */

const cell = (text: string, header = false): JSONContent => ({
  type: header ? "tableHeader" : "tableCell",
  attrs: header ? { background: "#b9f78f" } : {},
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
});
const row = (cells: string[], header = false): JSONContent => ({ type: "tableRow", content: cells.map((c) => cell(c, header)) });

export const NOTE_TEMPLATES: { id: string; label: string; title: string; content: JSONContent | null }[] = [
  { id: "blank", label: "หน้าว่าง", title: "หน้าใหม่", content: null },
  {
    id: "contacts",
    label: "รายชื่อติดต่อ (ตาราง)",
    title: "รายชื่อติดต่อ",
    content: {
      type: "doc",
      content: [{ type: "table", content: [row(["Description", "Name", "Tel no.", "Remark"], true), row(["", "", "", ""]), row(["", "", "", ""]), row(["", "", "", ""])] }, { type: "paragraph" }],
    },
  },
  {
    id: "checklist",
    label: "เช็กลิสต์",
    title: "เช็กลิสต์",
    content: {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: ["", "", ""].map(() => ({ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] })),
        },
      ],
    },
  },
];
