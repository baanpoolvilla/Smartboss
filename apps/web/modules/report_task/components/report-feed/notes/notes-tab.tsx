"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import { ArrowLeft, ChevronDown, ChevronUp, FolderPlus, History, MoreHorizontal, Pin, PinOff, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";

import { subscribeRealtime } from "@/lib/realtime-client";
import { getUser } from "@/modules/report_task/lib/directory";
import { cn } from "@/modules/report_task/lib/utils";
import { NOTE_LIMITS, type NoteMember, type NotePageMeta, type NoteSectionMeta } from "@/modules/report_task/lib/notes/types";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import type { ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { NoteEditor } from "./note-editor";
import { NoteHistory } from "./note-history";
import { NoteProvider, colorFor, type NoteSyncStatus } from "./note-provider";
import { NOTE_TEMPLATES } from "./note-templates";

/*
 * แท็บ "โน้ต" ของห้องรายงาน — แบบ Notes ใน Teams (ผู้ใช้ขอ 23/10/2569)
 * ซ้าย: ส่วน + รายชื่อหน้า (ปักหมุด · ค้นหา · ถังขยะ) · ขวา: หน้าโน้ต แก้พร้อมกันได้ เห็นเคอร์เซอร์คนอื่น
 * มือถือ: รายชื่อหน้า → แตะเปิดหน้า (ปุ่มกลับ)
 * ใครเห็นห้องก็อ่าน/แก้ได้ · หน้าที่เปิดอยู่จำไว้ใน URL (?note=) ลิงก์ส่งต่อได้
 */

interface ListData {
  sections: NoteSectionMeta[];
  pages: NotePageMeta[];
  viewers: NoteMember[];
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "ทำไม่สำเร็จ ลองใหม่อีกครั้ง");
  return data;
}

const ago = (iso: string) => {
  const d = new Date(iso);
  const same = d.toDateString() === new Date().toDateString();
  return d.toLocaleString("th-TH", same ? { timeStyle: "short", timeZone: "Asia/Bangkok" } : { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
};

/** ไอดีของแท็บนี้ (สุ่มครั้งเดียวตอนโหลดโมดูล — ไม่สุ่มระหว่าง render) */
const TAB_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function setNoteParam(pageId: string | null) {
  try {
    const url = new URL(window.location.href);
    if (pageId) url.searchParams.set("note", pageId);
    else url.searchParams.delete("note");
    url.searchParams.set("tab", "notes");
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // ไม่เป็นไร — แค่ลิงก์ไม่จำหน้า
  }
}

export function NotesTab({ topic }: { topic: ReportTopic }) {
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const myName = getUser(me)?.name ?? "ฉัน";
  const [list, setList] = useState<ListData | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pageId, setPageId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("note")));
  const [q, setQ] = useState("");
  const [results, setResults] = useState<NotePageMeta[] | null>(null);
  const [trashData, setTrashData] = useState<{ pages: NotePageMeta[]; at: number } | null>(null);
  const trash = trashData?.pages ?? null;
  const setTrash = (v: null) => setTrashData(v);
  const [newMenu, setNewMenu] = useState(false);
  const [templates, setTemplates] = useState<Record<string, JSONContent>>({});
  const roomClient = `${TAB_ID}-room-${useId()}`;

  const flash = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(""), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      setList(await api<ListData>(`/api/report-task/notes?topic=${encodeURIComponent(topic.id)}`));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดโน้ตไม่สำเร็จ");
    }
  }, [topic.id]);

  // เปลี่ยนห้อง = คอมโพเนนต์ใหม่ (parent ใส่ key={topic.id}) ไม่ต้องล้างค่าเอง
  useEffect(() => {
    let alive = true;
    api<ListData>(`/api/report-task/notes?topic=${encodeURIComponent(topic.id)}`)
      .then((d) => alive && setList(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "โหลดโน้ตไม่สำเร็จ"));
    return () => {
      alive = false;
    };
  }, [topic.id]);

  // ฟังว่ามีคนเพิ่ม/เปลี่ยนชื่อ/ลบหน้า + บอกเซิร์ฟเวอร์ว่าเปิดแท็บโน้ตของห้องนี้อยู่ (ถึงจะได้รับแจ้ง)
  useEffect(() => {
    const off = subscribeRealtime((e) => {
      if (e.type === "note.list" && (e as { topicId?: string }).topicId === topic.id) void load();
      if (e.type === "realtime.reconnected") void load();
    });
    const beat = () =>
      void api<{ members: NoteMember[] }>("/api/report-task/notes/presence", { topicId: topic.id, pageId: null, clientId: roomClient })
        .then((d) => setList((l) => (l ? { ...l, viewers: d.members } : l)))
        .catch(() => undefined);
    beat();
    const t = window.setInterval(beat, 20_000);
    return () => {
      off();
      window.clearInterval(t);
      void fetch("/api/report-task/notes/presence", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ topicId: topic.id, clientId: roomClient, leave: true }) }).catch(() => undefined);
    };
  }, [topic.id, roomClient, load]);

  // ค้นหา (หน่วง 300 มิลลิวินาที)
  useEffect(() => {
    if (!q.trim()) return;
    const t = window.setTimeout(() => {
      void api<ListData>(`/api/report-task/notes?topic=${encodeURIComponent(topic.id)}&q=${encodeURIComponent(q.trim())}`)
        .then((d) => setResults(d.pages))
        .catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(t);
  }, [q, topic.id]);

  const open = (id: string | null) => {
    setPageId(id);
    setNoteParam(id);
    setTrash(null);
  };

  const createPage = async (templateId: string, sectionId: string | null) => {
    setNewMenu(false);
    const tpl = NOTE_TEMPLATES.find((t) => t.id === templateId) ?? NOTE_TEMPLATES[0]!;
    try {
      const { id } = await api<{ id: string }>("/api/report-task/notes", { op: "createPage", topicId: topic.id, sectionId, title: tpl.title });
      if (tpl.content) setTemplates((m) => ({ ...m, [id]: tpl.content! }));
      await load();
      open(id);
    } catch (e) {
      flash(e instanceof Error ? e.message : "สร้างหน้าไม่สำเร็จ");
    }
  };

  const meta = async (id: string, patch: Record<string, unknown>) => {
    try {
      await api(`/api/report-task/notes/${id}`, { op: "meta", ...patch });
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    }
  };

  const section = async (body: Record<string, unknown>) => {
    try {
      await api("/api/report-task/notes", { op: "section", topicId: topic.id, ...body });
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    }
  };

  const showTrash = async () => {
    try {
      setTrashData({ pages: (await api<ListData>(`/api/report-task/notes?topic=${encodeURIComponent(topic.id)}&trash=1`)).pages, at: Date.now() });
    } catch {
      setTrashData({ pages: [], at: Date.now() });
    }
  };

  const pages = useMemo(() => list?.pages ?? [], [list]);
  const sections = useMemo(() => list?.sections ?? [], [list]);
  const shownResults = q.trim() ? results : null;
  const current = pages.find((p) => p.id === pageId) ?? null;
  const viewersByPage = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const v of list?.viewers ?? []) if (v.pageId && v.userId !== me) (m.get(v.pageId) ?? m.set(v.pageId, new Set()).get(v.pageId)!).add(v.name);
    return m;
  }, [list?.viewers, me]);

  const move = (p: NotePageMeta, dir: -1 | 1) => {
    const siblings = pages.filter((x) => x.sectionId === p.sectionId && x.pinned === p.pinned);
    const i = siblings.findIndex((x) => x.id === p.id);
    const other = siblings[i + dir];
    if (!other) return;
    void meta(p.id, { sort: other.sort });
    void meta(other.id, { sort: p.sort });
  };

  const trashPage = async (p: NotePageMeta) => {
    if (!window.confirm(`ย้ายหน้า "${p.title}" ไปถังขยะ? (กู้คืนได้ภายใน ${NOTE_LIMITS.trashDays} วัน)`)) return;
    try {
      await api(`/api/report-task/notes/${p.id}`, { op: "trash" });
      if (p.id === pageId) open(null);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  };
  const row = (p: NotePageMeta) => (
    <PageRow
      key={p.id}
      p={p}
      active={p.id === pageId}
      editingNames={viewersByPage.get(p.id)}
      sections={sections}
      onOpen={() => open(p.id)}
      onMeta={(patch) => void meta(p.id, patch)}
      onMove={(dir) => move(p, dir)}
      onTrash={() => void trashPage(p)}
    />
  );

  const grouped = useMemo(() => {
    const noSection = pages.filter((p) => !p.sectionId || !sections.some((s) => s.id === p.sectionId));
    return { noSection, bySection: sections.map((s) => ({ s, pages: pages.filter((p) => p.sectionId === s.id) })) };
  }, [pages, sections]);

  const sidebar = (
    <aside className={cn("flex min-h-0 w-full shrink-0 flex-col border-r border-[var(--line)] bg-[#f8f9fb] lg:w-64", pageId && "hidden lg:flex")}>
      <div className="flex flex-col gap-2 border-b border-[var(--line)] p-2">
        <label className="flex h-10 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-white px-2">
          <Search className="h-4 w-4 shrink-0 text-[var(--ink-soft)]" aria-hidden="true" />
          <input aria-label="ค้นหาในโน้ตของห้องนี้" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาในโน้ตของห้องนี้" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none [@media(pointer:coarse)]:text-base" />
          {q && <button type="button" aria-label="ล้างคำค้น" onClick={() => setQ("")}><X className="h-4 w-4" /></button>}
        </label>
        <div className="relative flex gap-1.5">
          <button type="button" onClick={() => setNewMenu((v) => !v)} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#1b2537] text-[13px] font-semibold text-white">
            <Plus className="h-4 w-4" /> เพิ่มหน้า
          </button>
          <button type="button" title="เพิ่มส่วน (กลุ่มหน้า)" aria-label="เพิ่มส่วน" onClick={() => { const name = window.prompt("ชื่อส่วนใหม่ เช่น ข้อมูลห้อง / ขั้นตอนงาน"); if (name?.trim()) void section({ name }); }} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--line)] bg-white">
            <FolderPlus className="h-4 w-4" />
          </button>
          {newMenu && (
            <div className="absolute left-0 right-0 top-11 z-30 rounded-lg border border-[var(--line)] bg-white py-1 text-[13px] shadow-lg">
              {NOTE_TEMPLATES.map((t) => (
                <button key={t.id} type="button" onClick={() => void createPage(t.id, current?.sectionId ?? null)} className="block w-full px-3 py-2 text-left hover:bg-[var(--bg-soft)]">{t.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {error && <p className="p-2 text-[13px] text-red-700">{error}</p>}
        {!list && !error && <p className="p-2 text-[13px] text-[var(--ink-soft)]">กำลังโหลด…</p>}
        {shownResults ? (
          <>
            <p className="px-2 py-1 text-[11px] font-semibold text-[var(--ink-soft)]">ผลค้นหา {shownResults.length} หน้า</p>
            <ul>
              {shownResults.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => open(p.id)} className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-white">
                    <div className="truncate text-[13px] font-semibold">{p.title}</div>
                    {p.snippet && <div className="line-clamp-2 text-xs text-[var(--ink-soft)]">{p.snippet}</div>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          list && (
            <>
              {pages.length === 0 && <p className="p-3 text-[13px] leading-relaxed text-[var(--ink-soft)]">ยังไม่มีโน้ตในห้องนี้ — กด &quot;เพิ่มหน้า&quot; เก็บเบอร์ติดต่อ รหัส รูปสำคัญ หรือเช็กลิสต์ของห้องไว้ที่นี่ ทุกคนในห้องเห็นและแก้ได้</p>}
              <ul>{grouped.noSection.map(row)}</ul>
              {grouped.bySection.map(({ s, pages: ps }) => (
                <div key={s.id} className="mt-2">
                  <div className="group flex items-center gap-1 px-2 py-1">
                    <span className="h-2.5 w-2.5 rounded-sm bg-violet-600" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wide text-[var(--ink-soft)]">{s.name}</span>
                    <button type="button" className="hidden text-[11px] text-[var(--ink-soft)] underline group-hover:inline [@media(pointer:coarse)]:inline" onClick={() => { const name = window.prompt("เปลี่ยนชื่อส่วน", s.name); if (name?.trim()) void section({ id: s.id, name }); }}>แก้ชื่อ</button>
                    <button type="button" className="hidden text-[11px] text-red-700 underline group-hover:inline [@media(pointer:coarse)]:inline" onClick={() => { if (window.confirm(`ลบส่วน "${s.name}"? หน้าข้างในย้ายไปไว้ "ไม่มีส่วน" (ไม่หาย)`)) void section({ id: s.id, remove: true }); }}>ลบ</button>
                  </div>
                  <ul>{ps.map(row)}</ul>
                  {ps.length === 0 && <p className="px-3 pb-1 text-xs text-[var(--ink-soft)]">ยังไม่มีหน้า — เปิดหน้าแล้วใช้ ⋯ › ย้ายไป</p>}
                </div>
              ))}
            </>
          )
        )}
      </div>
      <div className="border-t border-[var(--line)] p-1.5">
        <button type="button" onClick={() => void showTrash()} className="inline-flex h-9 w-full items-center gap-2 rounded-md px-2 text-[13px] text-[var(--ink-soft)] hover:bg-white">
          <Trash2 className="h-4 w-4" /> ถังขยะ (กู้คืนได้ {NOTE_LIMITS.trashDays} วัน)
        </button>
      </div>
    </aside>
  );

  return (
    <div className="relative flex min-h-0 flex-1 bg-white">
      {sidebar}
      <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !pageId && !trash && "hidden lg:flex")}>
        {trash ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center gap-2">
              <button type="button" onClick={() => setTrash(null)} className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-[var(--bg-soft)]"><ArrowLeft className="h-4 w-4" /> กลับ</button>
              <h3 className="text-base font-bold">ถังขยะของโน้ต</h3>
            </div>
            {trash.length === 0 && <p className="text-sm text-[var(--ink-soft)]">ถังขยะว่าง</p>}
            <ul className="divide-y divide-[var(--line)]">
              {trash.map((p) => {
                const left = Math.max(0, NOTE_LIMITS.trashDays - Math.floor(((trashData?.at ?? 0) - new Date(p.deletedAt!).getTime()) / 86_400_000));
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{p.title}</div>
                      <div className="text-xs text-[var(--ink-soft)]">ลบโดย {p.deletedByName || "—"} · ลบถาวรในอีก {left} วัน</div>
                    </div>
                    <button type="button" onClick={async () => { try { await api(`/api/report-task/notes/${p.id}`, { op: "restore" }); await load(); await showTrash(); flash("กู้คืนแล้ว"); } catch (e) { flash(e instanceof Error ? e.message : "กู้คืนไม่สำเร็จ"); } }} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--line)] px-3 text-sm">
                      <RotateCcw className="h-4 w-4" /> กู้คืน
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : pageId ? (
          <PageView
            key={pageId}
            pageId={pageId}
            topicId={topic.id}
            me={me}
            myName={myName}
            meta={current}
            othersHere={[...(viewersByPage.get(pageId) ?? [])]}
            template={templates[pageId] ?? null}
            onTemplateUsed={() => setTemplates(({ [pageId]: _used, ...rest }) => rest)}
            onBack={() => open(null)}
            onRename={(title) => void meta(pageId, { title })}
            onError={flash}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-[var(--ink-soft)]">เลือกหน้าทางซ้าย หรือกด &quot;เพิ่มหน้า&quot;</div>
        )}
      </section>
      {toast && (
        <div role="status" className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-[#1b2537] px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function PageRow({
  p,
  active,
  editingNames,
  sections,
  onOpen,
  onMeta,
  onMove,
  onTrash,
}: {
  p: NotePageMeta;
  active: boolean;
  editingNames: Set<string> | undefined;
  sections: NoteSectionMeta[];
  onOpen: () => void;
  onMeta: (patch: Record<string, unknown>) => void;
  onMove: (dir: -1 | 1) => void;
  onTrash: () => void;
}) {
    const [menu, setMenu] = useState(false);
    const editing = editingNames;
    return (
      <li className="group relative">
        <button
          type="button"
          onClick={onOpen}
          className={cn("flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-left text-[13px]", active ? "bg-[#dde3eb] font-semibold" : "hover:bg-white")}
        >
          {p.pinned && <Pin className="h-3 w-3 shrink-0 text-[var(--ink-soft)]" aria-label="ปักหมุด" />}
          <span className="min-w-0 flex-1 truncate">{p.title}</span>
          {editing && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title={`${[...editing].join(", ")} กำลังดู/แก้`} />}
        </button>
        <button type="button" aria-label={`ตัวเลือกหน้า ${p.title}`} onClick={() => setMenu((v) => !v)} className="absolute right-1 top-1 hidden h-7 w-7 items-center justify-center rounded-md bg-white/80 group-hover:inline-flex [@media(pointer:coarse)]:inline-flex">
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menu && (
          <div className="absolute right-1 top-9 z-30 w-52 rounded-lg border border-[var(--line)] bg-white py-1 text-[13px] shadow-lg" onMouseLeave={() => setMenu(false)}>
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 hover:bg-[var(--bg-soft)]" onClick={() => { setMenu(false); onMeta({ pinned: !p.pinned }); }}>
              {p.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />} {p.pinned ? "เลิกปักหมุด" : "ปักหมุดไว้บนสุด"}
            </button>
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 hover:bg-[var(--bg-soft)]" onClick={() => { setMenu(false); onMove(-1); }}><ChevronUp className="h-4 w-4" /> เลื่อนขึ้น</button>
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 hover:bg-[var(--bg-soft)]" onClick={() => { setMenu(false); onMove(1); }}><ChevronDown className="h-4 w-4" /> เลื่อนลง</button>
            {sections.length > 0 && (
              <label className="flex items-center gap-2 px-3 py-2">
                ย้ายไป
                <select className="min-w-0 flex-1 rounded border border-[var(--line)] px-1 py-1" value={p.sectionId ?? ""} onChange={(e) => { setMenu(false); onMeta({ sectionId: e.target.value || null }); }}>
                  <option value="">ไม่มีส่วน</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-red-700 hover:bg-red-50" onClick={() => { setMenu(false); onTrash(); }}><Trash2 className="h-4 w-4" /> ย้ายไปถังขยะ</button>
          </div>
        )}
      </li>
    );
  }

const STATUS_TEXT: Record<NoteSyncStatus, string> = { saved: "บันทึกแล้ว", saving: "กำลังบันทึก…", offline: "ออฟไลน์ — เก็บไว้ในเครื่อง ส่งเมื่อเน็ตกลับมา", error: "" };

function PageView({
  pageId,
  topicId,
  me,
  myName,
  meta,
  othersHere,
  template,
  onTemplateUsed,
  onBack,
  onRename,
  onError,
}: {
  pageId: string;
  topicId: string;
  me: string;
  myName: string;
  meta: NotePageMeta | null;
  othersHere: string[];
  template: JSONContent | null;
  onTemplateUsed: () => void;
  onBack: () => void;
  onRename: (title: string) => void;
  onError: (m: string) => void;
}) {
  const [provider, setProvider] = useState<NoteProvider | null>(null);
  const [loadError, setLoadError] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [status, setStatus] = useState<NoteSyncStatus>("saved");
  const [statusError, setStatusError] = useState("");
  const [loadedTitle, setLoadedTitle] = useState("");
  /** กำลังพิมพ์ชื่อ (null = แสดงชื่อล่าสุดจากรายชื่อหน้า — คนอื่นเปลี่ยนชื่อก็เห็นทันที) */
  const [draft, setDraft] = useState<string | null>(null);
  const title = draft ?? meta?.title ?? loadedTitle;
  const [history, setHistory] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    let p: NoteProvider | null = null;
    let cancelled = false;
    void api<{ state: string; title: string; deleted: boolean }>(`/api/report-task/notes/${pageId}`)
      .then((d) => {
        if (cancelled) return;
        setLoadedTitle(d.title);
        setDeleted(d.deleted);
        p = new NoteProvider(pageId, topicId, d.state, { id: me, name: myName });
        p.onChange(() => {
          setStatus(p!.status);
          setStatusError(p!.error);
        });
        setProvider(p);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "เปิดหน้าไม่สำเร็จ"));
    return () => {
      cancelled = true;
      p?.destroy();
    };
  }, [pageId, topicId, me, myName]);

  const onEditor = useCallback(
    (e: Editor | null) => {
      editorRef.current = e;
      // หน้าสำเร็จรูป: ใส่ครั้งเดียวตอนหน้ายังว่าง
      if (e && template && e.isEmpty) {
        e.commands.setContent(template);
        onTemplateUsed();
      }
    },
    [template, onTemplateUsed],
  );

  const user = useMemo(() => ({ id: me, name: myName, color: colorFor(me) }), [me, myName]);

  if (loadError) return <div className="p-6 text-sm text-red-700">{loadError}</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2 sm:px-6">
        <button type="button" onClick={onBack} aria-label="กลับไปรายชื่อหน้า" className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-[var(--bg-soft)] lg:hidden">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <input
          aria-label="ชื่อหน้า"
          value={title}
          maxLength={NOTE_LIMITS.titleChars}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null && draft.trim() && draft !== meta?.title) onRename(draft);
            setDraft(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 border-b border-transparent bg-transparent py-1 text-xl font-medium outline-none focus:border-[var(--line)] sm:text-2xl"
        />
        {othersHere.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-[var(--ink-soft)]" title={othersHere.join(", ")}>
            {othersHere.slice(0, 3).map((n) => (
              <span key={n} className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white" style={{ background: colorFor(n) }}>{n.slice(0, 2)}</span>
            ))}
            <span className="hidden sm:inline">{othersHere.length === 1 ? `${othersHere[0]} อยู่ในหน้านี้` : `อีก ${othersHere.length} คนอยู่ในหน้านี้`}</span>
          </span>
        )}
        <span className={cn("text-xs", status === "error" ? "font-semibold text-red-700" : status === "offline" ? "text-amber-800" : "text-[var(--ink-soft)]")} role="status">
          {status === "error" ? statusError : STATUS_TEXT[status]}
        </span>
        <button type="button" onClick={() => setHistory((v) => !v)} className={cn("inline-flex h-9 items-center gap-1 rounded-md px-2 text-[13px] hover:bg-[var(--bg-soft)]", history && "bg-[#dde3eb] font-semibold")}>
          <History className="h-4 w-4" /> <span className="hidden sm:inline">ประวัติ</span>
        </button>
      </div>
      {meta && <div className="px-4 pt-1 text-xs text-[var(--ink-soft)] sm:px-8">แก้ล่าสุด {ago(meta.updatedAt)}{meta.updatedByName ? ` โดย ${meta.updatedByName}` : ""}</div>}
      {deleted && <div className="bg-amber-50 px-4 py-2 text-sm text-amber-900">หน้านี้อยู่ในถังขยะ — กู้คืนจากถังขยะก่อนแก้</div>}
      {history && (
        <NoteHistory
          pageId={pageId}
          onClose={() => setHistory(false)}
          onRestore={(json) => {
            editorRef.current?.commands.setContent(json);
            setHistory(false);
          }}
        />
      )}
      {/* ตัวแก้ค้างไว้ตอนเปิดประวัติ (ซ่อนเฉย ๆ) — กู้คืนต้องเขียนผ่านตัวนี้ และไม่ต้องโหลดใหม่ตอนกลับ */}
      <div className={cn("flex min-h-0 flex-1 flex-col", history && "hidden")}>
        {provider ? <NoteEditor provider={provider} user={user} readOnly={deleted} onError={onError} onEditor={onEditor} /> : <div className="p-6 text-sm text-[var(--ink-soft)]">กำลังเปิด…</div>}
      </div>
    </div>
  );
}
