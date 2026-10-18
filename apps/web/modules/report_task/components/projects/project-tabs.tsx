"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { TaskCard } from "@/modules/report_task/components/kanban/task-card";
import { getUser } from "@/modules/report_task/lib/directory";
import { dayNum, dayToIso, depRuleLabel, isTopLevel, withSubtasks, ymdOfDay, type TimelineItem } from "@/modules/report_task/lib/project-schedule";
import { uuid } from "@/modules/report_task/lib/uuid";
import { cn } from "@/modules/report_task/lib/utils";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useProjectStore } from "@/modules/report_task/store/project-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Attachment, Project, TaskStatus } from "@/modules/report_task/types";
import { addChannelMembers, createGroupChannel, fetchMessages, sendMessage } from "@/modules/chat/lib/api";
import { CHAT_PAGE_PATH } from "@/modules/chat/constants";
import type { ChatMessageDTO } from "@/modules/chat/types";
import { PersonDot, STATE_COLOR, STATE_LABEL, StatePill, TH_MONTH_SHORT, ensureProjectMembers, fmtDay } from "./project-ui";

const seg = (on: boolean) => cn("rounded-md px-3 py-1 text-xs", on ? "bg-[var(--bg)] font-semibold shadow-sm" : "text-[var(--ink-soft)]");
const segWrap = "inline-flex rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-0.5";
const selectCls = "rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-base sm:text-xs";

/* ───────────── รายการ: จัดกลุ่ม / เรียง / กรอง (แบบ Asana List) ───────────── */

type SortKey = "due" | "start" | "person" | "status" | "name";
const STATE_ORDER: Record<string, number> = { late: 0, doing: 1, todo: 2, done: 3 };

/** ช่องแก้ชื่องานในตาราง — กด Enter/คลิกที่อื่นเพื่อบันทึก, Esc ยกเลิก */
function InlineName({ item, onSave }: { item: TimelineItem; onSave: (name: string) => void }) {
  const [v, setV] = useState(item.name);
  const [prev, setPrev] = useState(item.name);
  if (prev !== item.name) { setPrev(item.name); setV(item.name); }
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} onClick={(e) => e.stopPropagation()}
      onBlur={() => { const t = v.trim(); if (t && t !== item.name) onSave(t); else setV(item.name); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setV(item.name); setTimeout(() => (e.target as HTMLInputElement).blur()); } }}
      aria-label="ชื่องาน"
      className={cn("w-full min-w-0 rounded-md border-0 bg-transparent px-1.5 py-1 text-[14px] font-medium text-[var(--ink)] outline-none hover:ring-1 hover:ring-[var(--line)] focus:bg-[var(--bg)] focus:ring-2 focus:ring-[var(--brand-green)]", item.state === "done" && "font-normal text-[var(--ink-soft)] line-through")} />
  );
}

const dateCell = "h-8 w-[128px] border-0 bg-transparent px-1.5 text-[13px] text-[var(--ink)] hover:ring-1 hover:ring-[var(--line)]";
const cellInput = "max-w-[150px] rounded-md border-0 bg-transparent px-1 py-1 text-base text-[var(--ink)] tabular-nums outline-none hover:ring-1 hover:ring-[var(--line)] focus:ring-2 focus:ring-[var(--brand-green)] sm:text-[13px]";

export function ListTab({ project, items, canEdit = false, canPlan = false, onOpen, pendingIds }: { project: Project; items: TimelineItem[]; canEdit?: boolean; canPlan?: boolean; onOpen: (id: string) => void; /** งานที่มีเรื่องรอเรา (project-pending.tsx) — พื้นแดงอ่อน */ pendingIds?: Set<string> }) {
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const saveTaskDetails = useTaskStore((s) => s.saveTaskDetails);
  const setAssignees = useTaskStore((s) => s.setAssignees);
  const rescheduleTask = useTaskStore((s) => s.rescheduleTask);
  const updateMilestone = useProjectStore((s) => s.updateMilestone);
  const moveTask = useTaskStore((s) => s.moveTask);
  /** ติ๊กเสร็จจากรายการ — เฉพาะคนที่รับงาน (เหมือนบนบอร์ดงาน) · เช็คลิสต์ยังไม่ครบ ระบบไม่ให้ปิด → บอกเหตุผล */
  const toggleDone = (i: TimelineItem) => {
    const done = i.state !== "done";
    moveTask(i.id, done ? "done" : "in_progress");
    const after = useTaskStore.getState().tasks.find((t) => t.id === i.id)?.status;
    if (done && after !== "done") toast.error("ติ๊กเช็คลิสต์ในงานให้ครบก่อน แล้วค่อยกดเสร็จ");
    else if (done) toast.success(`"${i.name}" เสร็จแล้ว`);
  };
  const DoneBox = ({ i }: { i: TimelineItem }) =>
    i.kind === "task" && i.assigneeIds.includes(me) ? (
      <button type="button" role="checkbox" aria-checked={i.state === "done"} aria-label={`ทำเสร็จ: ${i.name}`} title={i.state === "done" ? "กดอีกครั้งเพื่อเปิดงานใหม่" : "ทำเสร็จแล้ว กดติ๊ก"}
        onClick={(e) => { e.stopPropagation(); toggleDone(i); }}
        className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 text-[11px] font-bold transition-colors",
          i.state === "done" ? "border-[var(--brand-green)] bg-[var(--brand-green)] text-white" : "border-[var(--ink-soft)]/50 text-transparent hover:border-[var(--brand-green)] hover:text-[var(--brand-green)]")}>
        ✓
      </button>
    ) : null;
  const teamIds = [...new Set([project.ownerId, ...project.members.map((m) => m.userId)])];
  const why = "แก้จากหน้ารายการโปรเจกต์";
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
  // งานย่อยต่อท้ายงานหลัก (เรียง/กรองที่งานหลัก) — งานย่อยที่งานหลักถูกกรองออกยังขึ้นเป็นแถวปกติ
  const shownIds = new Set(shown.map((i) => i.id));
  const tops = shown.filter((i) => isTopLevel(i, shownIds));
  const groups = group === "section"
    ? project.sections.map((s) => ({ key: s.id, name: s.name, rows: withSubtasks(tops.filter((i) => i.sectionId === s.id), shown) }))
    : [{ key: "all", name: "", rows: withSubtasks(tops, shown) }];
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
      {canEdit && <p className="m-0 hidden text-xs text-[var(--ink-soft)] sm:block">แก้ชื่อ{canPlan ? " วัน" : ""} และคนรับผิดชอบได้ในตารางเลย · กด ↗ เพื่อเปิดรายละเอียดงาน{!canPlan ? " · เลื่อนวันได้เฉพาะเจ้าของโปรเจกต์" : ""}</p>}
      {/* มือถือ: การ์ด กดแล้วเปิดงาน */}
      <div className="grid gap-4 sm:hidden">
        {groups.map((g) => (
          <div key={`m-${g.key}`} className="grid gap-2">
            {g.name && <b className="text-[15px]">{g.name} <span className="ml-1 rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink-soft)]">{g.rows.length}</span></b>}
            {g.rows.map((i) => {
              const sub = !!i.parentId && shownIds.has(i.parentId);
              return (
                <div key={i.id} role="button" tabIndex={0} onClick={() => i.kind === "task" && onOpen(i.id)}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && i.kind === "task") { e.preventDefault(); onOpen(i.id); } }}
                  className={cn("grid cursor-pointer gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-left", sub && "ml-5", i.state === "late" && "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20", pendingIds?.has(i.id) && "border-[#f3a4a4] bg-[#fdecec] dark:border-red-900 dark:bg-red-950/40")}>
                  <span className="flex items-start gap-2">
                    {sub && <span className="text-[var(--ink-soft)]">↳</span>}
                    <span className="pt-0.5"><DoneBox i={i} /></span>
                    {i.kind === "milestone" && <span style={{ color: "var(--chart-violet)" }}>◆</span>}
                    <span className={cn("min-w-0 flex-1 text-[15px] font-semibold leading-snug", i.state === "done" && "font-normal text-[var(--ink-soft)] line-through")}>{i.name}</span>
                    <StatePill state={i.state} />
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--ink-soft)]">
                    {i.assigneeIds[0] && <span className="inline-flex items-center gap-1.5"><PersonDot userId={i.assigneeIds[0]} size={20} />{getUser(i.assigneeIds[0])?.name}{i.assigneeIds.length > 1 ? ` +${i.assigneeIds.length - 1}` : ""}</span>}
                    <span className="tabular-nums">{i.kind === "milestone" ? fmtDay(i.start) : `${fmtDay(i.start)} → ${fmtDay(i.end)}`}</span>
                  </span>
                  {i.deps.some((d) => byId.has(d)) && (
                    <span className="text-[12px] text-[var(--ink-soft)]">รอ: {i.deps.filter((d) => byId.has(d)).map((d) => byId.get(d)!.name).join(", ")}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--bg)] sm:block">
        <table className="w-full min-w-[720px] border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-[var(--bg-soft)] text-left text-[12px] text-[var(--ink-soft)]">
              {["งาน", "ผู้รับผิดชอบ", "เริ่ม", "ส่ง", "สถานะ", "ต้องรอ"].map((h) => <th key={h} className="border-b border-[var(--line)] px-3 py-2.5 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              g.name ? (
                <tr key={`g-${g.key}`}>
                  <td colSpan={6} className="border-b border-[var(--line)] px-3 pb-1.5 pt-4 text-[14px] font-bold text-[var(--ink)]">
                    {g.name} <span className="ml-1 rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink-soft)]">{g.rows.length}</span>
                  </td>
                </tr>
              ) : null,
              ...g.rows.map((i) => (
                <tr key={i.id} className={cn("border-b border-[var(--line)]/50 transition-colors", i.kind === "task" && "cursor-pointer hover:bg-[var(--bg-soft)]", i.state === "late" && "bg-red-50/60 dark:bg-red-950/20", pendingIds?.has(i.id) && "bg-[#fdecec] dark:bg-red-950/40")} onClick={() => i.kind === "task" && onOpen(i.id)}>
                  <td className="min-w-52 px-2 py-1.5">
                    {canEdit && i.kind === "task" ? (
                      <div className={cn("flex items-center gap-1", i.parentId && shownIds.has(i.parentId) && "pl-5")}>
                        {i.parentId && shownIds.has(i.parentId) && <span className="text-[var(--ink-soft)]" aria-label="งานย่อย">↳</span>}
                        <DoneBox i={i} />
                        <InlineName item={i} onSave={(t) => saveTaskDetails(i.id, t, i.task?.description ?? "", me)} />
                        <button type="button" className="shrink-0 rounded px-1.5 text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]" aria-label={`เปิดงาน ${i.name}`} title="เปิดรายละเอียดงาน" onClick={(e) => { e.stopPropagation(); onOpen(i.id); }}>↗</button>
                      </div>
                    ) : canEdit && i.kind === "milestone" ? (
                      <div className="flex items-center gap-1"><span style={{ color: "var(--chart-violet)" }}>◆</span><InlineName item={i} onSave={(t) => updateMilestone(project.id, i.id, { name: t })} /></div>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <DoneBox i={i} />
                        <span className={cn("px-1", i.state === "done" && "text-[var(--ink-soft)] line-through")}>{i.kind === "milestone" ? "◆ " : ""}{i.name}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5" onClick={(e) => canEdit && e.stopPropagation()}>
                    {canEdit && i.kind === "task" && i.assigneeIds.length <= 1 ? (
                      <span className="inline-flex items-center gap-1.5">
                        {i.assigneeIds[0] ? <PersonDot userId={i.assigneeIds[0]} size={20} /> : null}
                        <select className={cellInput} value={i.assigneeIds[0] ?? ""} aria-label="ผู้รับผิดชอบ" onChange={(e) => { if (!e.target.value) return; setAssignees(i.id, [e.target.value]); ensureProjectMembers(project.id, [e.target.value], me); }}>
                          {!i.assigneeIds.length && <option value="" disabled>— เลือกคน —</option>}
                          {[...new Set([...teamIds, ...i.assigneeIds])].map((id) => <option key={id} value={id}>{getUser(id)?.name ?? id}</option>)}
                        </select>
                      </span>
                    ) : i.assigneeIds.length ? (
                      <span className="inline-flex items-center gap-1.5"><PersonDot userId={i.assigneeIds[0]!} size={20} /><span className="text-xs">{getUser(i.assigneeIds[0]!)?.name}{i.assigneeIds.length > 1 ? ` +${i.assigneeIds.length - 1}` : ""}</span></span>
                    ) : "—"}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums" onClick={(e) => canEdit && e.stopPropagation()}>
                    {canPlan && i.kind === "task" && i.state !== "done" ? (
                      <DatePickerField className={dateCell} value={i.start} onChange={(v) => v && rescheduleTask(i.id, dayToIso(v), i.task!.dueDate, why, me)} />
                    ) : canEdit && i.kind === "milestone" && i.state !== "done" ? (
                      <DatePickerField className={dateCell} value={i.start} onChange={(v) => v && updateMilestone(project.id, i.id, { date: v })} />
                    ) : <span className="px-1">{fmtDay(i.start)}</span>}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums" onClick={(e) => canEdit && e.stopPropagation()}>
                    {i.kind === "milestone" ? "—" : canPlan && i.state !== "done" ? (
                      <DatePickerField className={dateCell} value={i.end} minDate={i.start} onChange={(v) => v && rescheduleTask(i.id, i.task!.startDate, dayToIso(v), why, me)} />
                    ) : <span className="px-1">{fmtDay(i.end)}</span>}
                  </td>
                  <td className="px-3 py-2"><StatePill state={i.state} /></td>
                  <td className="px-3 py-2 text-xs text-[var(--ink-soft)]">{i.deps.filter((d) => byId.has(d)).map((d) => { const l = depRuleLabel(i.depRules[d]); return `${byId.get(d)!.name}${l ? ` (${l})` : ""}`; }).join(", ") || "—"}</td>
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
  // บอร์ดโชว์งานหลัก — งานย่อยดูจาก "งานย่อย n/m" บนการ์ด (กดเปิดงานหลักเห็นครบ)
  const tasks = items.filter((i) => i.kind === "task" && i.task && !i.parentId).map((i) => i.task!);
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
                <TaskCard task={t} onOpen={onOpen} hideProjectChip />
              </div>
            ))}
            {!c.list.length && <p className="m-0 py-4 text-center text-xs text-[var(--ink-soft)]">ว่าง</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── ปฏิทิน: เดือน แสดงงานตามช่วงวัน + จุดสำคัญ (แบบ Asana Calendar) ───────────── */

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
