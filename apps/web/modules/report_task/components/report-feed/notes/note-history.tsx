"use client";

import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { ArrowLeft, RotateCcw } from "lucide-react";

import { cn } from "@/modules/report_task/lib/utils";
import type { NoteVersionMeta } from "@/modules/report_task/lib/notes/types";
import { NOTE_DOC_CSS, noteExtensions } from "./note-editor";
import { noteUnb64 } from "./note-provider";

/*
 * ประวัติการแก้ไขของหน้า — เลือกเวอร์ชันดูเนื้อหา (อ่านอย่างเดียว) + สิ่งที่เปลี่ยนเทียบเวอร์ชันก่อนหน้า
 * กู้คืน = พักสถานะปัจจุบันเป็นเวอร์ชันก่อน แล้วแทนเนื้อหาด้วยเวอร์ชันที่เลือก (เป็นการแก้ปกติ คนอื่นเห็นสด)
 */

const REASON: Record<NoteVersionMeta["reason"], string> = { session: "", interval: "ระหว่างแก้ต่อเนื่อง", restore: "ก่อนกู้คืน" };

/** เทียบทีละบรรทัด (LCS) — บรรทัดที่เพิ่ม/ลบ */
function lineDiff(before: string, after: string): { kind: "add" | "del" | "same"; text: string }[] {
  const a = before.split("\n").slice(0, 1500);
  const b = after.split("\n").slice(0, 1500);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: { kind: "add" | "del" | "same"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ kind: "del", text: a[i++]! });
    else out.push({ kind: "add", text: b[j++]! });
  }
  while (i < a.length) out.push({ kind: "del", text: a[i++]! });
  while (j < b.length) out.push({ kind: "add", text: b[j++]! });
  return out;
}

function ReadOnlyDoc({ json }: { json: JSONContent }) {
  const extensions = useMemo(() => noteExtensions({ placeholder: "" }), []);
  const editor = useEditor({ immediatelyRender: false, editable: false, extensions, content: json, editorProps: { attributes: { class: "note-doc" } } }, [json]);
  return <EditorContent editor={editor} />;
}

export function NoteHistory({ pageId, onClose, onRestore }: { pageId: string; onClose: () => void; onRestore: (json: JSONContent) => void }) {
  const [versions, setVersions] = useState<NoteVersionMeta[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ id: string; json: JSONContent; text: string; prevText: string } | null>(null);
  // เวอร์ชันที่โหลดไว้ไม่ใช่ตัวที่เลือก = ยังโหลดอยู่ (ไม่ต้องล้างค่าใน effect)
  const detail = loaded && loaded.id === sel ? loaded : null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void fetch(`/api/report-task/notes/${pageId}/versions`)
      .then((r) => r.json())
      .then((d: { versions?: NoteVersionMeta[] }) => {
        setVersions(d.versions ?? []);
        if (d.versions?.[0]) setSel(d.versions[0].id);
      })
      .catch(() => setVersions([]));
  }, [pageId]);

  useEffect(() => {
    if (!sel) return;
    void fetch(`/api/report-task/notes/${pageId}/versions?id=${sel}`)
      .then((r) => r.json())
      .then((d: { state: string; text: string; prevText: string }) => {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, noteUnb64(d.state));
        setLoaded({ id: sel, json: yXmlFragmentToProsemirrorJSON(doc.getXmlFragment("default")) as JSONContent, text: d.text, prevText: d.prevText });
      })
      .catch(() => setMsg("เปิดเวอร์ชันไม่สำเร็จ"));
  }, [pageId, sel]);

  const diff = useMemo(() => (detail ? lineDiff(detail.prevText, detail.text).filter((l) => l.kind !== "same" && l.text.trim()) : []), [detail]);
  const restore = async () => {
    if (!detail || !window.confirm("กู้คืนเป็นเวอร์ชันนี้? (เนื้อหาตอนนี้ถูกเก็บเป็นเวอร์ชันไว้ก่อน กู้กลับได้)")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/report-task/notes/${pageId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "checkpoint" }) });
      if (!r.ok) throw new Error();
      onRestore(detail.json);
      setMsg("กู้คืนแล้ว — เนื้อหาก่อนกู้อยู่ในประวัติ");
    } catch {
      setMsg("กู้คืนไม่สำเร็จ ลองใหม่");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <style>{NOTE_DOC_CSS}</style>
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <button type="button" onClick={onClose} className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-[var(--bg-soft)]">
          <ArrowLeft className="h-4 w-4" /> กลับไปที่โน้ต
        </button>
        <span className="text-sm font-semibold">ประวัติการแก้ไข</span>
        <span className="ml-auto hidden text-xs text-[var(--ink-soft)] sm:inline">เก็บครบ 30 วัน · เก่ากว่านั้นวันละเวอร์ชัน</span>
      </div>
      {msg && <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900" role="status">{msg}</div>}
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <ol className="max-h-48 shrink-0 overflow-y-auto border-b border-[var(--line)] sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r">
          {versions === null && <li className="p-3 text-sm text-[var(--ink-soft)]">กำลังโหลด…</li>}
          {versions?.length === 0 && <li className="p-3 text-sm text-[var(--ink-soft)]">ยังไม่มีประวัติ — ระบบเก็บเวอร์ชันเมื่อหยุดแก้ 5 นาที หรือทุก 30 นาทีที่แก้ต่อเนื่อง</li>}
          {versions?.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => setSel(v.id)} className={cn("block w-full border-l-[3px] px-3 py-2 text-left", sel === v.id ? "border-[#1b2537] bg-[#eef1f6]" : "border-transparent hover:bg-[var(--bg-soft)]")}>
                <div className="text-sm font-semibold">{new Date(v.at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" })}</div>
                <div className="text-xs text-[var(--ink-soft)]">{v.editors.join(", ") || "—"}{REASON[v.reason] ? ` · ${REASON[v.reason]}` : ""}</div>
              </button>
            </li>
          ))}
        </ol>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {detail ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy} onClick={() => void restore()} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#1b2537] px-4 text-sm font-semibold text-white disabled:opacity-50">
                  <RotateCcw className="h-4 w-4" /> กู้คืนเวอร์ชันนี้
                </button>
              </div>
              {diff.length > 0 && (
                <div className="mb-4 rounded-lg border border-[var(--line)] p-3 text-[13px]">
                  <div className="mb-1 font-semibold">สิ่งที่เปลี่ยนจากเวอร์ชันก่อนหน้า</div>
                  {diff.slice(0, 80).map((l, i) => (
                    <div key={i} className={cn("whitespace-pre-wrap rounded px-1", l.kind === "add" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900 line-through")}>
                      {l.kind === "add" ? "+ " : "− "}
                      {l.text}
                    </div>
                  ))}
                  {diff.length > 80 && <div className="text-[var(--ink-soft)]">… และอีก {diff.length - 80} บรรทัด</div>}
                </div>
              )}
              <ReadOnlyDoc json={detail.json} />
            </>
          ) : (
            sel && <p className="text-sm text-[var(--ink-soft)]">กำลังเปิดเวอร์ชัน…</p>
          )}
        </div>
      </div>
    </div>
  );
}
