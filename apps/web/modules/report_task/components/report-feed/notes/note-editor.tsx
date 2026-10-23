"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, Mark, mergeAttributes, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit, TableCell, TableHeader } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import {
  Bold,
  CheckSquare,
  Eraser,
  FileUp,
  Heading1,
  Heading2,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";

import { uploadReportMedia } from "@/modules/report_task/lib/image-resize";
import { cn } from "@/modules/report_task/lib/utils";
import type { NoteProvider } from "./note-provider";

/*
 * ตัวแก้ไขโน้ต (TipTap + Yjs) — ลอกแถบเครื่องมือแบบ OneNote/Notes ใน Teams: หน้าแรก · แทรก · มุมมอง
 * รูป/ไฟล์ไม่ฝังในเอกสาร — อัปโหลดเข้าระบบไฟล์แนบแล้วใส่ลิงก์ (เอกสารเล็ก แก้พร้อมกันลื่น ไม่บวม)
 * วางรูปจาก OneNote/เว็บที่มาเป็น data: ก็อัปโหลดแทนให้อัตโนมัติ
 */

/** สีพื้นช่องตาราง (หัวตารางสีเขียวแบบในรูปของผู้ใช้) */
const cellBackground = {
  background: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.style.backgroundColor || el.getAttribute("data-bg") || null,
    renderHTML: (attrs: { background?: string | null }) => (attrs.background ? { style: `background-color:${attrs.background}`, "data-bg": attrs.background } : {}),
  },
};
const ColoredCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellBackground }; } });
const ColoredHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellBackground }; } });

/** แท็กแบบ OneNote: สำคัญ · ToDo · ถาม */
export const NOTE_TAGS = [
  { kind: "important", label: "สำคัญ" },
  { kind: "todo", label: "ToDo" },
  { kind: "question", label: "ถาม" },
] as const;
const NoteTag = Mark.create({
  name: "noteTag",
  addAttributes() {
    return { kind: { default: "important", parseHTML: (el: HTMLElement) => el.getAttribute("data-tag"), renderHTML: (a: { kind: string }) => ({ "data-tag": a.kind }) } };
  },
  parseHTML() {
    return [{ tag: "span[data-tag]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "note-tag" }), 0];
  },
});

/** ชุดส่วนขยายเดียวกันทั้งตัวแก้และตัวดูประวัติ (อ่านอย่างเดียว) */
export function noteExtensions(opts: { placeholder?: string } = {}) {
  return [
    StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
    TextStyleKit,
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true }, tableCell: false, tableHeader: false }),
    ColoredCell,
    ColoredHeader,
    Image.configure({ allowBase64: true }),
    NoteTag,
    Placeholder.configure({ placeholder: opts.placeholder ?? "เริ่มพิมพ์… วางข้อความ/ตาราง/รูปจาก OneNote ได้เลย" }),
  ];
}

const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px"];
const COLORS = ["#111827", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#db2777", "#6b7280"];
const HIGHLIGHTS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa", "#e9d5ff"];
const CELL_BG = ["#b9f78f", "#fef08a", "#bfdbfe", "#fecaca", "#e5e7eb", ""];

export const NOTE_DOC_CSS = `
.note-doc{outline:none;font-size:15px;line-height:1.65;color:var(--ink,#111827);min-height:50vh;padding-bottom:30vh}
.note-doc p{margin:.35em 0}
.note-doc h1{font-size:1.6em;font-weight:700;margin:.8em 0 .3em}
.note-doc h2{font-size:1.3em;font-weight:700;margin:.7em 0 .3em}
.note-doc h3{font-size:1.1em;font-weight:700;margin:.6em 0 .2em}
.note-doc ul{list-style:disc;padding-left:1.5em}.note-doc ol{list-style:decimal;padding-left:1.5em}
.note-doc a{color:#1d4ed8;text-decoration:underline;cursor:pointer}
.note-doc hr{border:0;border-top:1px solid #d1d5db;margin:1em 0}
.note-doc img{max-width:100%;height:auto;border-radius:8px;margin:.4em 0}
.note-doc img.ProseMirror-selectednode{outline:3px solid #1b2537}
.note-doc ul[data-type=taskList]{list-style:none;padding-left:.2em}
.note-doc ul[data-type=taskList] li{display:flex;gap:.5em;align-items:flex-start}
.note-doc ul[data-type=taskList] li>label{margin-top:.3em}
.note-doc ul[data-type=taskList] li>div{flex:1;min-width:0}
.note-doc ul[data-type=taskList] li>label input{width:1.05em;height:1.05em}
.note-doc ul[data-type=taskList] li[data-checked=true]>div{text-decoration:line-through;color:#6b7280}
.note-doc .tableWrapper{overflow-x:auto;margin:.6em 0}
.note-doc table{border-collapse:collapse;table-layout:fixed;min-width:320px}
.note-doc td,.note-doc th{border:1px solid #cbd5e1;padding:5px 8px;vertical-align:top;min-width:60px;position:relative}
.note-doc th{font-weight:700;text-align:left;background:#f1f5f9}
.note-doc td p,.note-doc th p{margin:0}
.note-doc .selectedCell:after{content:"";position:absolute;inset:0;background:rgba(37,99,235,.12);pointer-events:none}
.note-doc .column-resize-handle{position:absolute;right:-2px;top:0;bottom:0;width:4px;background:#2563eb;pointer-events:none}
.note-doc.resize-cursor{cursor:col-resize}
.note-doc .note-tag{border-radius:999px;padding:0 .45em;font-size:.82em;font-weight:600;white-space:nowrap}
.note-doc .note-tag[data-tag=important]{background:#fee2e2;color:#991b1b}
.note-doc .note-tag[data-tag=todo]{background:#e0f2fe;color:#075985}
.note-doc .note-tag[data-tag=question]{background:#ede9fe;color:#5b21b6}
.note-doc p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:#9ca3af;float:left;height:0;pointer-events:none}
.collaboration-carets__caret{border-left:2px solid;border-right:0;margin-left:-1px;margin-right:-1px;position:relative;word-break:normal;pointer-events:none}
.collaboration-carets__label{position:absolute;top:-1.35em;left:-1px;font-size:11px;font-weight:600;line-height:1.2;color:#fff;padding:1px 5px;border-radius:4px 4px 4px 0;white-space:nowrap;user-select:none}
`;

function Btn({ label, active, onClick, children, disabled }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn("inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-[13px] text-[var(--ink)] hover:bg-[var(--bg-soft)] disabled:opacity-40", active && "bg-[#dde3eb] font-semibold")}
    >
      {children}
    </button>
  );
}
const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-[var(--line)]" aria-hidden="true" />;

function Swatches({ colors, onPick, label }: { colors: string[]; onPick: (c: string) => void; label: string }) {
  return (
    <div className="grid grid-cols-6 gap-1 p-2" role="group" aria-label={label}>
      {colors.map((c) => (
        <button
          key={c || "none"}
          type="button"
          aria-label={c ? `${label} ${c}` : "ไม่มีสี"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
          className="h-6 w-6 rounded border border-[var(--line)]"
          style={c ? { background: c } : { background: "linear-gradient(135deg,#fff 45%,#dc2626 50%,#fff 55%)" }}
        />
      ))}
    </div>
  );
}

function Pop({ label, icon, children }: { label: string; icon: React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <Btn label={label} active={open} onClick={() => setOpen((v) => !v)}>
        {icon}
      </Btn>
      {open && <div className="absolute left-0 top-10 z-30 rounded-lg border border-[var(--line)] bg-white shadow-lg">{children(() => setOpen(false))}</div>}
    </div>
  );
}

type Ribbon = "home" | "insert" | "view";

async function insertFiles(editor: Editor, files: File[], at?: number, onError?: (m: string) => void) {
  for (const file of files) {
    try {
      const up = await uploadReportMedia(file);
      const chain = editor.chain().focus(at);
      if (file.type.startsWith("image/")) chain.setImage({ src: up.url, alt: up.name }).run();
      else chain.insertContent([{ type: "text", text: `📎 ${up.name}`, marks: [{ type: "link", attrs: { href: up.url, target: "_blank" } }] }, { type: "text", text: " " }]).run();
      at = undefined;
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
    }
  }
}

/** รูปที่วางมาเป็น data: (จาก OneNote/เว็บ) → อัปโหลดแล้วเปลี่ยนเป็นลิงก์ — เอกสารไม่บวม */
function useDataImageUploader(editor: Editor | null, onError: (m: string) => void) {
  const busy = useRef(new Set<string>());
  useEffect(() => {
    if (!editor) return;
    const run = () => {
      editor.state.doc.descendants((node) => {
        const src = node.type.name === "image" ? String(node.attrs.src ?? "") : "";
        if (!src.startsWith("data:") || busy.current.has(src)) return;
        busy.current.add(src);
        void (async () => {
          try {
            const blob = await (await fetch(src)).blob();
            const ext = blob.type.split("/")[1] ?? "png";
            const up = await uploadReportMedia(new File([blob], `pasted.${ext}`, { type: blob.type }));
            const { tr } = editor.state;
            editor.state.doc.descendants((n, pos) => {
              if (n.type.name === "image" && n.attrs.src === src) tr.setNodeMarkup(pos, undefined, { ...n.attrs, src: up.url });
            });
            editor.view.dispatch(tr);
          } catch {
            // อัปโหลดไม่ได้ — เอารูปฝังออก ไม่ให้เอกสารบวม
            const { tr } = editor.state;
            const del: number[] = [];
            editor.state.doc.descendants((n, pos) => {
              if (n.type.name === "image" && n.attrs.src === src) del.push(pos);
            });
            for (const pos of del.reverse()) tr.delete(pos, pos + 1);
            editor.view.dispatch(tr);
            onError("วางรูปไม่สำเร็จ — ลองบันทึกรูปแล้วใช้ปุ่ม แทรก › รูป");
          } finally {
            busy.current.delete(src);
          }
        })();
      });
    };
    editor.on("update", run);
    return () => {
      editor.off("update", run);
    };
  }, [editor, onError]);
}

export function NoteEditor({
  provider,
  user,
  readOnly = false,
  onError,
  onEditor,
}: {
  provider: NoteProvider;
  user: { id: string; name: string; color: string };
  readOnly?: boolean;
  onError: (m: string) => void;
  /** ให้หน้าเรียกใช้ตัวแก้ (ใส่หน้าสำเร็จรูป/กู้คืนเวอร์ชัน) */
  onEditor?: (editor: Editor | null) => void;
}) {
  const [ribbon, setRibbon] = useState<Ribbon>("home");
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const extensions = useMemo(
    () => [
      ...noteExtensions(),
      Collaboration.configure({ document: provider.doc }),
      CollaborationCaret.configure({ provider, user: { name: user.name, color: user.color } }),
    ],
    [provider, user.name, user.color],
  );
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !readOnly,
      extensions,
      editorProps: {
        attributes: { class: "note-doc", spellcheck: "false" },
        handlePaste(view, event) {
          const files = [...(event.clipboardData?.files ?? [])];
          if (files.length === 0 || !editorRef.current) return false;
          event.preventDefault();
          void insertFiles(editorRef.current, files, undefined, onError);
          return true;
        },
        handleDrop(view, event) {
          const files = [...(event.dataTransfer?.files ?? [])];
          if (files.length === 0 || !editorRef.current) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void insertFiles(editorRef.current, files, pos, onError);
          return true;
        },
      },
    },
    [extensions],
  );
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useDataImageUploader(editor, onError);
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);
  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            h1: e.isActive("heading", { level: 1 }),
            h2: e.isActive("heading", { level: 2 }),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            task: e.isActive("taskList"),
            table: e.isActive("table"),
            link: e.isActive("link"),
            fontSize: (e.getAttributes("textStyle").fontSize as string | undefined) ?? "",
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });

  if (!editor || !s) return <div className="p-6 text-sm text-[var(--ink-soft)]">กำลังเปิด…</div>;
  const ch = () => editor.chain().focus();
  const setLink = () => {
    const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("ลิงก์ (เว้นว่าง = เอาลิงก์ออก)", prev);
    if (url === null) return;
    if (!url.trim()) ch().unsetLink().run();
    else ch().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <style>{NOTE_DOC_CSS}</style>
      {!readOnly && (
        <div className="sticky top-0 z-20 border-b border-[var(--line)] bg-white">
          <div className="flex items-center gap-4 px-3 text-[13px]" role="tablist" aria-label="แถบเครื่องมือ">
            {(
              [
                ["home", "หน้าแรก"],
                ["insert", "แทรก"],
                ["view", "มุมมอง"],
              ] as [Ribbon, string][]
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={ribbon === id} onClick={() => setRibbon(id)} className={cn("border-b-2 py-2", ribbon === id ? "border-[#1b2537] font-bold text-[var(--ink)]" : "border-transparent text-[var(--ink-soft)]")}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 overflow-x-auto px-2 py-1 [scrollbar-width:thin]">
            {ribbon === "home" && (
              <>
                <Btn label="เลิกทำ (Ctrl+Z)" onClick={() => ch().undo().run()} disabled={!s.canUndo}><Undo2 className="h-4 w-4" /></Btn>
                <Btn label="ทำซ้ำ (Ctrl+Y)" onClick={() => ch().redo().run()} disabled={!s.canRedo}><Redo2 className="h-4 w-4" /></Btn>
                <Sep />
                <select
                  aria-label="ขนาดตัวอักษร"
                  value={s.fontSize}
                  onChange={(e) => (e.target.value ? ch().setFontSize(e.target.value).run() : ch().unsetFontSize().run())}
                  className="h-8 shrink-0 rounded-md border border-[var(--line)] bg-white px-1 text-[13px]"
                >
                  <option value="">ขนาด</option>
                  {FONT_SIZES.map((f) => <option key={f} value={f}>{parseInt(f)}</option>)}
                </select>
                <Sep />
                <Btn label="ตัวหนา (Ctrl+B)" active={s.bold} onClick={() => ch().toggleBold().run()}><Bold className="h-4 w-4" /></Btn>
                <Btn label="ตัวเอียง (Ctrl+I)" active={s.italic} onClick={() => ch().toggleItalic().run()}><Italic className="h-4 w-4" /></Btn>
                <Btn label="ขีดเส้นใต้ (Ctrl+U)" active={s.underline} onClick={() => ch().toggleUnderline().run()}><UnderlineIcon className="h-4 w-4" /></Btn>
                <Btn label="ขีดฆ่า" active={s.strike} onClick={() => ch().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></Btn>
                <Pop label="ไฮไลต์" icon={<Highlighter className="h-4 w-4" />}>
                  {(close) => <Swatches label="ไฮไลต์" colors={[...HIGHLIGHTS, ""]} onPick={(c) => { if (c) ch().toggleHighlight({ color: c }).run(); else ch().unsetHighlight().run(); close(); }} />}
                </Pop>
                <Pop label="สีตัวอักษร" icon={<span className="border-b-[3px] border-red-600 px-0.5 font-bold leading-none">A</span>}>
                  {(close) => <Swatches label="สีตัวอักษร" colors={COLORS} onPick={(c) => { ch().setColor(c).run(); close(); }} />}
                </Pop>
                <Btn label="ล้างรูปแบบ" onClick={() => ch().unsetAllMarks().clearNodes().run()}><Eraser className="h-4 w-4" /></Btn>
                <Sep />
                <Btn label="รายการจุด" active={s.bullet} onClick={() => ch().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
                <Btn label="รายการตัวเลข" active={s.ordered} onClick={() => ch().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
                <Btn label="เช็กลิสต์" active={s.task} onClick={() => ch().toggleTaskList().run()}><CheckSquare className="h-4 w-4" /> <span className="hidden sm:inline">เช็กลิสต์</span></Btn>
                <Sep />
                <Btn label="หัวข้อ 1" active={s.h1} onClick={() => ch().toggleHeading({ level: 1 }).run()}><Heading1 className="h-4 w-4" /></Btn>
                <Btn label="หัวข้อ 2" active={s.h2} onClick={() => ch().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></Btn>
                <Sep />
                {NOTE_TAGS.map((t) => (
                  <Btn key={t.kind} label={`แท็ก ${t.label}`} onClick={() => {
                    if (editor.state.selection.empty) ch().insertContent([{ type: "text", text: t.label, marks: [{ type: "noteTag", attrs: { kind: t.kind } }] }, { type: "text", text: " " }]).run();
                    else ch().toggleMark("noteTag", { kind: t.kind }).run();
                  }}>
                    <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", t.kind === "important" ? "bg-red-100 text-red-800" : t.kind === "todo" ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800")}>{t.label}</span>
                  </Btn>
                ))}
              </>
            )}
            {ribbon === "insert" && (
              <>
                <Btn label="แทรกตาราง 3×3" onClick={() => ch().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon className="h-4 w-4" /> ตาราง</Btn>
                <Btn label="แทรกรูป" onClick={() => imageInput.current?.click()}><ImagePlus className="h-4 w-4" /> รูป</Btn>
                <Btn label="แนบไฟล์" onClick={() => fileInput.current?.click()}><FileUp className="h-4 w-4" /> ไฟล์</Btn>
                <Btn label="ลิงก์" active={s.link} onClick={setLink}><Link2 className="h-4 w-4" /> ลิงก์</Btn>
                <Btn label="วันที่และเวลา" onClick={() => ch().insertContent(new Date().toLocaleString("th-TH", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Bangkok" }) + " ").run()}>วันที่/เวลา</Btn>
                <Btn label="เส้นคั่น" onClick={() => ch().setHorizontalRule().run()}><Minus className="h-4 w-4" /> เส้นคั่น</Btn>
              </>
            )}
            {ribbon === "view" && <span className="px-2 py-2 text-[13px] text-[var(--ink-soft)]">ประวัติการแก้ไข · ค้นหา · ถังขยะ อยู่ที่แถบรายชื่อหน้าด้านซ้าย</span>}
          </div>
          {s.table && (
            <div className="flex items-center gap-0.5 overflow-x-auto border-t border-[var(--line)] bg-[#f8fafc] px-2 py-1 text-[12px]">
              <span className="shrink-0 px-1 font-semibold text-[var(--ink-soft)]">ตาราง:</span>
              <Btn label="แทรกแถวด้านบน" onClick={() => ch().addRowBefore().run()}>+แถวบน</Btn>
              <Btn label="แทรกแถวด้านล่าง" onClick={() => ch().addRowAfter().run()}>+แถวล่าง</Btn>
              <Btn label="แทรกคอลัมน์ซ้าย" onClick={() => ch().addColumnBefore().run()}>+คอลัมน์ซ้าย</Btn>
              <Btn label="แทรกคอลัมน์ขวา" onClick={() => ch().addColumnAfter().run()}>+คอลัมน์ขวา</Btn>
              <Btn label="ลบแถว" onClick={() => ch().deleteRow().run()}>ลบแถว</Btn>
              <Btn label="ลบคอลัมน์" onClick={() => ch().deleteColumn().run()}>ลบคอลัมน์</Btn>
              <Btn label="รวม/แยกช่อง" onClick={() => ch().mergeOrSplit().run()}>รวม/แยกช่อง</Btn>
              <Btn label="สลับแถวหัวตาราง" onClick={() => ch().toggleHeaderRow().run()}>แถวหัว</Btn>
              <Pop label="สีพื้นช่อง" icon={<span className="rounded bg-[#b9f78f] px-1">สีช่อง</span>}>
                {(close) => <Swatches label="สีพื้นช่อง" colors={CELL_BG} onPick={(c) => { ch().setCellAttribute("background", c || null).run(); close(); }} />}
              </Pop>
              <Btn label="ลบตาราง" onClick={() => { if (window.confirm("ลบทั้งตาราง?")) ch().deleteTable().run(); }}><span className="text-red-700">ลบตาราง</span></Btn>
            </div>
          )}
          <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => { void insertFiles(editor, [...(e.target.files ?? [])], undefined, onError); e.target.value = ""; }} />
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void insertFiles(editor, [...(e.target.files ?? [])], undefined, onError); e.target.value = ""; }} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-8">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
