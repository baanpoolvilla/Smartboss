"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { departmentIdsOf, users } from "@/modules/report_task/lib/directory";
import { dayToIso, shiftDays, templateDate, templateEnd, templateStartFromEnd } from "@/modules/report_task/lib/project-schedule";
import { uuid } from "@/modules/report_task/lib/uuid";
import { cn } from "@/modules/report_task/lib/utils";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useProjectStore } from "@/modules/report_task/store/project-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Project, ProjectMilestone, Task } from "@/modules/report_task/types";
import { guessPersonForRole } from "./project-roles";
import { fmtDay, notifyAddedToProject, todayBkk, useCompanyHolidays } from "./project-ui";

/**
 * สร้างโปรเจกต์ — เริ่มเปล่า หรือจากแม่แบบ (ช่วงงาน + งาน + Milestone + งานที่ต้องรอ + คำอธิบาย/เช็คลิสต์)
 * แม่แบบแบบ "นับถอยหลังจากวันเสร็จ" ใส่แค่วันเสร็จ ระบบคำนวณวันเริ่มให้ · วันเริ่มผ่านไปแล้ว = เตือน "เวลาไม่พอ"
 */
export function CreateProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const templates = useProjectStore((s) => s.templates);
  const addProject = useProjectStore((s) => s.addProject);
  const upsertTemplate = useProjectStore((s) => s.upsertTemplate);
  const addTask = useTaskStore((s) => s.addTask);
  const holidays = useCompanyHolidays();
  const today = todayBkk();

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(shiftDays(today, 30));
  const [ownerId, setOwnerId] = useState(me);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [tplId, setTplId] = useState<string>(templates[0]?.id ?? "");
  const tpl = templates.find((t) => t.id === tplId);
  const roles = useMemo(() => [...new Set((tpl?.items ?? []).filter((i) => !i.milestone).map((i) => i.role || "ทีมงาน"))], [tpl]);
  const [roleMap, setRoleMap] = useState<Record<string, string>>({});
  // เดาคนจากตำแหน่ง/แผนก — เดาไม่ได้ใส่เจ้าของโปรเจกต์ (ปกติ = คนสร้างเอง) ไว้ก่อน เปลี่ยนได้
  const guessed = (role: string) => guessPersonForRole(role, "");
  const personFor = (role: string) => roleMap[role] ?? (guessed(role) || ownerId);
  const creating = useRef(false);

  // แม่แบบนับถอยหลัง: วันเริ่มคำนวณจากวันเสร็จ
  const effStart = tpl?.anchor === "end" ? templateStartFromEnd(tpl, end, holidays) : start;
  const effEnd = tpl ? templateDate(tpl, effStart, tpl.items.length ? Math.max(...tpl.items.map(templateEnd)) : 0, holidays) : end;
  const tooLate = tpl?.anchor === "end" && effStart < today;
  // ตรวจก่อนสร้าง: งานที่กำหนดส่งก่อนวันนี้ (สร้างปุ๊บเลยกำหนด โดนหักคะแนนทันที) · จบเกินวันเสร็จเป้าหมาย
  const pastDue = (tpl?.items ?? []).filter((i) => !i.milestone && templateDate(tpl!, effStart, templateEnd(i), holidays) < today);
  const overEnd = !!tpl && tpl.anchor === "start" && effEnd > end;
  const blocked = !name.trim() ? "ใส่ชื่อโปรเจกต์ก่อน"
    : pastDue.length ? `มี ${pastDue.length} งานกำหนดส่งก่อนวันนี้ (${pastDue.slice(0, 3).map((i) => i.name).join(", ")}${pastDue.length > 3 ? " …" : ""}) — ${tpl?.anchor === "end" ? "เลื่อนวันเสร็จออกไป" : "เลื่อนวันเริ่มเป็นวันนี้หรือหลังจากนี้"}`
    : "";

  function create() {
    if (blocked) { toast.error(blocked); return; }
    if (creating.current) return; // กันกดสองครั้งแล้วได้โปรเจกต์ซ้ำ
    creating.current = true;
    const now = new Date().toISOString();
    const pid = `proj-${uuid()}`;
    const secId = new Map<string, string>();
    const sections = tpl ? tpl.sections.map((s) => { const id = `psec-${uuid()}`; secId.set(s.key, id); return { id, name: s.name }; }) : [{ id: `psec-${uuid()}`, name: "งานทั้งหมด" }];
    const itemId = new Map<string, string>();
    for (const it of tpl?.items ?? []) itemId.set(it.key, it.milestone ? `pms-${uuid()}` : `task-${uuid()}`);
    const milestones: ProjectMilestone[] = [];
    const newTasks: Task[] = [];
    for (const it of tpl?.items ?? []) {
      const s = templateDate(tpl!, effStart, it.off, holidays);
      const e = templateDate(tpl!, effStart, templateEnd(it), holidays);
      const deps = it.dependsOn.map((k) => itemId.get(k)).filter((x): x is string => !!x);
      // วิธีรอจากแม่แบบ (key → id จริง) · ไม่มี = เริ่มหลังเสร็จ เหมือนเดิม
      const depRules = Object.fromEntries(
        Object.entries(it.depRules ?? {}).flatMap(([k, r]) => { const id = itemId.get(k); return id && it.dependsOn.includes(k) && (r.type || r.lag) ? [[id, { ...r }]] : []; })
      );
      const rules = Object.keys(depRules).length ? { depRules } : {};
      const sectionId = secId.get(it.sectionKey) ?? sections[0]!.id;
      if (it.milestone) { milestones.push({ id: itemId.get(it.key)!, name: it.name, date: s, sectionId, dependsOn: deps, ...rules }); continue; }
      const who = personFor(it.role || "ทีมงาน");
      newTasks.push({
        id: itemId.get(it.key)!,
        title: it.name,
        description: it.description,
        status: "todo",
        priority: "medium",
        taskMode: "individual",
        assigneeIds: [who],
        assignedById: me,
        departmentIds: departmentIdsOf([who]),
        startDate: dayToIso(s),
        dueDate: dayToIso(e),
        originalDueDate: dayToIso(e),
        attachments: [],
        comments: [],
        revisions: [],
        reactions: [],
        checklist: it.checklist.map((text) => ({ id: `task-chk-${uuid()}`, text, done: false, ownerId: who })),
        completedAssigneeIds: [],
        showChecklistOnCard: false,
        project: { projectId: pid, sectionId, dependsOn: deps, ...rules },
        createdAt: now,
        updatedAt: now,
      });
    }
    const members = [...new Set([...memberIds, ...newTasks.flatMap((t) => t.assigneeIds)])].filter((id) => id !== ownerId).map((userId) => ({ userId, role: "editor" as const }));
    const project: Project = {
      id: pid, name: name.trim(), description: desc.trim(), ownerId, members,
      startDate: effStart, endDate: tpl ? (effEnd > end && tpl.anchor === "start" ? effEnd : end) : end,
      sections, milestones, updates: [], shiftMode: "ask", createdBy: me, createdAt: now, updatedAt: now,
    };
    addProject(project);
    newTasks.forEach((t) => addTask(t));
    notifyAddedToProject(project, [ownerId, ...members.map((m) => m.userId)], me);
    if (tpl) upsertTemplate({ ...tpl, usedCount: tpl.usedCount + 1 });
    toast.success(`สร้างโปรเจกต์แล้ว${newTasks.length ? ` · สร้างงาน ${newTasks.length} งานบนบอร์ดงานให้` : ""}`);
    onClose();
    onCreated(pid);
  }

  const field = "w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-base sm:text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" onClick={onClose}>
      <div className="grid max-h-[92dvh] w-full gap-4 overflow-y-auto rounded-t-2xl bg-[var(--bg)] p-4 shadow-2xl sm:max-w-3xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="สร้างโปรเจกต์">
        <div className="flex items-center"><b className="text-base">สร้างโปรเจกต์</b><button type="button" className="ml-auto px-2" onClick={onClose} aria-label="ปิด">✕</button></div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid content-start gap-3">
            <label className="grid gap-1 text-xs text-[var(--ink-soft)]">ชื่อโปรเจกต์<input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น รีโนเวทบ้าน HS3 ก่อนไฮซีซั่น" autoFocus /></label>
            <label className="grid gap-1 text-xs text-[var(--ink-soft)]">เป้าหมาย / ขอบเขต<textarea className={field} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs text-[var(--ink-soft)]">วันเริ่ม
                <input type="date" className={cn(field, tpl?.anchor === "end" && "opacity-60")} value={effStart} min={tpl?.items.length ? today : undefined} disabled={tpl?.anchor === "end"} onChange={(e) => e.target.value && setStart(e.target.value)} />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ink-soft)]">วันเสร็จเป้าหมาย<input type="date" className={field} value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} /></label>
            </div>
            {tpl?.anchor === "end" && (
              <p className={cn("m-0 text-xs", tooLate ? "font-bold text-red-600" : "text-[var(--brand-green-dark)]")}>
                {tooLate ? `⚠ เวลาไม่พอ — แม่แบบนี้ต้องเริ่ม ${fmtDay(effStart)} (ผ่านมาแล้ว ${Math.round((Date.parse(today) - Date.parse(effStart)) / 864e5)} วัน) · เลื่อนวันเสร็จ หรือตัดงานบางอย่างออกทีหลัง` : `แม่แบบนี้นับถอยหลังจากวันเสร็จ → ต้องเริ่ม ${fmtDay(effStart, true)}`}
              </p>
            )}
            {overEnd && (
              <p className="m-0 text-xs font-semibold text-amber-700 dark:text-amber-300">
                ⚠ งานตามแม่แบบจบ {fmtDay(effEnd, true)} เกินวันเสร็จเป้าหมาย {Math.round((Date.parse(effEnd) - Date.parse(end)) / 864e5)} วัน · ถ้าสร้างเลย วันเสร็จเป้าหมายจะเป็น {fmtDay(effEnd, true)} (หรือเลื่อนวันเริ่มให้เร็วขึ้น)
              </p>
            )}
            <label className="grid gap-1 text-xs text-[var(--ink-soft)]">เจ้าของโปรเจกต์ (คุมแผน เลื่อนกำหนดส่งได้)
              <select className={field} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            </label>
            <div className="grid gap-1 text-xs text-[var(--ink-soft)]">สมาชิก (นอกจากคนที่ได้งานจากแม่แบบ ซึ่งเข้าให้อัตโนมัติ)
              <div className="flex flex-wrap gap-1.5">
                {memberIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--ink)]">
                    {users.find((u) => u.id === id)?.name}<button type="button" aria-label="เอาออก" onClick={() => setMemberIds(memberIds.filter((x) => x !== id))}>✕</button>
                  </span>
                ))}
              </div>
              <select className={field} value="" onChange={(e) => e.target.value && setMemberIds([...memberIds, e.target.value])}>
                <option value="">+ เพิ่มสมาชิก</option>
                {users.filter((u) => u.id !== ownerId && !memberIds.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid content-start gap-3">
            <div className="grid gap-1.5">
              <span className="text-xs text-[var(--ink-soft)]">เริ่มจากแม่แบบ</span>
              {[{ id: "", name: "เปล่า", sub: "เริ่มจากศูนย์" }, ...templates.map((t) => ({ id: t.id, name: t.name, sub: `${t.sections.map((s) => s.name).join(" → ")} · ${t.items.filter((i) => i.milestone).length} Milestone${t.anchor === "end" ? " · นับถอยหลังจากวันเสร็จ" : ""}` }))].map((o) => (
                <label key={o.id || "blank"} className={cn("flex cursor-pointer gap-2.5 rounded-xl border p-2.5", tplId === o.id ? "border-[var(--brand-green)] bg-[var(--accent)]" : "border-[var(--line)]")}>
                  <input type="radio" name="proj-tpl" checked={tplId === o.id} onChange={() => setTplId(o.id)} className="mt-1 accent-[var(--brand-green)]" />
                  <span><b className="block text-[13.5px]">{o.name}</b><span className="text-xs text-[var(--ink-soft)]">{o.sub}</span></span>
                </label>
              ))}
            </div>
            {tpl && roles.length > 0 && (
              <div className="grid gap-1.5">
                <span className="text-xs text-[var(--ink-soft)]">ใครทำตำแหน่งไหน</span>
                {roles.map((r) => (
                  <div key={r} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-xs">{r}</span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <select className={field} value={personFor(r)} onChange={(e) => setRoleMap({ ...roleMap, [r]: e.target.value })} aria-label={`คนทำตำแหน่ง ${r}`}>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                      {!roleMap[r] && !guessed(r) && <span className="text-[11px] text-[var(--ink-soft)]">ไม่เจอคนตำแหน่งนี้ ใส่เป็นเจ้าของโปรเจกต์ไว้ก่อน</span>}
                    </span>
                  </div>
                ))}
                <span className="text-xs text-[var(--ink-soft)]">จะสร้างงาน {tpl.items.filter((i) => !i.milestone).length} งานบนบอร์ดงาน + {tpl.items.filter((i) => i.milestone).length} Milestone · จบประมาณ {fmtDay(effEnd, true)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] pt-3">
          {blocked && <span className="mr-auto text-xs text-red-600">{blocked}</span>}
          <button type="button" className="rounded-lg border border-[var(--line)] px-4 py-1.5 text-sm" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="rounded-lg bg-[var(--brand-green)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!!blocked} onClick={create}>สร้างโปรเจกต์</button>
        </div>
      </div>
    </div>
  );
}
