"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { toast } from "sonner";

import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { canCreateProject } from "@/modules/report_task/lib/project-access";
import {
  arrangeTemplate,
  dayNum,
  depRuleLabel,
  templateConflict,
  templateDate,
  templateEnd,
  templateSpan,
  templateStartFromEnd,
} from "@/modules/report_task/lib/project-schedule";
import { uuid } from "@/modules/report_task/lib/uuid";
import { cn } from "@/modules/report_task/lib/utils";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useProjectStore } from "@/modules/report_task/store/project-store";
import type { ProjectDepRule, ProjectTemplate, ProjectTemplateItem } from "@/modules/report_task/types";
import { SUGGESTED_ROLES } from "./project-roles";
import { fmtDay, todayBkk, useCompanyHolidays } from "./project-ui";

/**
 * แม่แบบโปรเจกต์ — สร้าง/แก้เองได้ (CEO + หัวหน้าแผนก)
 * งานในแม่แบบใช้ "เริ่มวันที่ n ของโปรเจกต์ + กี่วัน" และผู้รับผิดชอบเป็นตำแหน่ง · ลากแถบในตัวอย่างแทนพิมพ์ตัวเลขได้
 * แก้แม่แบบแล้วโปรเจกต์ที่สร้างไปแล้วไม่เปลี่ยน
 */
export function ProjectTemplatesPage() {
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const templates = useProjectStore((s) => s.templates);
  const ready = useProjectStore((s) => s.templatesLoaded);
  const upsert = useProjectStore((s) => s.upsertTemplate);
  const remove = useProjectStore((s) => s.removeTemplate);
  const params = useSearchParams();
  const [cur, setCur] = useState<string>(() => params.get("t") ?? templates[0]?.id ?? "");
  const t = templates.find((x) => x.id === cur) ?? templates[0];
  const canEdit = canCreateProject(me);

  function newTemplate() {
    const k = `k-${uuid()}`, s = `s-${uuid()}`;
    const nt: ProjectTemplate = {
      id: `tpl-${uuid()}`, name: "แม่แบบใหม่", description: "", workdays: true, anchor: "start",
      sections: [{ key: s, name: "ช่วงที่ 1" }],
      items: [{ key: k, sectionKey: s, name: "งานแรก", role: "ช่าง", off: 0, dur: 2, milestone: false, dependsOn: [], description: "", checklist: [] }],
      usedCount: 0, createdBy: me, updatedAt: new Date().toISOString(),
    };
    upsert(nt);
    setCur(nt.id);
  }

  // แก้แม่แบบก่อนโหลดจากเซิร์ฟเวอร์เสร็จ = ของที่แก้ถูกทับหาย — รอก่อน
  if (!ready) return <p className="py-20 text-center text-sm text-[var(--ink-soft)]">กำลังโหลดแม่แบบ…</p>;

  return (
    <div className="space-y-3">
      <Link href="/report-task/projects" className="text-xs text-[var(--ink-soft)] hover:text-[var(--ink)]">‹ โปรเจกต์ทั้งหมด</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="m-0 text-xl font-bold">แม่แบบโปรเจกต์</h1>
        <span className="text-xs text-[var(--ink-soft)]">แก้ได้: CEO + หัวหน้าแผนก · แก้แม่แบบแล้วโปรเจกต์ที่สร้างไปแล้วไม่เปลี่ยน</span>
        {canEdit && <button type="button" className="ml-auto rounded-lg bg-[var(--brand-green)] px-3 py-1.5 text-xs font-semibold text-white" onClick={newTemplate}>+ แม่แบบใหม่</button>}
      </div>
      <div className="grid overflow-hidden rounded-xl border border-[var(--line)] md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="grid content-start gap-1 border-b border-[var(--line)] bg-[var(--bg-soft)] p-2 md:border-b-0 md:border-r">
          {templates.map((x) => (
            <button key={x.id} type="button" onClick={() => setCur(x.id)}
              className={cn("grid gap-0.5 rounded-lg border px-2.5 py-2 text-left", x.id === t?.id ? "border-[var(--brand-green)] bg-[var(--bg)]" : "border-transparent")}>
              <b className="text-[13.5px]">{x.name}</b>
              <span className="text-xs text-[var(--ink-soft)]">{x.sections.length} ช่วง · {x.items.filter((i) => !i.milestone).length} งาน · {x.items.filter((i) => i.milestone).length} จุดสำคัญ · ใช้แล้ว {x.usedCount} ครั้ง</span>
            </button>
          ))}
        </div>
        {t ? (
          <TemplateEditor key={t.id} t={t} canEdit={canEdit} onChange={upsert}
            onDuplicate={() => { const c: ProjectTemplate = { ...structuredClone(t), id: `tpl-${uuid()}`, name: `${t.name} (สำเนา)`, usedCount: 0 }; upsert(c); setCur(c.id); }}
            onDelete={() => { if (templates.length <= 1) { toast.error("ต้องเหลืออย่างน้อย 1 แม่แบบ"); return; } remove(t.id); setCur(templates.find((x) => x.id !== t.id)?.id ?? ""); toast.success("ลบแม่แบบแล้ว"); }} />
        ) : (
          <p className="p-6 text-sm text-[var(--ink-soft)]">ยังไม่มีแม่แบบ</p>
        )}
      </div>
    </div>
  );
}

/**
 * ตัวแก้แม่แบบ — ใช้ 2 ที่: หน้าแม่แบบ (แก้ต้นฉบับ บันทึกอัตโนมัติ) และหน้าสร้างโปรเจกต์ (forProject:
 * แก้สำเนาเฉพาะโปรเจกต์นี้ ต้นฉบับไม่เปลี่ยน · ตัวอย่างวันใช้วันเริ่ม/วันเสร็จของโปรเจกต์ ไม่มีช่องชื่อ/ลบ/สำเนา)
 */
export function TemplateEditor({ t, canEdit, onChange, onDuplicate, onDelete, forProject }: {
  t: ProjectTemplate; canEdit: boolean; onChange: (t: ProjectTemplate) => void; onDuplicate?: () => void; onDelete?: () => void;
  forProject?: { start: string; end: string };
}) {
  const holidays = useCompanyHolidays();
  const today = todayBkk();
  const [open, setOpen] = useState<string | null>(null);
  const [startSample, setStartSample] = useState(today);
  const [endSample, setEndSample] = useState(() => new Date(Date.parse(today) + 45 * 864e5).toISOString().slice(0, 10));
  const [newChk, setNewChk] = useState("");
  const set = (patch: Partial<ProjectTemplate>) => onChange({ ...t, ...patch });
  const setItem = (key: string, patch: Partial<ProjectTemplateItem>) => set({ items: t.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  /** ตั้งงานที่ต้องรอ + วิธีรอ — เก็บเฉพาะวิธีรอของงานที่ยังรออยู่และไม่ใช่แบบปกติ */
  const setDeps = (it: ProjectTemplateItem, deps: string[], rules: Record<string, ProjectDepRule> = it.depRules ?? {}) => {
    const depRules = Object.fromEntries(Object.entries(rules).filter(([k, v]) => deps.includes(k) && (v.type || v.lag)));
    setItem(it.key, { dependsOn: deps, depRules: Object.keys(depRules).length ? depRules : undefined });
  };
  /** k รอ (ต่อกันเป็นทอด) งาน key อยู่ไหม — ตั้งให้ key รอ k จะวน */
  const waitsOn = (k: string, key: string): boolean => {
    const seen = new Set<string>();
    const stack = [k];
    while (stack.length) {
      const x = stack.pop()!;
      if (x === key) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      t.items.find((i) => i.key === x)?.dependsOn.forEach((d) => stack.push(d));
    }
    return false;
  };
  const field = "w-full min-w-0 rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-base sm:text-[13px] disabled:opacity-70 text-[var(--ink)]";
  const last = templateSpan(t);
  const back = t.anchor === "end";
  const s0 = back ? templateStartFromEnd(t, forProject?.end ?? endSample, holidays) : (forProject?.start ?? startSample);
  const e0 = templateDate(t, s0, last, holidays);
  const tooLate = back && s0 < today;
  const anyBad = t.items.some((i) => templateConflict(t, i));

  // ── ลากแถบในตัวอย่าง: เลื่อน = เปลี่ยน "เริ่มวันที่" · ลากขอบขวา = เปลี่ยน "กี่วัน" ──
  const span = Math.max(1, dayNum(e0) - dayNum(s0) + 1);
  const PW = Math.max(10, Math.min(22, 560 / span));
  const drag = useRef<{ key: string; x0: number; off: number; dur: number; rz: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ key: string; off: number; dur: number } | null>(null);
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-pk]");
    if (!el) return;
    const it = t.items.find((i) => i.key === el.dataset.pk)!;
    drag.current = { key: it.key, x0: e.clientX, off: it.off, dur: it.dur, rz: !!(e.target as HTMLElement).closest("[data-pr]") };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dd = Math.round((e.clientX - d.x0) / PW);
    setGhost({ key: d.key, off: d.rz ? d.off : Math.max(0, d.off + dd), dur: d.rz ? Math.max(1, d.dur + dd) : d.dur });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && ghost) setItem(d.key, { off: ghost.off, dur: ghost.dur });
    setGhost(null);
  };

  return (
    <div className="grid min-w-0 content-start gap-3 p-4">
      {!forProject && (<>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-[var(--ink-soft)]">ชื่อแม่แบบ<input className={field} disabled={!canEdit} defaultValue={t.name} onBlur={(e) => e.target.value.trim() && set({ name: e.target.value.trim() })} /></label>
        <label className="grid gap-1 text-xs text-[var(--ink-soft)]">ใช้กับ<input className={field} disabled={!canEdit} defaultValue={t.description} onBlur={(e) => set({ description: e.target.value })} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-0.5">
          {(["start", "end"] as const).map((a) => (
            <button key={a} type="button" disabled={!canEdit} aria-pressed={t.anchor === a} onClick={() => set({ anchor: a })}
              className={cn("rounded-md px-3 py-1", t.anchor === a ? "bg-[var(--bg)] font-semibold shadow-sm" : "text-[var(--ink-soft)]")}>
              {a === "start" ? "นับจากวันเริ่ม" : "นับถอยหลังจากวันเสร็จ"}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1">
          <input type="checkbox" disabled={!canEdit} checked={t.workdays} onChange={(e) => set({ workdays: e.target.checked })} className="accent-[var(--brand-green)]" />
          นับเฉพาะวันทำงาน (ข้ามเสาร์–อาทิตย์ + วันหยุดบริษัท)
        </label>
      </div>
      </>)}
      <p className={cn("m-0 text-xs text-[var(--ink-soft)]", forProject && "hidden")}>{back ? "สร้างโปรเจกต์แล้วใส่แค่ \"วันเสร็จเป้าหมาย\" ระบบย้อนบอกว่าแต่ละงานต้องเริ่มวันไหน" : "สร้างโปรเจกต์แล้วใส่ \"วันเริ่ม\" ระบบคำนวณวันของทุกงานต่อให้"}</p>

      <p className="m-0 text-[11.5px] text-[var(--ink-soft)] md:hidden">ตำแหน่งที่ทำ และงานที่ต้องรอ แก้ได้ในปุ่ม &quot;รายละเอียด&quot; ของแต่ละงาน</p>
      <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_64px_64px_minmax(0,1.2fr)_28px] gap-1.5 text-[11px] font-semibold text-[var(--ink-soft)] md:grid">
        <span>งาน</span><span>ตำแหน่งที่ทำ</span><span>เริ่มวันที่</span><span>กี่วัน</span><span>ต้องรอ</span><span />
      </div>
      <datalist id="tpl-roles">{SUGGESTED_ROLES.map((r) => <option key={r} value={r} />)}</datalist>
      {t.sections.map((s) => {
        const its = t.items.filter((i) => i.sectionKey === s.key);
        return (
          <div key={s.key} className="grid gap-1.5 rounded-xl border border-[var(--line)] p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <input className={cn(field, "max-w-64 font-bold")} disabled={!canEdit} defaultValue={s.name}
                onBlur={(e) => e.target.value.trim() && set({ sections: t.sections.map((x) => (x.key === s.key ? { ...x, name: e.target.value.trim() } : x)) })} />
              {canEdit && (
                <span className="ml-auto flex gap-1.5">
                  {[false, true].map((mile) => (
                    <button key={String(mile)} type="button" className="rounded-md border border-[var(--line)] px-2 py-1 text-xs"
                      onClick={() => {
                        const prev = its[its.length - 1] ?? t.items[t.items.length - 1];
                        set({ items: [...t.items, { key: `k-${uuid()}`, sectionKey: s.key, name: mile ? "จุดสำคัญใหม่" : "งานใหม่", role: mile ? "" : "ช่าง", off: prev ? templateEnd(prev) + 1 : 0, dur: mile ? 0 : 2, milestone: mile, dependsOn: prev ? [prev.key] : [], description: "", checklist: [] }] });
                      }}>
                      {mile ? "+ จุดสำคัญ" : "+ งาน"}
                    </button>
                  ))}
                  <button type="button" className="px-1 text-[var(--ink-soft)]" aria-label="ลบช่วงนี้" disabled={t.sections.length <= 1}
                    onClick={() => set({ sections: t.sections.filter((x) => x.key !== s.key), items: t.items.filter((i) => i.sectionKey !== s.key) })}>✕</button>
                </span>
              )}
            </div>
            {its.map((it) => {
              const bad = templateConflict(t, it);
              return (
                <div key={it.key} className="grid gap-1">
                  {/* มือถือ: ชื่องานเต็มบรรทัด แล้ว "เริ่มวันที่ · กี่วัน · ลบ" บรรทัดถัดไป (เดิมชื่อถูกบีบจนอ่านไม่ออก) */}
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] items-center gap-1.5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_64px_64px_minmax(0,1.2fr)_28px]">
                    <span className="col-span-3 flex min-w-0 items-center gap-1 md:col-span-1">
                      <span className="text-[var(--ink-soft)]">{it.milestone ? "◆" : ""}</span>
                      <input className={field} disabled={!canEdit} defaultValue={it.name} onBlur={(e) => e.target.value.trim() && setItem(it.key, { name: e.target.value.trim() })} />
                      <button type="button" onClick={() => setOpen(open === it.key ? null : it.key)} aria-expanded={open === it.key}
                        className="shrink-0 whitespace-nowrap rounded-md border border-[var(--line)] px-1.5 py-0.5 text-[11px]">
                        {it.description || it.checklist.length ? `📝${it.checklist.length ? ` ☑${it.checklist.length}` : ""}` : "＋ รายละเอียด"}
                        {/* มือถือไม่มีคอลัมน์ "ต้องรอ" — บอกจำนวนไว้ตรงนี้ กดเข้าไปแก้ได้ */}
                        {it.dependsOn.length > 0 && <span className="md:hidden"> ⏳{it.dependsOn.length}</span>}
                      </button>
                    </span>
                    <input className={cn(field, "hidden md:block")} list="tpl-roles" disabled={!canEdit || it.milestone} defaultValue={it.milestone ? "—" : it.role}
                      onBlur={(e) => !it.milestone && setItem(it.key, { role: e.target.value.trim() || "ทีมงาน" })} />
                    {/* label ห่อช่อง: มือถือมีคำกำกับหน้าช่อง (คอมใช้หัวตารางด้านบน) — ยังเป็น 1 ช่องของ grid เท่าเดิม */}
                    <label className="flex min-w-0 items-center gap-1">
                      <span className="shrink-0 text-[11px] text-[var(--ink-soft)] md:hidden">เริ่มวันที่</span>
                      <input type="number" min={1} className={cn(field, bad && "border-red-500 text-red-600")} title={bad ? "เริ่มก่อนงานที่ต้องรอเสร็จ" : "เริ่มวันที่เท่าไหร่ของโปรเจกต์"}
                        disabled={!canEdit} value={it.off + 1} onChange={(e) => setItem(it.key, { off: Math.max(0, (+e.target.value || 1) - 1) })} />
                    </label>
                    {it.milestone ? <span className="text-center text-xs text-[var(--ink-soft)]">◆ จุดสำคัญ</span> : (
                      <label className="flex min-w-0 items-center gap-1">
                        <span className="shrink-0 text-[11px] text-[var(--ink-soft)] md:hidden">กี่วัน</span>
                        <input type="number" min={1} className={field} disabled={!canEdit} value={it.dur} title="กี่วัน" onChange={(e) => setItem(it.key, { dur: Math.max(1, +e.target.value || 1) })} />
                      </label>
                    )}
                    {/* รอหลายงาน หรือตั้งวิธีรอไว้ → แก้ในรายละเอียด (ช่องเดียวแก้แล้วจะทับของเดิมหาย) */}
                    {it.dependsOn.length > 1 || Object.keys(it.depRules ?? {}).length ? (
                      <button type="button" onClick={() => setOpen(it.key)} title="แก้ในรายละเอียด"
                        className="hidden truncate rounded-md border border-[var(--line)] px-2 py-1 text-left text-[12px] md:block">
                        {it.dependsOn.map((k) => { const n = t.items.find((x) => x.key === k)?.name ?? "—"; const l = depRuleLabel(it.depRules?.[k]); return l ? `${n} (${l})` : n; }).join(", ")}
                      </button>
                    ) : (
                      <select className={cn(field, "hidden md:block")} disabled={!canEdit} value={it.dependsOn[0] ?? ""} onChange={(e) => setItem(it.key, { dependsOn: e.target.value ? [e.target.value] : [] })}>
                        <option value="">— ไม่ต้องรอ</option>
                        {t.items.filter((x) => x.key !== it.key && !waitsOn(x.key, it.key)).map((x) => <option key={x.key} value={x.key}>{x.milestone ? "◆ " : ""}{x.name}</option>)}
                      </select>
                    )}
                    {canEdit ? (
                      <button type="button" className="text-[var(--ink-soft)]" aria-label="ลบ"
                        onClick={() => set({ items: t.items.filter((x) => x.key !== it.key).map((x) => {
                          const rest = Object.fromEntries(Object.entries(x.depRules ?? {}).filter(([k]) => k !== it.key));
                          return { ...x, dependsOn: x.dependsOn.filter((k) => k !== it.key), depRules: Object.keys(rest).length ? rest : undefined };
                        }) })}>✕</button>
                    ) : <span />}
                  </div>
                  {open === it.key && (
                    <div className="ml-2 grid gap-2 rounded-lg bg-[var(--bg-soft)] p-2.5">
                      {/* มือถือไม่มีคอลัมน์ "ตำแหน่งที่ทำ" — แก้ตรงนี้แทน */}
                      {!it.milestone && (
                        <label className="grid gap-1 text-xs text-[var(--ink-soft)] md:hidden">ตำแหน่งที่ทำ
                          <input className={field} list="tpl-roles" disabled={!canEdit} defaultValue={it.role} onBlur={(e) => setItem(it.key, { role: e.target.value.trim() || "ทีมงาน" })} />
                        </label>
                      )}
                      <div className="grid gap-1.5">
                        <span className="text-xs text-[var(--ink-soft)]">ต้องรอ (เลือกได้หลายงาน · ตั้งได้ว่าเริ่มพร้อมกัน หรือรอเพิ่มกี่วัน{t.workdays ? "ทำงาน" : ""})</span>
                        {it.dependsOn.map((k) => {
                          const pre = t.items.find((x) => x.key === k);
                          const rule = it.depRules?.[k] ?? {};
                          const setRule = (nr: ProjectDepRule) => setDeps(it, it.dependsOn, { ...it.depRules, [k]: nr });
                          return (
                            <div key={k} className="flex flex-wrap items-center gap-1.5 text-xs">
                              <b className="min-w-0 truncate">{pre?.milestone ? "◆ " : ""}{pre?.name ?? "—"}</b>
                              {canEdit ? (
                                <>
                                  {pre && !pre.milestone && (
                                    <select aria-label="วิธีรอ" className="rounded-md border border-[var(--line)] bg-[var(--bg)] px-1 py-0.5 text-base sm:text-xs" value={rule.type ?? "fs"}
                                      onChange={(e) => setRule({ ...rule, type: e.target.value === "ss" ? "ss" : undefined })}>
                                      <option value="fs">เริ่มหลังเสร็จ</option>
                                      <option value="ss">เริ่มพร้อมกันได้</option>
                                    </select>
                                  )}
                                  <label className="inline-flex items-center gap-1 text-[var(--ink-soft)]">+ รอ
                                    <input type="number" min={0} max={365} inputMode="numeric" aria-label="รอเพิ่มกี่วัน" value={rule.lag ?? 0}
                                      onChange={(e) => setRule({ ...rule, lag: Math.min(365, Math.max(0, Math.round(Number(e.target.value) || 0))) || undefined })}
                                      className="w-12 rounded-md border border-[var(--line)] bg-[var(--bg)] px-1 py-0.5 text-center text-base tabular-nums sm:text-xs" />
                                    วัน
                                  </label>
                                  <button type="button" className="text-[var(--ink-soft)]" aria-label="เลิกรอ" onClick={() => setDeps(it, it.dependsOn.filter((x) => x !== k))}>✕</button>
                                </>
                              ) : depRuleLabel(rule) ? <span className="text-[var(--ink-soft)]">({depRuleLabel(rule)})</span> : null}
                            </div>
                          );
                        })}
                        {canEdit && (
                          <select className={cn(field, "w-auto")} value="" onChange={(e) => e.target.value && setDeps(it, [...it.dependsOn, e.target.value])}>
                            <option value="">+ เพิ่มงานที่ต้องรอ</option>
                            {t.items.filter((x) => x.key !== it.key && !it.dependsOn.includes(x.key) && !waitsOn(x.key, it.key)).map((x) => (
                              <option key={x.key} value={x.key}>{x.milestone ? "◆ " : ""}{x.name}</option>
                            ))}
                          </select>
                        )}
                        {!it.dependsOn.length && !canEdit && <span className="text-xs">—</span>}
                      </div>
                      <label className="grid gap-1 text-xs text-[var(--ink-soft)]">คำอธิบาย (ติดไปกับงานทุกครั้งที่สร้างจากแม่แบบ)
                        <textarea className={field} rows={2} disabled={!canEdit} defaultValue={it.description} onBlur={(e) => setItem(it.key, { description: e.target.value })} />
                      </label>
                      <span className="text-xs text-[var(--ink-soft)]">เช็คลิสต์ ({it.checklist.length} ข้อ)</span>
                      {it.checklist.map((c, ci) => (
                        <div key={`${it.key}-${ci}-${c}`} className="flex items-center gap-1.5">
                          <span className="text-[var(--ink-soft)]">☐</span>
                          <input className={field} disabled={!canEdit} defaultValue={c} onBlur={(e) => setItem(it.key, { checklist: it.checklist.map((x, j) => (j === ci ? e.target.value : x)) })} />
                          {canEdit && <button type="button" className="text-[var(--ink-soft)]" aria-label="ลบข้อนี้" onClick={() => setItem(it.key, { checklist: it.checklist.filter((_, j) => j !== ci) })}>✕</button>}
                        </div>
                      ))}
                      {canEdit && (
                        <div className="flex gap-1.5">
                          <input className={field} value={newChk} onChange={(e) => setNewChk(e.target.value)} placeholder="เพิ่มข้อในเช็คลิสต์ แล้วกด Enter"
                            onKeyDown={(e) => { if (e.key === "Enter" && newChk.trim()) { e.preventDefault(); setItem(it.key, { checklist: [...it.checklist, newChk.trim()] }); setNewChk(""); } }} />
                          <button type="button" className="rounded-md border border-[var(--line)] px-2.5 text-xs" onClick={() => { if (newChk.trim()) { setItem(it.key, { checklist: [...it.checklist, newChk.trim()] }); setNewChk(""); } }}>เพิ่ม</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-md border border-[var(--line)] px-3 py-1 text-xs" onClick={() => set({ sections: [...t.sections, { key: `s-${uuid()}`, name: "ช่วงใหม่" }] })}>+ ช่วงงาน</button>
          <button type="button" className="rounded-md border border-[var(--line)] px-3 py-1 text-xs disabled:opacity-50" disabled={!anyBad}
            onClick={() => { set({ items: arrangeTemplate(t) }); toast.success("จัดวันใหม่ให้งานเริ่มหลังงานที่ต้องรอเสร็จแล้ว"); }}>จัดวันตามงานที่ต้องรอ</button>
          {anyBad && <span className="text-xs text-red-600">⚠ มีงานเริ่มก่อนงานที่ต้องรอเสร็จ (ช่องสีแดง)</span>}
        </div>
      )}

      <div className="grid gap-2 rounded-xl border border-[var(--line)] p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {forProject ? (
            <>
              <b>วันจริงของโปรเจกต์นี้</b>
              <span className={cn("text-xs", tooLate ? "font-bold text-red-600" : "text-[var(--ink-soft)]")}>
                {fmtDay(s0, true)} – {fmtDay(e0, true)} · {last + 1} วัน{t.workdays ? "ทำงาน" : ""}{tooLate ? " · ⚠ ต้องเริ่มก่อนวันนี้ เวลาไม่พอ" : ""}
              </span>
            </>
          ) : back ? (
            <>
              <b>ตัวอย่างถ้าต้องเสร็จวันที่</b>
              <DatePickerField className="h-8 w-[150px]" value={endSample} onChange={(v) => v && setEndSample(v)} />
              <span className={cn("text-xs", tooLate ? "font-bold text-red-600" : "text-[var(--ink-soft)]")}>
                {tooLate ? `⚠ เวลาไม่พอ — ต้องเริ่ม ${fmtDay(s0)} ซึ่งผ่านมาแล้ว` : `ต้องเริ่ม ${fmtDay(s0, true)} · ใช้เวลา ${last + 1} วัน${t.workdays ? "ทำงาน" : ""}`}
              </span>
            </>
          ) : (
            <>
              <b>ตัวอย่างถ้าเริ่ม</b>
              <DatePickerField className="h-8 w-[150px]" value={startSample} onChange={(v) => v && setStartSample(v)} />
              <span className="text-xs text-[var(--ink-soft)]">ใช้เวลา {last + 1} วัน{t.workdays ? "ทำงาน" : ""} · จบ {fmtDay(e0, true)}</span>
            </>
          )}
        </div>
        {canEdit && <p className="m-0 text-xs text-[var(--ink-soft)]">ลากแถบเพื่อเลื่อนวันเริ่มของงาน · ลากขอบขวาเพื่อเปลี่ยนจำนวนวัน</p>}
        <div className="overflow-x-auto">
          <div className="relative" style={{ width: 160 + span * PW }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
            {t.items.map((it0) => {
              const it = ghost?.key === it0.key ? { ...it0, off: ghost.off, dur: ghost.dur } : it0;
              const a = dayNum(templateDate(t, s0, it.off, holidays)) - dayNum(s0);
              const b = dayNum(templateDate(t, s0, templateEnd(it), holidays)) - dayNum(s0);
              const bad = templateConflict(t, it0);
              return (
                <div key={it.key} className="relative h-[22px]">
                  <span className="absolute left-0 top-0.5 max-w-[150px] truncate text-[11px] text-[var(--ink-soft)]">{it.name}</span>
                  {it.milestone ? (
                    <i data-pk={it.key} className={cn("absolute top-1 h-3 w-3 rotate-45 rounded-[2px]", canEdit && "cursor-grab")} style={{ left: 160 + a * PW, background: "var(--chart-violet)" }} />
                  ) : (
                    <b data-pk={it.key} className={cn("absolute top-1 h-3.5 rounded", canEdit && "cursor-grab")} style={{ left: 160 + a * PW, width: (b - a + 1) * PW - 2, background: bad ? "var(--chart-red)" : "var(--chart-blue)" }}>
                      {canEdit && <em data-pr="1" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" />}
                    </b>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {canEdit && !forProject && onDelete && onDuplicate && (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-red-600" onClick={onDelete}>ลบแม่แบบ</button>
          <button type="button" className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm" onClick={onDuplicate}>ทำสำเนา</button>
          <span className="self-center text-xs text-[var(--ink-soft)]">แก้แล้วบันทึกอัตโนมัติ</span>
        </div>
      )}
    </div>
  );
}
