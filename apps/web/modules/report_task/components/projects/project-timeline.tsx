"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { toast } from "sonner";

import { getUser } from "@/modules/report_task/lib/directory";
import {
  cascadePlan,
  conflictsOf,
  dayNum,
  earliestAfter,
  keepGapPlan,
  lateImpact,
  depRuleLabel,
  shiftDays,
  dayToIso,
  wouldCycle,
  ymdOfDay,
  isTopLevel,
  withSubtasks,
  type ItemMove,
  type TimelineItem,
} from "@/modules/report_task/lib/project-schedule";
import { cn } from "@/modules/report_task/lib/utils";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useProjectStore } from "@/modules/report_task/store/project-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Project, ProjectDepRule } from "@/modules/report_task/types";
import { barStyle, fmtDay, PersonDot, STATE_COLOR, STATE_LABEL, StatePill, TH_MONTH_SHORT } from "./project-ui";

const ZOOM = { day: 30, week: 14, month: 5, quarter: 2, half: 1, year: 0.5 } as const;
type Zoom = keyof typeof ZOOM;
const ROW = 38;
const HEAD = 46;

type Row = { kind: "group"; key: string; name: string; items: TimelineItem[] } | { kind: "item"; item: TimelineItem };

/**
 * Timeline ของโปรเจกต์ (แบบ Asana Timeline/Gantt รวมเป็นหน้าเดียว)
 * - ลากแถบ = เลื่อนวัน · ลากขอบขวา = ยืด/หด · ลากจุดกลมท้ายแถบไปวางบนอีกงาน = งานนั้นต้องรองานนี้
 * - ลากงานได้เฉพาะเจ้าของโปรเจกต์/CEO (canPlan) — บันทึกเป็นการเลื่อนกำหนดส่ง (rescheduleTask)
 * - จุดสำคัญเป็นของโปรเจกต์ — คนที่แก้โปรเจกต์ได้ (canEdit) ลากได้
 * - จอสัมผัสไม่ลาก (นิ้วลากแล้วหน้าจอเลื่อนแทน) — กดแถบแล้วใช้ปุ่ม −/+ วัน ในแผงรายละเอียด
 */
export function ProjectTimeline({
  project,
  items: allItems,
  today,
  holidays,
  canEdit,
  canPlan,
  onOpenTask,
  onAddTask,
}: {
  project: Project;
  items: TimelineItem[];
  today: string;
  holidays: Set<string>;
  canEdit: boolean;
  canPlan: boolean;
  onOpenTask: (taskId: string) => void;
  onAddTask: (sectionId: string) => void;
}) {
  const rescheduleTask = useTaskStore((s) => s.rescheduleTask);
  const items = allItems;
  const setTaskProject = useTaskStore((s) => s.setTaskProject);
  const updateMilestone = useProjectStore((s) => s.updateMilestone);
  const addMilestone = useProjectStore((s) => s.addMilestone);
  const removeMilestone = useProjectStore((s) => s.removeMilestone);
  const updateProject = useProjectStore((s) => s.updateProject);
  const [zoom, setZoom] = useState<Zoom>("day");
  const [groupBy, setGroupBy] = useState<"section" | "person">("section");
  const [hideDone, setHideDone] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  // แถวที่ชี้เมาส์อยู่ — ไฮไลต์ทั้งแถวสองฝั่ง (ชื่องาน ↔ แถบเวลา) + เส้นนำสายตาไปหาแถบ (20/10/2569 "เส้นบอกว่าแถวนี้งานนี้")
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const [coarse, setCoarse] = useState(false);
  const [tipHidden, setTipHidden] = useState(true);
  const rightRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const W = ZOOM[zoom];

  // อ่านค่าของเครื่องหลัง mount (ฝั่งเซิร์ฟเวอร์ไม่รู้) — กัน hydration ไม่ตรงกัน
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
    try { setTipHidden(localStorage.getItem("project-timeline-tip") === "1"); } catch { setTipHidden(false); }
  }, []);

  // ช่วงวันที่แสดง: ก่อนงานแรก 3 วัน ถึงหลังงานสุดท้าย/วันเสร็จเป้าหมาย 7 วัน
  const [lo, hi] = useMemo(() => {
    const starts = items.map((i) => dayNum(i.start)).concat(dayNum(project.startDate), dayNum(today));
    const ends = items.map((i) => dayNum(i.end)).concat(dayNum(project.endDate), dayNum(today));
    return [Math.min(...starts) - 3, Math.max(...ends) + 7];
  }, [items, project.startDate, project.endDate, today]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const items = hideDone ? allItems.filter((i) => i.state !== "done") : allItems;
    if (groupBy === "person") {
      const by = new Map<string, TimelineItem[]>();
      for (const i of items) {
        const k = i.kind === "milestone" ? "◆" : (i.assigneeIds[0] ?? "-");
        by.set(k, [...(by.get(k) ?? []), i]);
      }
      for (const [k, its] of by) {
        out.push({ kind: "group", key: k, name: k === "◆" ? "จุดสำคัญ" : (getUser(k)?.name ?? "ยังไม่มีผู้รับผิดชอบ"), items: its });
        its.forEach((item) => out.push({ kind: "item", item }));
      }
      return out;
    }
    const known = new Set(project.sections.map((s) => s.id));
    const ids = new Set(items.map((i) => i.id));
    for (const s of project.sections) {
      // งานย่อยแสดงซ้อนใต้งานหลัก (อยู่ช่วงเดียวกับงานหลักเสมอ แม้งานหลักถูกย้ายช่วงทีหลัง)
      const top = items.filter((i) => isTopLevel(i, ids) && (i.sectionId === s.id || (!known.has(i.sectionId) && s.id === project.sections[0]?.id)));
      const its = withSubtasks(top, items);
      out.push({ kind: "group", key: s.id, name: s.name, items: its });
      its.forEach((item) => out.push({ kind: "item", item }));
    }
    return out;
  }, [allItems, groupBy, project.sections, hideDone]);

  const width = (hi - lo + 1) * W;
  const height = HEAD + rows.length * ROW;
  const rowIndex = useMemo(() => new Map(rows.flatMap((r, i) => (r.kind === "item" ? [[r.item.id, i] as const] : []))), [rows]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // ── สถานะการลาก (เก็บใน ref ไม่ re-render ทุกพิกเซล) ──
  const [preview, setPreview] = useState<{ id: string; start: string; end: string } | null>(null);
  const [linkLine, setLinkLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const drag = useRef<{ item: TimelineItem; x0: number; resize: boolean; moved: boolean; start: string; end: string } | null>(null);
  const link = useRef<{ from: string; x: number; y: number } | null>(null);

  const geo = (i: TimelineItem, override?: { start: string; end: string }) => {
    const s = override?.start ?? i.start, e = override?.end ?? i.end;
    const y = HEAD + (rowIndex.get(i.id) ?? 0) * ROW;
    if (i.kind === "milestone") { const c = (dayNum(s) - lo) * W + W / 2; return { x1: c - 9, x2: c + 9, y: y + ROW / 2, left: c - 8, w: 16 }; }
    const x = (dayNum(s) - lo) * W;
    return { x1: x, x2: (dayNum(e) - lo + 1) * W, y: y + ROW / 2, left: x + 1, w: Math.max((dayNum(e) - dayNum(s) + 1) * W - 2, 8) };
  };

  const canDrag = (i: TimelineItem) => !coarse && (i.kind === "milestone" ? canEdit : canPlan) && i.state !== "done";

  // ── นำการเปลี่ยนวันไปใช้จริง ──
  function applyMove(m: ItemMove, why: string) {
    if (m.kind === "milestone") updateMilestone(project.id, m.id, { date: m.start });
    else rescheduleTask(m.id, dayToIso(m.start), dayToIso(m.end), why, meId());
  }
  const meId = currentUserId;
  function commitMove(item: TimelineItem, start: string, end: string) {
    const delta = dayNum(start) - dayNum(item.start);
    applyMove({ id: item.id, kind: item.kind, start, end }, `เลื่อนจากแผนเวลาโปรเจกต์ "${project.name}"`);
    const next = items.map((i) => (i.id === item.id ? { ...i, start, end } : i));
    let extra = "";
    if (project.shiftMode === "keep" && delta !== 0) {
      const plan = keepGapPlan(next, item.id, delta);
      plan.forEach((m) => applyMove(m, `เลื่อนตาม "${item.name}" (รักษาระยะห่าง)`));
      if (plan.length) extra = ` · งานที่รออยู่เลื่อนตาม ${plan.length} รายการ`;
    } else if (project.shiftMode === "auto" && conflictsOf(next).length) {
      const plan = cascadePlan(next);
      plan.forEach((m) => applyMove(m, `เลื่อนตาม "${item.name}"`));
      if (plan.length) extra = ` · งานที่รออยู่เลื่อนตาม ${plan.length} รายการ`;
    }
    toast.success(`"${item.name}" → ${fmtDay(start)}${item.kind === "task" ? ` – ${fmtDay(end)}` : ""}${extra}`);
  }

  function addDependency(fromId: string, toId: string) {
    const to = byId.get(toId), from = byId.get(fromId);
    if (!to || !from || fromId === toId) return;
    if (to.deps.includes(fromId)) { toast.message("ตั้งไว้อยู่แล้ว"); return; }
    if (wouldCycle(items, fromId, toId)) { toast.error("ตั้งไม่ได้ — จะกลายเป็นรอกันวนไปมา"); return; }
    setDeps(to, [...to.deps, fromId]);
    toast.success(`"${to.name}" ต้องรอ "${from.name}" แล้ว`);
  }
  function setDeps(it: TimelineItem, deps: string[], rules: Record<string, ProjectDepRule> = it.depRules) {
    // เก็บเฉพาะวิธีรอของงานที่ยังรออยู่ และที่ไม่ใช่แบบปกติ
    const depRules = Object.fromEntries(Object.entries(rules).filter(([k, v]) => deps.includes(k) && (v.type || v.lag)));
    if (it.kind === "milestone") updateMilestone(project.id, it.id, { dependsOn: deps, depRules });
    else setTaskProject(it.id, { ...it.task?.project, projectId: project.id, sectionId: it.sectionId, dependsOn: deps, depRules }, meId());
  }

  function onPointerDown(e: RPointerEvent<HTMLDivElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-bar]");
    if (!el) return;
    const item = byId.get(el.dataset.bar!);
    if (!item) return;
    if ((e.target as HTMLElement).closest("[data-cn]") && canEdit && !coarse) {
      const g = geo(item);
      link.current = { from: item.id, x: g.x2, y: g.y };
      canvasRef.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (!canDrag(item)) return;
    drag.current = { item, x0: e.clientX, resize: !!(e.target as HTMLElement).closest("[data-rz]"), moved: false, start: item.start, end: item.end };
    canvasRef.current?.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: RPointerEvent<HTMLDivElement>) {
    if (link.current) {
      const r = canvasRef.current!.getBoundingClientRect();
      setLinkLine({ x1: link.current.x, y1: link.current.y, x2: e.clientX - r.left, y2: e.clientY - r.top });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dd = Math.round((e.clientX - d.x0) / W);
    if (dd !== 0) d.moved = true;
    const it = d.item;
    if (d.resize && it.kind === "task") {
      const ne = Math.max(dayNum(it.start), dayNum(it.end) + dd);
      d.start = it.start; d.end = ymdOfDay(ne);
    } else {
      d.start = shiftDays(it.start, dd); d.end = shiftDays(it.end, dd);
    }
    setPreview({ id: it.id, start: d.start, end: d.end });
  }
  function onPointerUp(e: RPointerEvent<HTMLDivElement>) {
    if (link.current) {
      const from = link.current.from;
      link.current = null;
      setLinkLine(null);
      const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-bar]");
      if (target?.dataset.bar) addDependency(from, target.dataset.bar);
      return;
    }
    const d = drag.current;
    drag.current = null;
    setPreview(null);
    if (!d) return;
    if (d.moved && (d.start !== d.item.start || d.end !== d.item.end)) { commitMove(d.item, d.start, d.end); setSel(d.item.id); }
    // มือถือ: แตะแถบงาน = เปิดงานเลย (แผงรายละเอียดอยู่ใต้ไทม์ไลน์ มองไม่เห็นบนจอเล็ก)
    else if (d.item.kind === "task" && typeof window !== "undefined" && window.innerWidth < 640) onOpenTask(d.item.id);
    else setSel((s) => (s === d.item.id ? null : d.item.id));
  }

  // ── ชน/เลยกำหนด ──
  const conflicts = conflictsOf(items);
  const impact = lateImpact(items);

  // มือถือเปิดมาเป็นมุมมอง "สัปดาห์" — วันละช่องกว้างเกินจอ เห็นงานแค่ 2–3 วัน
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) setZoom("week");
  }, []);

  useEffect(() => {
    // เปิดมาเลื่อนไปที่วันนี้
    const el = rightRef.current;
    if (el) el.scrollLeft = Math.max(0, (dayNum(today) - lo) * W - 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, zoom]);

  const selItem = sel ? byId.get(sel) : undefined;

  return (
    <div className="space-y-3">
      {/* tip เล็กบรรทัดเดียว (เดิมกล่องฟ้า 3 ข้อสูงเกือบ 100px — "เอาเป็น tip เล็กๆ พอให้กดเข้าใจละหาย" 20/10/2569)
          กด ✕ แล้วหาย จำในเครื่อง · เปิดดูอีกได้ที่ปุ่ม ⓘ วิธีใช้ ในแถบเครื่องมือ */}
      {!tipHidden && (
        <div className="hidden items-center gap-2 rounded-lg border border-[#d5dbe6] bg-[#eaeef5] px-2.5 py-1.5 text-[12px] text-[var(--brand-navy)] sm:flex">
          <span aria-hidden>💡</span>
          <span className="min-w-0 flex-1 leading-snug">
            <b>ลากแถบ</b> = เลื่อนวัน{canPlan ? "" : " (เฉพาะเจ้าของโปรเจกต์/CEO)"} · <b>ลากขอบขวา</b> = ยืด/หดวัน · <b>ลากจุดกลมท้ายแถบ</b> ไปวางบนอีกงาน = ต้องรอกัน · <b>กดแถบ</b> = เปิดงาน
          </span>
          <button
            type="button"
            aria-label="ปิดคำแนะนำ"
            title="เข้าใจแล้ว"
            className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-[11.5px] font-semibold hover:bg-white"
            onClick={() => { setTipHidden(true); try { localStorage.setItem("project-timeline-tip", "1"); } catch {} }}
          >
            เข้าใจแล้ว ✕
          </button>
        </div>
      )}

      {/* มือถือ: แบบ Asana — แผนเวลาเต็มจอ (ไม่มีคอลัมน์ชื่อ) ชื่องานอยู่บน/ข้างแถบ · ชื่อช่วงงานลอยติดซ้าย
          เครื่องมือเหลือ วัน/สัปดาห์/เดือน + วันนี้ (20/10/2569 "แผนเวลาบนมือถือ ... ให้เหมือนของเค้า") */}
      <div className="flex items-center gap-2 sm:hidden">
        <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-0.5">
          {(["day", "week", "month"] as Zoom[]).map((z) => (
            <button key={z} type="button" onClick={() => setZoom(z)} aria-pressed={zoom === z}
              className={cn("rounded-md px-3 py-1.5 text-[13px]", zoom === z ? "bg-[var(--bg)] font-semibold shadow-sm" : "text-[var(--ink-soft)]")}>
              {{ day: "วัน", week: "สัปดาห์", month: "เดือน" }[z as "day" | "week" | "month"]}
            </button>
          ))}
        </div>
        <button type="button" className="ml-auto h-9 rounded-lg border border-[var(--line)] px-3 text-[13px] font-semibold active:bg-[var(--bg-soft)]"
          onClick={() => { if (rightRef.current) rightRef.current.scrollTo({ left: Math.max(0, (dayNum(today) - lo) * W - 60), behavior: "smooth" }); }}>
          วันนี้
        </button>
      </div>

      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-0.5">
          {(["day", "week", "month", "quarter", "half", "year"] as Zoom[]).map((z) => (
            <button key={z} type="button" onClick={() => setZoom(z)} aria-pressed={zoom === z}
              className={cn("rounded-md px-3 py-1 text-[13px]", zoom === z ? "bg-[var(--bg)] font-semibold shadow-sm" : "text-[var(--ink-soft)]")}>
              {{ day: "วัน", week: "สัปดาห์", month: "เดือน", quarter: "ไตรมาส", half: "ครึ่งปี", year: "ปี" }[z]}
            </button>
          ))}
        </div>
        <button type="button" className="h-8 rounded-lg border border-[var(--line)] px-3 text-[13px] hover:bg-[var(--bg-soft)]"
          onClick={() => { if (rightRef.current) rightRef.current.scrollTo({ left: Math.max(0, (dayNum(today) - lo) * W - 200), behavior: "smooth" }); }}>
          ไปที่วันนี้
        </button>
        {canEdit && (
          <>
            <button type="button" className="h-8 rounded-lg border border-[var(--line)] px-3 text-[13px] hover:bg-[var(--bg-soft)]" onClick={() => onAddTask(project.sections[0]?.id ?? "")}>+ งาน</button>
            <button type="button" className="h-8 rounded-lg border border-[var(--line)] px-3 text-[13px] hover:bg-[var(--bg-soft)]"
              onClick={() => {
                const id = addMilestone(project.id, { name: "จุดสำคัญใหม่", date: shiftDays(today, 7), sectionId: project.sections[project.sections.length - 1]?.id ?? "" });
                setSel(id);
                toast.success("เพิ่มจุดสำคัญ แล้ว · แก้ชื่อ/วันได้ในแผงด้านล่าง");
              }}>
              + จุดสำคัญ
            </button>
          </>
        )}
        {tipHidden && (
          <button type="button" className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 text-[12.5px] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--brand-navy)]" title="วิธีใช้แผนเวลา" aria-label="วิธีใช้แผนเวลา"
            onClick={() => { setTipHidden(false); try { localStorage.removeItem("project-timeline-tip"); } catch {} }}>ⓘ วิธีใช้</button>
        )}
        <details className="relative">
          <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-lg border border-[var(--line)] px-3 text-[13px] hover:bg-[var(--bg-soft)]">ตัวเลือก ⚙</summary>
          <div className="absolute left-0 top-[calc(100%+6px)] z-20 grid w-max max-w-[86vw] gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs shadow-xl">
            <span className="text-[var(--ink-soft)]">จัดกลุ่มแถว</span>
            <div className="inline-flex w-max rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-0.5">
              {(["section", "person"] as const).map((g) => (
                <button key={g} type="button" onClick={() => setGroupBy(g)} aria-pressed={groupBy === g}
                  className={cn("rounded-md px-3 py-1", groupBy === g ? "bg-[var(--bg)] font-semibold shadow-sm" : "text-[var(--ink-soft)]")}>
                  {g === "section" ? "ตามช่วงงาน" : "ตามคน"}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="accent-[var(--brand-green)]" />ซ่อนงานที่เสร็จแล้ว</label>
            <span className="text-[var(--ink-soft)]">เมื่อเลื่อนงาน {canPlan ? "" : "(ตั้งได้เฉพาะเจ้าของโปรเจกต์)"}</span>
            <select disabled={!canPlan} value={project.shiftMode} onChange={(e) => updateProject(project.id, { shiftMode: e.target.value as Project["shiftMode"] })}
              className="rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-base sm:text-xs">
              <option value="ask">ถามก่อนเลื่อนงานที่รออยู่</option>
              <option value="auto">เลื่อนงานที่รออยู่ตามทันที</option>
              <option value="keep">เลื่อนตาม + รักษาระยะห่างเดิม</option>
            </select>
            {/* ตัวอย่างสั้น ๆ — ชื่อตัวเลือกอย่างเดียวคนอ่านไม่เข้าใจ */}
            <p className="m-0 max-w-64 text-[11.5px] leading-relaxed text-[var(--ink-soft)]">
              ตัวอย่าง: เลื่อน &quot;เดินไฟ&quot; ช้าไป 3 วัน แล้ว &quot;ติดโคม&quot; รอเดินไฟอยู่ →{" "}
              {{
                ask: "ขึ้นแถบเตือนสีแดง ให้กดปุ่มเลื่อนติดโคมตามเอง",
                auto: "ติดโคมเลื่อนไปเริ่มหลังเดินไฟเสร็จทันที (เลื่อนเท่าที่จำเป็น)",
                keep: "ติดโคมเลื่อนไป 3 วันเท่ากันเสมอ แม้ยังไม่ชน (ช่องว่างระหว่างงานเท่าเดิม)",
              }[project.shiftMode]}
            </p>
          </div>
        </details>
        <div className="ml-auto hidden flex-wrap gap-3 text-[11px] text-[var(--ink-soft)] sm:flex">
          {(["todo", "doing", "done", "late"] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded-sm" style={{ background: barStyle(k).background, border: barStyle(k).border }} />{STATE_LABEL[k]}</span>
          ))}
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rotate-45 rounded-[1px]" style={{ background: "var(--chart-violet)" }} />จุดสำคัญ</span>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)] sm:grid-cols-[270px_minmax(0,1fr)]">
        {/* ซ้าย: ชื่อแถว (จอคอม) — มือถือไม่มีคอลัมน์นี้ ชื่ออยู่บนแถบแทน */}
        <div className="z-[2] hidden min-w-0 border-r border-[var(--line)] bg-[var(--bg)] sm:block">
          <div className="flex items-end border-b border-[var(--line)] px-2.5 pb-1.5 text-xs font-semibold text-[var(--ink-soft)]" style={{ height: HEAD }}>
            {groupBy === "section" ? "งาน / ช่วงงาน" : "งาน / คน"}
          </div>
          {rows.map((r, idx) =>
            r.kind === "group" ? (
              <div key={`g-${r.key}`} onPointerEnter={() => setHoverRow(idx)} onPointerLeave={() => setHoverRow(null)}
                className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg-soft)] px-3 text-[13px] font-bold text-[var(--ink)]" style={{ height: ROW }}>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {canEdit && groupBy === "section" && (
                  <button type="button" className="rounded px-1 text-[var(--ink-soft)] hover:bg-[var(--bg)]" title="เพิ่มงานในช่วงนี้" onClick={() => onAddTask(r.key)}>＋</button>
                )}
              </div>
            ) : (
              <button key={r.item.id} type="button" onClick={() => setSel(r.item.id)}
                onPointerEnter={() => setHoverRow(idx)} onPointerLeave={() => setHoverRow(null)}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-[var(--line)]/60 px-2.5 text-left transition-colors",
                  idx % 2 === 1 && "bg-[#fafbfd]",
                  hoverRow === idx && "!bg-[#eaeef5] shadow-[inset_3px_0_0_var(--brand-navy)]",
                  sel === r.item.id && "!bg-[#dde3ee] shadow-[inset_3px_0_0_var(--brand-navy)]"
                )}
                style={{ height: ROW }}>
                {r.item.parentId && groupBy === "section" && <span className="-mr-1 pl-3 text-[var(--ink-soft)]" aria-label="งานย่อย">↳</span>}
                {r.item.kind === "milestone" ? <span style={{ color: "var(--chart-violet)" }}>◆</span> : r.item.assigneeIds[0] ? <PersonDot userId={r.item.assigneeIds[0]} size={20} /> : <span className="w-5" />}
                <span className={cn("min-w-0 flex-1 truncate", r.item.parentId ? "text-[13px] text-[var(--ink-soft)]" : "text-[13.5px]", r.item.state === "done" && "text-[var(--ink-soft)] line-through", r.item.state === "late" && "font-semibold text-red-600")}>{r.item.name}</span>
              </button>
            )
          )}
        </div>

        {/* ขวา: แถบเวลา */}
        <div ref={rightRef} className="relative overflow-x-auto">
          <div ref={canvasRef} className="relative" style={{ width, height }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
            {Array.from({ length: hi - lo + 1 }, (_, k) => {
              const d = lo + k, s = ymdOfDay(d), dt = new Date(d * 864e5), dow = dt.getUTCDay(), x = k * W;
              const hol = holidays.has(s), we = dow === 0 || dow === 6;
              const showDay = zoom === "day" || (zoom === "week" && dow === 1) || (zoom === "month" && (dt.getUTCDate() === 1 || dt.getUTCDate() === 15));
              return (
                <div key={d}>
                  {(hol || (we && (zoom === "day" || zoom === "week"))) && (
                    <div className="absolute bottom-0" title={hol ? "วันหยุดบริษัท" : undefined}
                      style={{ left: x, width: W, top: HEAD, background: hol ? "repeating-linear-gradient(135deg, var(--bg-soft) 0 4px, var(--line) 4px 5px)" : "var(--bg-soft)" }} />
                  )}
                  {(dt.getUTCDate() === 1 || k === 0) && (zoom !== "year" || dt.getUTCMonth() % 3 === 0 || k === 0) && (
                    <div className="absolute top-1 whitespace-nowrap border-l border-[var(--line)] pl-1 text-xs font-bold" style={{ left: x }}>
                      {/* ซูมไกล (ครึ่งปี/ปี) เดือนแคบ — ใส่ปีเฉพาะมกราคม/คอลัมน์แรก ไม่ให้ตัวหนังสือทับกัน */}
                      {TH_MONTH_SHORT[dt.getUTCMonth()]}{zoom !== "half" && zoom !== "year" || dt.getUTCMonth() === 0 || k === 0 ? ` ${dt.getUTCFullYear() + 543}` : ""}
                    </div>
                  )}
                  {showDay && (
                    <div className="absolute top-6 text-[10.5px] tabular-nums text-[var(--ink-soft)]" style={{ left: x, width: zoom === "day" ? W : 40, textAlign: zoom === "day" ? "center" : "left" }}>
                      {dt.getUTCDate()}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="absolute inset-x-0 border-b border-[var(--line)]" style={{ top: HEAD - 1 }} />
            {/* เส้นวันนี้ */}
            <div className="pointer-events-none absolute bottom-0 z-[3] w-0.5" style={{ left: (dayNum(today) - lo) * W + W / 2, top: 20, background: "var(--chart-red)" }}>
              <span className="absolute -top-0.5 left-1 whitespace-nowrap text-[10px] font-bold" style={{ color: "var(--chart-red)" }}>วันนี้</span>
            </div>

            {/* พื้นแถว: เส้นแบ่งแถวลากเต็มความกว้าง + สลับสีเว้นแถว + ไฮไลต์แถวที่ชี้/เลือก (ตรงกับฝั่งชื่องาน) */}
            {rows.map((r, idx) => {
              const on = hoverRow === idx || (r.kind === "item" && sel === r.item.id);
              return (
                <div key={`lane-${idx}`} onPointerEnter={() => setHoverRow(idx)} onPointerLeave={() => setHoverRow(null)}
                  className={cn("absolute inset-x-0 z-0 border-b transition-colors", r.kind === "group" ? "border-[var(--line)]" : "border-[var(--line)]/60")}
                  style={{
                    top: HEAD + idx * ROW,
                    height: ROW,
                    background: on ? "rgba(27,37,55,0.09)" : r.kind === "group" ? "rgba(241,245,249,0.6)" : idx % 2 === 1 ? "rgba(27,37,55,0.018)" : "transparent",
                  }} />
              );
            })}
            {/* มือถือ: ชื่อช่วงงานติดซ้ายตลอด อยู่ชั้นบนสุด (เหนือเส้นวันนี้) — เลื่อนไปวันไหนก็รู้ว่าอยู่ช่วงไหน */}
            {rows.map((r, idx) =>
              r.kind === "group" ? (
                <div key={`glabel-${idx}`} className="pointer-events-none absolute inset-x-0 z-[5] sm:hidden" style={{ top: HEAD + idx * ROW, height: ROW }}>
                  <span className="sticky left-2 mt-[7px] inline-flex max-w-[80vw] items-center gap-1 truncate rounded-md bg-white px-2 py-0.5 text-[13px] font-bold text-[var(--ink)] shadow-sm">
                    {r.name} <span className="text-[11px] font-normal text-[var(--ink-soft)]">{r.items.length}</span>
                  </span>
                </div>
              ) : null
            )}
            {/* เส้นนำสายตา: แถวที่ชี้/เลือก — เส้นประจากขอบซ้ายไปถึงหัวแถบ บอกว่าแถบนี้ของงานไหน */}
            {rows.map((r, idx) => {
              if (r.kind !== "item" || (hoverRow !== idx && sel !== r.item.id)) return null;
              const g = geo(r.item, preview?.id === r.item.id ? preview : undefined);
              if (g.left < 8) return null;
              return (
                // สีเส้นใส่ inline — globals.css มี `* { border-color }` นอก @layer ทับคลาสสีขอบทุกตัว
                <div key={`guide-${idx}`} className="pointer-events-none absolute z-[1]"
                  style={{ left: 0, width: g.left - 6, top: HEAD + idx * ROW + ROW / 2 - 1, borderTop: "2px dashed rgba(27,37,55,0.55)" }}>
                  <span className="absolute -right-1 -top-[5px] h-0 w-0"
                    style={{ borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "6px solid rgba(27,37,55,0.55)" }} />
                </div>
              );
            })}

            {rows.map((r, idx) => {
              const y = HEAD + idx * ROW;
              if (r.kind === "group") {
                if (!r.items.length) return null;
                const a = Math.min(...r.items.map((i) => dayNum(i.start))), b = Math.max(...r.items.map((i) => dayNum(i.end)));
                return <div key={`gs-${r.key}`} className="absolute hidden h-1.5 rounded bg-[var(--line)] sm:block" style={{ left: (a - lo) * W, width: (b - a + 1) * W, top: y + 16 }} />;
              }
              const it = r.item;
              const pv = preview?.id === it.id ? preview : undefined;
              const g = geo(it, pv);
              const draggable = canDrag(it);
              if (it.kind === "milestone") {
                return (
                  <div key={it.id}>
                    <div data-bar={it.id} title={`${it.name} · ${fmtDay(pv?.start ?? it.start)}`}
                      className={cn("absolute z-[2] h-4 w-4 rotate-45 rounded-[2px]", draggable ? "cursor-grab" : "cursor-pointer", sel === it.id && "outline outline-2 outline-offset-2 outline-[var(--ink)]")}
                      style={{ left: g.left, top: y + 11, background: it.state === "done" ? STATE_COLOR.done : it.state === "late" ? STATE_COLOR.late : "var(--chart-violet)" }}>
                      {canEdit && !coarse && <span data-cn="1" className="absolute -right-4 top-0.5 h-2.5 w-2.5 -rotate-45 cursor-crosshair rounded-full border-2 border-[var(--ink)] bg-[var(--bg)] opacity-0 hover:opacity-100" />}
                    </div>
                    <div className="pointer-events-none absolute z-[2] whitespace-nowrap text-[11.5px] font-semibold" style={{ left: g.left + 26, top: y + 10 }}>
                      {it.name} · {fmtDay(pv?.start ?? it.start)}
                    </div>
                  </div>
                );
              }
              const bs = barStyle(it.state);
              const sub = !!it.parentId;
              const barH = sub ? 16 : 24;
              // ชื่อพอดีในแถบไหม (~7px ต่อตัว ไม่นับสระบน/ล่าง·วรรณยุกต์ไทยที่ไม่กินที่) — ไม่พอ = เขียนไว้ข้างขวาแถบ
              const fits = g.w > it.name.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length * 7 + 22;
              return (
                <div key={it.id} data-bar={it.id} title={`${it.name} · ${fmtDay(pv?.start ?? it.start)} – ${fmtDay(pv?.end ?? it.end)}`}
                  className={cn("group absolute z-[2] flex select-none items-center gap-1 rounded-md px-2 font-semibold shadow-sm", sub ? "text-[10.5px]" : "text-[12px]",
                    draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer", sel === it.id && "outline outline-2 outline-offset-1 outline-[var(--ink)]")}
                  style={{ left: g.left, width: g.w, top: y + (ROW - barH) / 2, height: barH, background: bs.background, color: bs.color, border: bs.border, opacity: it.state === "done" ? 0.75 : 1, touchAction: draggable ? "none" : "auto" }}>
                  {it.pct !== undefined && it.state !== "done" && it.pct > 0 && <span className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md" style={{ width: `${it.pct}%`, background: it.state === "todo" ? "color-mix(in srgb, var(--chart-blue) 30%, transparent)" : "rgba(255,255,255,.25)" }} />}
                  <span className="relative truncate">{it.state === "done" ? "✓ " : ""}{fits && !sub ? it.name : ""}</span>
                  {(!fits || sub) && (
                    <span className="pointer-events-none absolute left-full ml-1.5 whitespace-nowrap text-[11.5px] font-medium" style={{ color: it.state === "late" ? "var(--chart-red)" : "var(--ink)" }}>
                      {it.name}{it.pct !== undefined && it.state !== "done" ? ` · ${it.pct}%` : ""}
                    </span>
                  )}
                  {draggable && <span data-rz="1" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" />}
                  {canEdit && !coarse && (
                    <span data-cn="1" title="ลากไปวางบนงานที่ต้องรองานนี้"
                      className="absolute -right-4 top-1/2 h-2.5 w-2.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-[var(--ink)] bg-[var(--bg)] opacity-0 group-hover:opacity-100" />
                  )}
                </div>
              );
            })}

            {/* เส้นงานที่ต้องรอ */}
            <svg className="pointer-events-none absolute left-0 top-0 z-[1] overflow-visible" width={width} height={height}>
              <defs>
                <marker id="pt-ah" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="var(--ink-soft)" /></marker>
                <marker id="pt-ahr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="var(--chart-red)" /></marker>
              </defs>
              {items.flatMap((it) =>
                it.deps.map((d) => {
                  const pre = byId.get(d);
                  if (!pre || !rowIndex.has(it.id) || !rowIndex.has(pre.id)) return null;
                  const a = geo(pre, preview?.id === pre.id ? preview : undefined), b = geo(it, preview?.id === it.id ? preview : undefined);
                  const rule = it.depRules[d];
                  const bad = dayNum(preview?.id === it.id ? preview.start : it.start) < earliestAfter(preview?.id === pre.id ? { ...pre, start: preview.start, end: preview.end } : pre, rule);
                  const lag = Math.max(0, Math.round(rule?.lag ?? 0));
                  const tag = lag ? <text key={`${d}>${it.id}-t`} x={b.x1 - 4} y={b.y - 7} textAnchor="end" fontSize="10" fontWeight="700" fill={bad ? "var(--chart-red)" : "var(--ink-soft)"}>+{lag}ว</text> : null;
                  // เริ่มพร้อมกันได้: ลากเส้นจาก "หัว" งานก่อนหน้า ไปหัวงานนี้
                  if (rule?.type === "ss") {
                    const left = Math.min(a.x1, b.x1) - 10;
                    return [<path key={`${d}>${it.id}`} d={`M${a.x1},${a.y} H${left} V${b.y} H${b.x1 - 2}`} fill="none" stroke={bad ? "var(--chart-red)" : "var(--ink-soft)"} strokeWidth={bad ? 2 : 1.3} strokeDasharray="4 3" opacity={bad ? 1 : 0.7} markerEnd={`url(#${bad ? "pt-ahr" : "pt-ah"})`} />, tag];
                  }
                  const path = b.x1 - 6 > a.x2 + 6
                    ? `M${a.x2},${a.y} H${Math.min(b.x1 - 8, a.x2 + 14)} V${b.y} H${b.x1 - 2}`
                    : `M${a.x2},${a.y} H${a.x2 + 8} V${(a.y + b.y) / 2} H${b.x1 - 10} V${b.y} H${b.x1 - 2}`;
                  return [<path key={`${d}>${it.id}`} d={path} fill="none" stroke={bad ? "var(--chart-red)" : "var(--ink-soft)"} strokeWidth={bad ? 2 : 1.3} opacity={bad ? 1 : 0.55} markerEnd={`url(#${bad ? "pt-ahr" : "pt-ah"})`} />, tag];
                })
              )}
              {linkLine && <path d={`M${linkLine.x1},${linkLine.y1} L${linkLine.x2},${linkLine.y2}`} stroke="var(--brand-green)" strokeWidth={2} strokeDasharray="5 4" fill="none" />}
            </svg>
          </div>
        </div>
      </div>

      {conflicts.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <span>⚠ <b>{conflicts.length} งานเริ่มก่อนงานที่ต้องรอเสร็จ:</b> {conflicts.map(([a, b]) => `${b.name} (รอ ${a.name})`).join(", ")}</span>
          {canPlan && (
            <button type="button" className="ml-auto rounded-lg border border-red-200 bg-[var(--bg)] px-3 py-1 text-xs text-[var(--ink)] dark:border-red-900"
              onClick={() => { const plan = cascadePlan(items); plan.forEach((m) => applyMove(m, "เลื่อนตามงานที่ต้องรอ (แผนเวลา)")); toast.success(`เลื่อนงานที่ต่อกันแล้ว ${plan.length} รายการ · แจ้งผู้รับผิดชอบแล้ว`); }}>
              เลื่อนงานที่ต่อกันตาม
            </button>
          )}
        </div>
      ) : impact.late.length > 0 ? (
        <div className="rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
          ⚠ <b>{impact.late.map((l) => l.name).join(", ")}</b> เลยกำหนดแล้ว
          {impact.affected.length > 0 && <> · มีงานรออยู่ {impact.affected.length} รายการ{impact.affected.some((a) => a.kind === "milestone") && <> รวมจุดสำคัญ <b>{impact.affected.filter((a) => a.kind === "milestone").map((a) => a.name).join(", ")}</b></>}</>}
        </div>
      ) : null}

      {selItem && (
        <ItemDetail
          key={selItem.id}
          project={project}
          item={selItem}
          items={items}
          canEdit={canEdit}
          canPlan={canPlan}
          today={today}
          onClose={() => setSel(null)}
          onOpenTask={onOpenTask}
          onMove={(start, end) => commitMove(selItem, start, end)}
          onSetDeps={(deps) => setDeps(selItem, deps)}
          onSetRule={(d, rule) => setDeps(selItem, selItem.deps, { ...selItem.depRules, [d]: rule })}
          onRemoveMilestone={() => { removeMilestone(project.id, selItem.id); setSel(null); toast.success("ลบจุดสำคัญ แล้ว"); }}
          onUpdateMilestone={(patch) => updateMilestone(project.id, selItem.id, patch)}
        />
      )}
    </div>
  );
}

function ItemDetail({
  project,
  item,
  items,
  canEdit,
  canPlan,
  today,
  onClose,
  onOpenTask,
  onMove,
  onSetDeps,
  onSetRule,
  onRemoveMilestone,
  onUpdateMilestone,
}: {
  project: Project;
  item: TimelineItem;
  items: TimelineItem[];
  canEdit: boolean;
  canPlan: boolean;
  today: string;
  onClose: () => void;
  onOpenTask: (id: string) => void;
  onMove: (start: string, end: string) => void;
  onSetDeps: (deps: string[]) => void;
  onSetRule: (depId: string, rule: ProjectDepRule) => void;
  onRemoveMilestone: () => void;
  onUpdateMilestone: (patch: { name?: string; date?: string; doneAt?: string | undefined; sectionId?: string }) => void;
}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const waiting = items.filter((i) => i.deps.includes(item.id));
  const canMove = item.state !== "done" && (item.kind === "milestone" ? canEdit : canPlan);
  const step = (startDelta: number, endDelta: number) => {
    const s = shiftDays(item.start, startDelta), e = shiftDays(item.end, endDelta);
    if (dayNum(e) < dayNum(s)) return;
    onMove(s, e);
  };
  const stepBtn = "h-9 w-9 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] text-base disabled:opacity-40";
  return (
    <div className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg-soft)] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {item.kind === "milestone" && canEdit ? (
          <input defaultValue={item.name} onBlur={(e) => e.target.value.trim() && e.target.value !== item.name && onUpdateMilestone({ name: e.target.value.trim() })}
            className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-base font-semibold sm:text-sm" />
        ) : (
          <h3 className="m-0 min-w-0 flex-1 text-base font-semibold">{item.kind === "milestone" ? "◆ " : ""}{item.name}</h3>
        )}
        <StatePill state={item.state} />
        <button type="button" onClick={onClose} className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1 text-xs">ปิด</button>
      </div>
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13.5px]">
        <dt className="text-[var(--ink-soft)]">ช่วงงาน</dt>
        <dd className="m-0">
          {item.kind === "milestone" && canEdit ? (
            <select value={item.sectionId} onChange={(e) => onUpdateMilestone({ sectionId: e.target.value })} className="rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-base sm:text-sm">
              {project.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (project.sections.find((s) => s.id === item.sectionId)?.name ?? "—")}
        </dd>
        {item.kind === "task" && (
          <>
            <dt className="text-[var(--ink-soft)]">ผู้รับผิดชอบ</dt>
            <dd className="m-0 flex flex-wrap gap-2">{item.assigneeIds.map((id) => <span key={id} className="inline-flex items-center gap-1.5"><PersonDot userId={id} size={20} />{getUser(id)?.name}</span>)}</dd>
          </>
        )}
        <dt className="text-[var(--ink-soft)]">{item.kind === "milestone" ? "วันที่" : "วันเริ่ม"}</dt>
        <dd className="m-0 flex items-center gap-2">
          {canMove && <button type="button" className={stepBtn} aria-label="เร็วขึ้น 1 วัน" onClick={() => step(-1, item.kind === "milestone" ? -1 : 0)}>−</button>}
          <b className="min-w-24 text-center tabular-nums">{fmtDay(item.start, true)}</b>
          {canMove && <button type="button" className={stepBtn} aria-label="ช้าลง 1 วัน" onClick={() => step(1, item.kind === "milestone" ? 1 : 0)}>+</button>}
        </dd>
        {item.kind === "task" && (
          <>
            <dt className="text-[var(--ink-soft)]">กำหนดส่ง</dt>
            <dd className="m-0 flex items-center gap-2">
              {canMove && <button type="button" className={stepBtn} aria-label="ส่งเร็วขึ้น 1 วัน" onClick={() => step(0, -1)}>−</button>}
              <b className="min-w-24 text-center tabular-nums">{fmtDay(item.end, true)}</b>
              {canMove && <button type="button" className={stepBtn} aria-label="ส่งช้าลง 1 วัน" onClick={() => step(0, 1)}>+</button>}
              <span className="text-xs text-[var(--ink-soft)]">({dayNum(item.end) - dayNum(item.start) + 1} วัน)</span>
            </dd>
          </>
        )}
        <dt className="text-[var(--ink-soft)]">ต้องรอ</dt>
        <dd className="m-0 flex flex-wrap items-center gap-1.5">
          {item.deps.map((d) => {
            const rule = item.depRules[d] ?? {};
            const pre = byId.get(d);
            return (
              <span key={d} className="inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs">
                <b className="font-semibold">{pre?.name ?? "—"}</b>
                {canEdit ? (
                  <>
                    {/* วิธีรอ: หลังเสร็จ (ปกติ) / เริ่มพร้อมกันได้ — จุดสำคัญไม่มีช่วงเวลา เลยมีแค่แบบปกติ */}
                    {pre?.kind === "task" && (
                      <select aria-label="วิธีรอ" value={rule.type ?? "fs"} onChange={(e) => onSetRule(d, { ...rule, type: e.target.value === "ss" ? "ss" : undefined })}
                        className="rounded-md border border-[var(--line)] bg-[var(--bg)] px-1 py-0.5 text-base sm:text-xs">
                        <option value="fs">เริ่มหลังเสร็จ</option>
                        <option value="ss">เริ่มพร้อมกันได้</option>
                      </select>
                    )}
                    <label className="inline-flex items-center gap-1 text-[var(--ink-soft)]">
                      + รอ
                      <input type="number" min={0} max={365} inputMode="numeric" aria-label="รอเพิ่มกี่วัน" value={rule.lag ?? 0}
                        onChange={(e) => onSetRule(d, { ...rule, lag: Math.min(365, Math.max(0, Math.round(Number(e.target.value) || 0))) || undefined })}
                        className="w-12 rounded-md border border-[var(--line)] bg-[var(--bg)] px-1 py-0.5 text-center text-base tabular-nums sm:text-xs" />
                      วัน
                    </label>
                    <button type="button" aria-label="เลิกรอ" className="text-[var(--ink-soft)]" onClick={() => onSetDeps(item.deps.filter((x) => x !== d))}>✕</button>
                  </>
                ) : depRuleLabel(rule) ? <span className="text-[var(--ink-soft)]">({depRuleLabel(rule)})</span> : null}
              </span>
            );
          })}
          {canEdit && (
            <select value="" onChange={(e) => e.target.value && onSetDeps([...item.deps, e.target.value])}
              className="rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-base sm:text-xs">
              <option value="">+ เพิ่มงานที่ต้องรอ</option>
              {items.filter((x) => x.id !== item.id && !item.deps.includes(x.id) && !wouldCycle(items, x.id, item.id)).map((x) => (
                <option key={x.id} value={x.id}>{x.kind === "milestone" ? "◆ " : ""}{x.name}</option>
              ))}
            </select>
          )}
          {!item.deps.length && !canEdit && "—"}
        </dd>
        <dt className="text-[var(--ink-soft)]">งานที่รออยู่</dt>
        <dd className="m-0">{waiting.length ? waiting.map((w) => w.name).join(", ") : "—"}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        {item.kind === "task" ? (
          <button type="button" onClick={() => onOpenTask(item.id)} className="rounded-lg bg-[var(--brand-green)] px-3 py-1.5 text-sm font-semibold text-white">เปิดงาน (ความคิดเห็น ไฟล์ เช็คลิสต์)</button>
        ) : (
          canEdit && (
            <>
              <button type="button" onClick={() => onUpdateMilestone({ doneAt: item.milestone?.doneAt ? undefined : new Date().toISOString() })}
                className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-sm">
                {item.milestone?.doneAt ? "ยกเลิกว่าถึงแล้ว" : "✓ ถึงจุดสำคัญ นี้แล้ว"}
              </button>
              <button type="button" onClick={onRemoveMilestone} className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-sm text-red-600">ลบจุดสำคัญ</button>
            </>
          )
        )}
        {!canMove && item.state !== "done" && item.kind === "task" && (
          <span className="self-center text-xs text-[var(--ink-soft)]">เลื่อนวันได้เฉพาะเจ้าของโปรเจกต์/CEO · ผู้รับผิดชอบกด &quot;ขอเลื่อน&quot; ในหน้างาน</span>
        )}
      </div>
      {item.state === "late" && dayNum(item.end) < dayNum(today) && <p className="m-0 text-xs text-red-600">เลยกำหนดมา {dayNum(today) - dayNum(item.end)} วัน</p>}
    </div>
  );
}

/** id ผู้ใช้ที่กำลังใช้งาน (อ่านตรงจาก store ตอนกด ไม่ต้อง subscribe) */
function currentUserId(): string {
  return useIdentityStore.getState().viewingAsUserId;
}

