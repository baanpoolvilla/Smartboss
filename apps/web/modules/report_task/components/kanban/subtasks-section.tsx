"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Separator } from "@/modules/report_task/components/ui/separator";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { PersonDot, fmtDay } from "@/modules/report_task/components/projects/project-ui";
import { getUser, users } from "@/modules/report_task/lib/directory";
import { canEditRecord } from "@/modules/report_task/lib/permissions";
import { buildSubtask, subtasksOf } from "@/modules/report_task/lib/subtasks";
import { cn } from "@/modules/report_task/lib/utils";
import { uuid } from "@/modules/report_task/lib/uuid";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task } from "@/modules/report_task/types";

/** เปิดงานอื่นในแผ่นรายละเอียด — หน้าที่ใช้ ?task= อยู่แล้วสลับในที่เดิม · หน้าอื่นไปเปิดบนบอร์ดงาน */
function useOpenTask() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (id: string) => {
    if (params.get("task")) {
      const p = new URLSearchParams(params.toString());
      p.delete("comment");
      p.set("task", id);
      router.push(`${pathname}?${p.toString()}`, { scroll: false });
    } else {
      router.push(`/report-task/tasks?task=${encodeURIComponent(id)}`);
    }
  };
}

const todayBkk = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

/**
 * งานย่อยในหน้ารายละเอียดงาน (แบบ Asana Subtasks)
 * - งานหลัก: รายการงานย่อย (คน · วันส่ง · สถานะ) + เพิ่มงานย่อย
 * - งานย่อย: บอกว่าเป็นงานย่อยของงานไหน กดกลับไปงานหลักได้
 */
export function SubtasksSection({ task }: { task: Task }) {
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const tasks = useTaskStore((s) => s.tasks);
  const addTask = useTaskStore((s) => s.addTask);
  const moveTask = useTaskStore((s) => s.moveTask);
  const openTask = useOpenTask();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [who, setWho] = useState(task.assigneeIds[0] ?? me);
  const [due, setDue] = useState(task.dueDate.slice(0, 10) < todayBkk() ? todayBkk() : task.dueDate.slice(0, 10));

  if (task.parentId) {
    const parent = tasks.find((t) => t.id === task.parentId);
    if (!parent) return null;
    return (
      <>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-[13px]">
        <span className="text-[var(--ink-soft)]">↳ งานย่อยของ</span>
        <button type="button" className="font-semibold text-[var(--brand-green-dark)] hover:underline" onClick={() => openTask(parent.id)}>
          {parent.title}
        </button>
      </div>
      <Separator />
      </>
    );
  }

  const subs = subtasksOf(tasks, task.id);
  // เพิ่มได้: คนมอบหมาย/หัวหน้า/CEO (แก้งานได้) + คนที่รับงานหลัก (แตกงานของตัวเองเป็นชิ้น ๆ)
  const canAdd = canEditRecord(task.assignedById, task.departmentIds, me) || task.assigneeIds.includes(me);
  if (!subs.length && !canAdd) return null;
  const done = subs.filter((s) => s.status === "done").length;

  function add() {
    const t = title.trim();
    if (!t) return;
    addTask(buildSubtask(task, { title: t, assigneeId: who, dueDate: due }, me, { taskId: `task-${uuid()}` }, new Date().toISOString()));
    toast.success(`เพิ่มงานย่อยแล้ว · ขึ้นบอร์ดงานของ ${getUser(who)?.name ?? ""}`);
    setTitle("");
  }

  return (
    <>
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold">งานย่อย</h4>
        {subs.length > 0 && (
          <span className="text-xs text-[var(--ink-soft)]">
            เสร็จ {done}/{subs.length}
          </span>
        )}
        {canAdd && !adding && (
          <button type="button" className="ml-auto rounded-md px-2 py-0.5 text-xs font-semibold text-[var(--brand-green-dark)] hover:bg-[var(--bg-soft)]" onClick={() => setAdding(true)}>
            + เพิ่มงานย่อย
          </button>
        )}
      </div>
      {subs.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0">
          {subs.map((s) => {
            const late = s.status !== "done" && s.dueDate.slice(0, 10) < todayBkk();
            const mine = s.assigneeIds.includes(me);
            return (
              <li key={s.id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[13px]">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-[var(--brand-green)]"
                  checked={s.status === "done"}
                  disabled={!mine}
                  title={mine ? "ติ๊กเมื่อทำเสร็จ" : "คนที่รับงานย่อยเป็นคนติ๊กเสร็จ"}
                  aria-label={`เสร็จ: ${s.title}`}
                  onChange={(e) => moveTask(s.id, e.target.checked ? "done" : "in_progress")}
                />
                <button type="button" className={cn("min-w-0 flex-1 truncate text-left hover:underline", s.status === "done" && "text-[var(--ink-soft)] line-through")} onClick={() => openTask(s.id)}>
                  {s.title}
                </button>
                {s.assigneeIds[0] && <PersonDot userId={s.assigneeIds[0]} size={20} />}
                <span className={cn("shrink-0 tabular-nums text-xs", late ? "font-semibold text-red-600" : "text-[var(--ink-soft)]")}>{fmtDay(s.dueDate)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <div className="grid gap-2 rounded-lg bg-[var(--bg-soft)] p-2.5">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="ชื่องานย่อย เช่น เดินสายชั้น 1"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-base text-[var(--ink)] sm:text-sm"
          />
          <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-2">
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="คนทำ"
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-base text-[var(--ink)] sm:text-sm">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <DatePickerField value={due} minDate={todayBkk()} onChange={(v) => v && setDue(v)} className="text-[var(--ink)]" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-[var(--ink-soft)]">งานย่อยขึ้นบอร์ดงานของคนที่ได้รับ · เลยกำหนดถูกหักคะแนนเหมือนงานปกติ</span>
            <button type="button" className="ml-auto rounded-lg px-3 py-1 text-xs" onClick={() => { setAdding(false); setTitle(""); }}>ปิด</button>
            <button type="button" className="rounded-lg bg-[var(--brand-green)] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={!title.trim()} onClick={add}>
              เพิ่ม
            </button>
          </div>
        </div>
      )}
      {!subs.length && !adding && canAdd && (
        <p className="m-0 text-xs text-[var(--ink-soft)]">แตกงานนี้เป็นชิ้นเล็ก ๆ ให้แต่ละคน มีวันส่งของตัวเอง</p>
      )}
    </div>
    <Separator />
    </>
  );
}

/** ป้ายบนการ์ดงานหลัก: "งานย่อย 1/3" — ไม่มีงานย่อย = ไม่แสดง */
export function SubtaskCountChip({ taskId }: { taskId: string }) {
  // คืนค่าเป็นข้อความ (ค่าเดิม = ไม่ render ใหม่) ไม่ใช่ array ที่สร้างใหม่ทุกครั้ง
  const label = useTaskStore((s) => {
    let n = 0, d = 0;
    for (const t of s.tasks) if (t.parentId === taskId) { n++; if (t.status === "done") d++; }
    return n ? `${d}/${n}` : "";
  });
  if (!label) return null;
  return (
    <span className="inline-flex h-5 items-center gap-0.5 whitespace-nowrap rounded-md bg-sky-100 px-1.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300" title="งานย่อยที่เสร็จแล้ว">
      ☰ งานย่อย {label}
    </span>
  );
}

/** ลิงก์ไปงานหลัก (ใช้บนการ์ด) */
export function ParentTaskLink({ parentId }: { parentId: string }) {
  const parent = useTaskStore((s) => s.tasks.find((t) => t.id === parentId));
  if (!parent) return null;
  return (
    <Link href={`/report-task/tasks?task=${encodeURIComponent(parent.id)}`} onClick={(e) => e.stopPropagation()}
      className="truncate text-[10.5px] text-[var(--ink-soft)] hover:underline">
      ↳ {parent.title}
    </Link>
  );
}
