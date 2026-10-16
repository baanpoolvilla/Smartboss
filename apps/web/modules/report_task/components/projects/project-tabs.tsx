"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { TaskCard } from "@/modules/report_task/components/kanban/task-card";
import { getUser } from "@/modules/report_task/lib/directory";
import { dayNum, ymdOfDay, type TimelineItem } from "@/modules/report_task/lib/project-schedule";
import { uuid } from "@/modules/report_task/lib/uuid";
import { cn } from "@/modules/report_task/lib/utils";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useProjectStore } from "@/modules/report_task/store/project-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Attachment, Project, TaskStatus } from "@/modules/report_task/types";
import { addChannelMembers, createGroupChannel, fetchMessages, sendMessage } from "@/modules/chat/lib/api";
import { CHAT_PAGE_PATH } from "@/modules/chat/constants";
import type { ChatMessageDTO } from "@/modules/chat/types";
import { PersonDot, STATE_COLOR, STATE_LABEL, TH_MONTH_SHORT, fmtDay } from "./project-ui";

const seg = (on: boolean) => cn("rounded-md px-3 py-1 text-xs", on ? "bg-[var(--bg)] font-semibold shadow-sm" : "text-[var(--ink-soft)]");
const segWrap = "inline-flex rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-0.5";
const selectCls = "rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-base sm:text-xs";

/* ───────────── รายการ: จัดกลุ่ม / เรียง / กรอง (แบบ Asana List) ───────────── */

type SortKey = "due" | "start" | "person" | "status" | "name";
const STATE_ORDER: Record<string, number> = { late: 0, doing: 1, todo: 2, done: 3 };

export function ListTab({ project, items, onOpen }: { project: Project; items: TimelineItem[]; onOpen: (id: string) => void }) {
  const [group, setGroup] = useState<"section" | "none">("section");
  const [sort, setSort] = useState<SortKey>("due");
  const [hideDone, setHideDone] = useState(false);
  const [person, setPerson] = useState("");
  const byId = new Map(items.map((i) => [i.id, i]));
  const people = [...new Set(items.flatMap((i) => i.assigneeIds))];
  const shown = items
    .filter((i) => (!hideDone || i.state !== "done") && (!person || i.assigneeIds.includes(person)))
    .sort((a, b) => {
      if (sort === "start") return a.start.localeCompare(b.start);
      if (sort === "name") return a.name.localeCompare(b.name, "th");
      if (sort === "status") return STATE_ORDER[a.state]! - STATE_ORDER[b.state]! || a.end.localeCompare(b.end);
      if (sort === "person") return (getUser(a.assigneeIds[0] ?? "")?.name ?? "~").localeCompare(getUser(b.assigneeIds[0] ?? "")?.name ?? "~", "th");
      return a.end.localeCompare(b.end);
    });
  const groups = group === "section"
    ? project.sections.map((s) => ({ key: s.id, name: s.name, rows: shown.filter((i) => i.sectionId === s.id) }))
    : [{ key: "all", name: "", rows: shown }];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className={segWrap}><button type="button" className={seg(group === "section")} onClick={() => setGroup("section")}>ตามช่วงงาน</button><button type="button" className={seg(group === "none")} onClick={() => setGroup("none")}>ไม่จัดกลุ่ม</button></div>
        <label className="flex items-center gap-1 text-xs text-[var(--ink-soft)]">เรียงตาม
          <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="due">กำหนดส่ง</option><option value="start">วันเริ่ม</option><option value="person">ผู้รับผิดชอบ</option><option value="status">สถานะ</option><option value="name">ชื่องาน</option>
          </select>
        </label>
        <select className={selectCls} value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">ทุกคน</option>
          {people.map((id) => <option key={id} value={id}>{getUser(id)?.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="accent-[var(--brand-green)]" />ซ่อนที่เสร็จแล้ว</label>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
        <table className="w-full min-w-[640px] border-collapse text-[13.5px]">
          <thead>
            <tr className="text-left text-xs text-[var(--ink-soft)]">
              {["งาน", "ผู้รับผิดชอบ", "เริ่ม", "ส่ง", "สถานะ", "ต้องรอ"].map((h) => <th key={h} className="border-b border-[var(--line)] px-3 py-2 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              g.name ? <tr key={`g-${g.key}`}><td colSpan={6} className="bg-[var(--bg-soft)] px-3 py-1.5 text-xs font-bold text-[var(--ink-soft)]">{g.name} · {g.rows.length}</td></tr> : null,
              ...g.rows.map((i) => (
                <tr key={i.id} className={cn("border-b border-[var(--line)]/60", i.kind === "task" && "cursor-pointer hover:bg-[var(--bg-soft)]")} onClick={() => i.kind === "task" && onOpen(i.id)}>
                  <td className={cn("px-3 py-2", i.state === "done" && "text-[var(--ink-soft)] line-through")}>{i.kind === "milestone" ? "◆ " : ""}{i.name}</td>
                  <td className="px-3 py-2">{i.assigneeIds.length ? <span className="inline-flex items-center gap-1.5"><PersonDot userId={i.assigneeIds[0]!} size={20} /><span className="text-xs">{getUser(i.assigneeIds[0]!)?.name}{i.assigneeIds.length > 1 ? ` +${i.assigneeIds.length - 1}` : ""}</span></span> : "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtDay(i.start)}</td>
                  <td className="px-3 py-2 tabular-nums">{i.kind === "milestone" ? "—" : fmtDay(i.end)}</td>
                  <td className="px-3 py-2"><span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: STATE_COLOR[i.state] }}>{STATE_LABEL[i.state]}</span></td>
                  <td className="px-3 py-2 text-xs text-[var(--ink-soft)]">{i.deps.map((d) => byId.get(d)?.name).filter(Boolean).join(", ") || "—"}</td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───────────── บอร์ด: คอลัมน์ตามสถานะ หรือตามช่วงงาน (ลากการ์ดย้ายช่วงได้ แบบ Asana Board) ───────────── */

export function BoardTab({ project, items, canEdit, onOpen }: { project: Project; items: TimelineItem[]; canEdit: boolean; onOpen: (id: string) => void }) {
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const setTaskProject = useTaskStore((s) => s.setTaskProject);
  const moveTask = useTaskStore((s) => s.moveTask);
  const [by, setBy] = useState<"section" | "status">("section");
  const [over, setOver] = useState<string | null>(null);
  const tasks = items.filter((i) => i.kind === "task" && i.task).map((i) => i.task!);
  const cols =
    by === "section"
      ? project.sections.map((s) => ({ key: s.id, label: s.name, list: tasks.filter((t) => t.project?.sectionId === s.id) }))
      : ([["todo", "ต้องทำ"], ["in_progress", "กำลังทำ"], ["done", "เสร็จแล้ว"]] as const).map(([k, l]) => ({ key: k, label: l, list: tasks.filter((t) => t.status === k) }));
  function drop(col: string, taskId: string) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (by === "section") {
      if (t.project?.sectionId === col) return;
      setTaskProject(t.id, { ...t.project!, sectionId: col }, me);
      toast.success(`ย้าย "${t.title}" ไปช่วง ${project.sections.find((s) => s.id === col)?.name}`);
    } else if (t.status !== col) {
      moveTask(t.id, col as TaskStatus);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className={segWrap}><button type="button" className={seg(by === "section")} onClick={() => setBy("section")}>ตามช่วงงาน</button><button type="button" className={seg(by === "status")} onClick={() => setBy("status")}>ตามสถานะ</button></div>
        <span className="text-xs text-[var(--ink-soft)]">การ์ดชุดเดียวกับบอร์ดงานหลัก{canEdit ? " · ลากการ์ดไปคอลัมน์อื่นได้" : ""}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {cols.map((c) => (
          <div key={c.key}
            onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(c.key); } }}
            onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); drop(c.key, e.dataTransfer.getData("text/task")); }}
            className={cn("grid w-72 shrink-0 content-start gap-2 rounded-xl bg-[var(--bg-soft)] p-2.5", over === c.key && "ring-2 ring-[var(--brand-green)]")}>
            <div className="flex justify-between text-xs font-semibold text-[var(--ink-soft)]"><span className="truncate">{c.label}</span><span>{c.list.length}</span></div>
            {c.list.map((t) => (
              <div key={t.id} draggable={canEdit} onDragStart={(e) => e.dataTransfer.setData("text/task", t.id)}>
                <TaskCard task={t} onOpen={onOpen} />
              </div>
            ))}
            {!c.list.length && <p className="m-0 py-4 text-center text-xs text-[var(--ink-soft)]">ว่าง</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── ปฏิทิน: เดือน แสดงงานตามช่วงวัน + Milestone (แบบ Asana Calendar) ───────────── */

export function CalendarTab({ items, today, onOpen }: { items: TimelineItem[]; today: string; onOpen: (id: string) => void }) {
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [hideDone, setHideDone] = useState(false);
  const y = +month.slice(0, 4), m = +month.slice(5, 7) - 1;
  const first = Date.UTC(y, m, 1) / 864e5;
  const startDow = new Date(first * 864e5).getUTCDay();
  const gridStart = first - startDow;
  const days = Array.from({ length: 42 }, (_, k) => gridStart + k);
  const shown = items.filter((i) => !hideDone || i.state !== "done");
  const shiftMonth = (n: number) => { const d = new Date(Date.UTC(y, m + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-sm" onClick={() => shiftMonth(-1)} aria-label="เดือนก่อน">‹</button>
        <b className="min-w-28 text-center">{TH_MONTH_SHORT[m]} {y + 543}</b>
        <button type="button" className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-sm" onClick={() => shiftMonth(1)} aria-label="เดือนถัดไป">›</button>
        <button type="button" className="rounded-lg border border-[var(--line)] px-3 py-1 text-xs" onClick={() => setMonth(today.slice(0, 7))}>เดือนนี้</button>
        <label className="ml-auto flex items-center gap-1.5 text-xs"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="accent-[var(--brand-green)]" />ซ่อนที่เสร็จแล้ว</label>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[700px] grid-cols-7 overflow-hidden rounded-xl border border-[var(--line)]">
          {["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map((d) => <div key={d} className="border-b border-[var(--line)] bg-[var(--bg-soft)] py-1.5 text-center text-xs font-semibold text-[var(--ink-soft)]">{d}</div>)}
          {days.map((d) => {
            const s = ymdOfDay(d), inMonth = new Date(d * 864e5).getUTCMonth() === m;
            const its = shown.filter((i) => dayNum(i.start) <= d && d <= dayNum(i.end));
            return (
              <div key={d} className={cn("min-h-24 border-b border-r border-[var(--line)] p-1", !inMonth && "bg-[var(--bg-soft)]/60")}>
                <div className={cn("mb-1 text-right text-[11px] tabular-nums", s === today ? "font-bold text-[var(--chart-red)]" : inMonth ? "" : "text-[var(--ink-soft)]")}>{new Date(d * 864e5).getUTCDate()}</div>
                <div className="grid gap-0.5">
                  {its.slice(0, 4).map((i) => {
                    const isStart = dayNum(i.start) === d, isEnd = dayNum(i.end) === d;
                    return (
                      <button key={i.id} type="button" onClick={() => i.kind === "task" && onOpen(i.id)} title={`${i.name} · ${fmtDay(i.start)}${i.kind === "task" ? ` – ${fmtDay(i.end)}` : ""}`}
                        className={cn("truncate px-1.5 py-px text-left text-[11px] font-semibold text-white", isStart ? "rounded-l" : "", isEnd ? "rounded-r" : "", !isStart && "opacity-70")}
                        style={{ background: i.kind === "milestone" ? "var(--chart-violet)" : STATE_COLOR[i.state] }}>
                        {i.kind === "milestone" ? "◆ " : ""}{isStart || new Date(d * 864e5).getUTCDay() === 0 ? i.name : " "}
                      </button>
                    );
                  })}
                  {its.length > 4 && <span className="text-[10px] text-[var(--ink-soft)]">+{its.length - 4} อีก</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────────── แดชบอร์ด: ตัวเลข + กราฟสำเร็จรูป (แบบ Asana Dashboard) ───────────── */

export function DashboardTab({ project, items, today, onOpen }: { project: Project; items: TimelineItem[]; today: string; onOpen: (id: string) => void }) {
  const tasks = items.filter((i) => i.kind === "task");
  const states = ["done", "doing", "todo", "late"] as const;
  const count = (arr: TimelineItem[], s: string) => arr.filter((i) => i.state === s).length;
  const people = [...new Set(tasks.flatMap((i) => i.assigneeIds))].map((id) => ({ id, list: tasks.filter((t) => t.assigneeIds.includes(id)) })).sort((a, b) => b.list.length - a.list.length);
  const maxPerson = Math.max(1, ...people.map((p) => p.list.length));
  const late = tasks.filter((t) => t.state === "late").sort((a, b) => a.end.localeCompare(b.end));
  const upcoming = tasks.filter((t) => t.state !== "done" && t.state !== "late" && dayNum(t.end) - dayNum(today) <= 7).sort((a, b) => a.end.localeCompare(b.end));
  const Bar = ({ arr }: { arr: TimelineItem[] }) => (
    <span className="flex h-3 overflow-hidden rounded-full bg-[var(--bg-soft)]">
      {states.map((s) => { const n = count(arr, s); return n ? <span key={s} title={`${STATE_LABEL[s]} ${n}`} style={{ width: `${(n / Math.max(1, arr.length)) * 100}%`, background: STATE_COLOR[s] }} /> : null; })}
    </span>
  );
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[["งานทั้งหมด", tasks.length, "var(--ink)"], ...states.map((s) => [STATE_LABEL[s]!, count(tasks, s), STATE_COLOR[s]!] as const)].map(([l, n, c]) => (
          <div key={String(l)} className="rounded-xl border border-[var(--line)] p-3"><b className="block text-2xl tabular-nums" style={{ color: String(c) }}>{n}</b><span className="text-xs text-[var(--ink-soft)]">{l}</span></div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="grid content-start gap-2 rounded-xl border border-[var(--line)] p-4">
          <h3 className="m-0 text-sm font-semibold">งานตามช่วงงาน</h3>
          {project.sections.map((s) => { const arr = tasks.filter((t) => t.sectionId === s.id); return (
            <div key={s.id} className="grid gap-1"><div className="flex justify-between text-xs"><span>{s.name}</span><span className="text-[var(--ink-soft)]">{count(arr, "done")}/{arr.length} เสร็จ</span></div><Bar arr={arr} /></div>
          ); })}
        </section>
        <section className="grid content-start gap-2 rounded-xl border border-[var(--line)] p-4">
          <h3 className="m-0 text-sm font-semibold">งานต่อคน</h3>
          {people.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-xs">
              <PersonDot userId={p.id} size={20} />
              <span className="w-28 truncate">{getUser(p.id)?.name}</span>
              <span className="flex-1"><span className="block" style={{ width: `${(p.list.length / maxPerson) * 100}%` }}><Bar arr={p.list} /></span></span>
              <span className="w-6 text-right tabular-nums">{p.list.length}</span>
            </div>
          ))}
          <div className="flex flex-wrap gap-3 text-[11px] text-[var(--ink-soft)]">{states.map((s) => <span key={s} className="inline-flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-sm" style={{ background: STATE_COLOR[s] }} />{STATE_LABEL[s]}</span>)}</div>
        </section>
        <section className="grid content-start gap-1.5 rounded-xl border border-[var(--line)] p-4">
          <h3 className="m-0 text-sm font-semibold" style={{ color: STATE_COLOR.late }}>เลยกำหนด ({late.length})</h3>
          {late.length ? late.map((t) => (
            <button key={t.id} type="button" onClick={() => onOpen(t.id)} className="flex items-center gap-2 rounded-lg px-1 py-1 text-left text-sm hover:bg-[var(--bg-soft)]">
              {t.assigneeIds[0] && <PersonDot userId={t.assigneeIds[0]} size={18} />}<span className="min-w-0 flex-1 truncate">{t.name}</span><span className="text-xs text-red-600">เลย {dayNum(today) - dayNum(t.end)} วัน</span>
            </button>
          )) : <p className="m-0 text-sm text-[var(--ink-soft)]">ไม่มี 🎉</p>}
        </section>
        <section className="grid content-start gap-1.5 rounded-xl border border-[var(--line)] p-4">
          <h3 className="m-0 text-sm font-semibold">ครบกำหนดใน 7 วัน ({upcoming.length})</h3>
          {upcoming.length ? upcoming.map((t) => (
            <button key={t.id} type="button" onClick={() => onOpen(t.id)} className="flex items-center gap-2 rounded-lg px-1 py-1 text-left text-sm hover:bg-[var(--bg-soft)]">
              {t.assigneeIds[0] && <PersonDot userId={t.assigneeIds[0]} size={18} />}<span className="min-w-0 flex-1 truncate">{t.name}</span><span className="text-xs text-[var(--ink-soft)]">{fmtDay(t.end)}</span>
            </button>
          )) : <p className="m-0 text-sm text-[var(--ink-soft)]">ไม่มี</p>}
        </section>
      </div>
    </div>
  );
}

/* ───────────── ไฟล์: รูป/ไฟล์จากทุกงานในโปรเจกต์ (แบบ Asana Files) ───────────── */

export function FilesTab({ items, onOpen }: { items: TimelineItem[]; onOpen: (id: string) => void }) {
  const [kind, setKind] = useState<"all" | "image" | "file">("all");
  const files = useMemo(() => {
    const out: { a: Attachment; taskId: string; taskName: string }[] = [];
    for (const i of items) {
      const t = i.task;
      if (!t) continue;
      for (const a of t.attachments) if (a.url || a.dataUrl) out.push({ a, taskId: t.id, taskName: t.title });
      for (const c of t.comments) for (const a of c.attachments ?? []) if (a.url || a.dataUrl) out.push({ a, taskId: t.id, taskName: t.title });
    }
    return out.sort((x, y) => (y.a.uploadedAt ?? "").localeCompare(x.a.uploadedAt ?? ""));
  }, [items]);
  const isImg = (a: Attachment) => (a.mime ?? a.type ?? "").startsWith("image") || /\.(png|jpe?g|webp|gif|heic)$/i.test(a.name);
  const shown = files.filter((f) => kind === "all" || (kind === "image" ? isImg(f.a) : !isImg(f.a)));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className={segWrap}>{([["all", "ทั้งหมด"], ["image", "รูปภาพ"], ["file", "ไฟล์"]] as const).map(([k, l]) => <button key={k} type="button" className={seg(kind === k)} onClick={() => setKind(k)}>{l}</button>)}</div>
        <span className="text-xs text-[var(--ink-soft)]">{shown.length} รายการ · รวมจากไฟล์แนบและความคิดเห็นของทุกงาน</span>
      </div>
      {shown.length === 0 ? <p className="py-10 text-center text-sm text-[var(--ink-soft)]">ยังไม่มีไฟล์ในโปรเจกต์นี้</p> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {shown.map(({ a, taskId, taskName }) => (
            <div key={`${taskId}-${a.id}`} className="grid gap-1 overflow-hidden rounded-xl border border-[var(--line)]">
              <a href={a.url ?? a.dataUrl} target="_blank" rel="noreferrer" className="block aspect-square bg-[var(--bg-soft)]">
                {isImg(a) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url ?? a.dataUrl} alt={a.name} className="h-full w-full object-cover" loading="lazy" />
                ) : <span className="grid h-full place-items-center p-2 text-center text-xs text-[var(--ink-soft)]">📄<br />{a.name}</span>}
              </a>
              <button type="button" onClick={() => onOpen(taskId)} className="truncate px-2 pb-1.5 text-left text-[11px] text-[var(--ink-soft)] hover:text-[var(--ink)]" title={taskName}>จาก: {taskName}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────── ข้อความ: ห้องแชทของโปรเจกต์ (แบบ Asana Messages — ใช้ระบบแชทที่มีอยู่ แจ้งเตือน/LINE ได้ทันที) ───────────── */

export function MessagesTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const updateProject = useProjectStore((s) => s.updateProject);
  const [msgs, setMsgs] = useState<ChatMessageDTO[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const memberIds = [...new Set([project.ownerId, ...project.members.map((m) => m.userId)])];
  const ch = project.chatChannelId;

  useEffect(() => {
    if (!ch) return;
    let stop = false;
    const load = () => fetchMessages(ch).then((p) => { if (!stop) setMsgs(p.messages); }).catch(() => { if (!stop) setMsgs([]); });
    load();
    const t = setInterval(load, 15000);
    return () => { stop = true; clearInterval(t); };
  }, [ch]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [msgs]);

  async function createRoom() {
    setBusy(true);
    try {
      const { channelId } = await createGroupChannel(`📁 ${project.name}`, memberIds.filter((id) => id !== me));
      updateProject(project.id, { chatChannelId: channelId });
      toast.success("สร้างห้องแชทของโปรเจกต์แล้ว · สมาชิกโปรเจกต์อยู่ในห้องครบ");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างห้องไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!ch || !text.trim()) return;
    const body = text.trim();
    setText("");
    try {
      const { message } = await sendMessage(ch, { body, clientId: `pm-${uuid()}` });
      setMsgs((m) => [...(m ?? []), message]);
    } catch (err) {
      setText(body);
      toast.error(err instanceof Error ? err.message : "ส่งไม่สำเร็จ");
    }
  }

  if (!ch) {
    return (
      <div className="grid max-w-xl place-items-start gap-2 rounded-xl border border-dashed border-[var(--line)] p-5">
        <b>คุยกันในโปรเจกต์</b>
        <p className="m-0 text-sm text-[var(--ink-soft)]">สร้างห้องแชทของโปรเจกต์นี้ ใส่สมาชิกโปรเจกต์ {memberIds.length} คนให้อัตโนมัติ คุยที่นี่หรือในเมนูแชทก็ได้ แจ้งเตือนและ LINE ทำงานเหมือนห้องแชทปกติ</p>
        {canEdit ? (
          <button type="button" disabled={busy} onClick={createRoom} className="rounded-lg bg-[var(--brand-green)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60">สร้างห้องแชทของโปรเจกต์</button>
        ) : <p className="m-0 text-xs text-[var(--ink-soft)]">ให้เจ้าของโปรเจกต์หรือสมาชิกที่แก้ได้เป็นคนสร้าง</p>}
      </div>
    );
  }
  return (
    <div className="grid max-w-3xl gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`${CHAT_PAGE_PATH}?c=${encodeURIComponent(ch)}`} className="rounded-lg border border-[var(--line)] px-3 py-1 text-xs hover:bg-[var(--bg-soft)]">เปิดในหน้าแชท (ส่งรูป/ไฟล์/สติกเกอร์)</Link>
        {canEdit && (
          <button type="button" className="rounded-lg border border-[var(--line)] px-3 py-1 text-xs hover:bg-[var(--bg-soft)]"
            onClick={() => addChannelMembers(ch, memberIds).then(() => toast.success("เพิ่มสมาชิกโปรเจกต์เข้าห้องครบแล้ว")).catch((e) => toast.error(e instanceof Error ? e.message : "ไม่สำเร็จ"))}>
            ดึงสมาชิกโปรเจกต์เข้าห้อง
          </button>
        )}
      </div>
      <div className="grid max-h-[55dvh] min-h-48 content-start gap-2 overflow-y-auto rounded-xl border border-[var(--line)] p-3">
        {msgs === null ? <p className="text-sm text-[var(--ink-soft)]">กำลังโหลด…</p> : msgs.filter((m) => !m.deleted && (m.body || m.attachments.length)).length === 0 ? <p className="text-sm text-[var(--ink-soft)]">ยังไม่มีข้อความ เริ่มคุยได้เลย</p> : (
          msgs.filter((m) => !m.deleted && (m.body || m.attachments.length)).map((m) => (
            <div key={m.id} className={cn("flex gap-2", m.authorId === me && "flex-row-reverse")}>
              <PersonDot userId={m.authorId} size={26} />
              <div className={cn("max-w-[78%] rounded-2xl px-3 py-1.5 text-sm", m.authorId === me ? "bg-[var(--accent)]" : "bg-[var(--bg-soft)]")}>
                <div className="text-[11px] text-[var(--ink-soft)]">{getUser(m.authorId)?.name ?? ""} · {new Date(m.createdAt).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                {m.body && <p className="m-0 whitespace-pre-wrap break-words">{m.body}</p>}
                {m.attachments.length > 0 && <p className="m-0 text-xs text-[var(--ink-soft)]">📎 {m.attachments.length} ไฟล์ — ดูในหน้าแชท</p>}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="พิมพ์ข้อความถึงทุกคนในโปรเจกต์"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-base sm:text-sm" />
        <button type="button" disabled={!text.trim()} onClick={() => void send()} className="rounded-xl bg-[var(--brand-green)] px-4 text-sm font-semibold text-white disabled:opacity-50">ส่ง</button>
      </div>
    </div>
  );
}
