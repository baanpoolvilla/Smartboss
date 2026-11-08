"use client";

import { useState } from "react";
import { CalendarDays, ClipboardList } from "lucide-react";

import { getUser } from "@/modules/report_task/lib/directory";
import { useTaskStore } from "@/modules/report_task/store/task-store";

/**
 * การ์ดงานในเธรดของห้องรีพอร์ต (ผู้ใช้ 8/11/2569 ตามที่ Os-Thanonchai ขอ "ให้แสดงในหน้าที่สนทนาอยู่ เหมือน Microsoft")
 * แบบการ์ด Planner ใน Teams: ชื่องาน · มอบหมายให้ · วันส่ง · สถานะ · ปุ่มเปิดงาน
 * ข้อมูลสดจากรายการงานของเครื่อง (เปลี่ยนสถานะแล้วการ์ดเปลี่ยนตาม) · หาไม่เจอ (ไม่มีสิทธิ์เห็น/ถูกลบ) ใช้ชื่อที่จดไว้ตอนสร้าง
 */
export function ReportTaskCard({ taskId, title, onOpen }: { taskId: string; title: string; onOpen?: (taskId: string) => void }) {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === taskId));
  const names = (task?.assigneeIds ?? []).map((id) => getUser(id)?.name ?? "ไม่ทราบชื่อ");
  const group = !!task && task.taskMode === "group" && task.assigneeIds.length > 1;
  const doneCount = task?.completedAssigneeIds?.length ?? 0;
  const [today] = useState(() => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10));
  // dueDate เก็บได้ทั้ง "YYYY-MM-DD" และ ISO มีเวลา — ใช้แค่ส่วนวันที่
  const dueDay = task?.dueDate ? task.dueDate.slice(0, 10) : "";
  const late = !!task && task.status !== "done" && !!dueDay && dueDay < today;
  const status = !task
    ? null
    : task.status === "done"
      ? { text: "เสร็จแล้ว", cls: "bg-slate-100 text-slate-700" }
      : late
        ? { text: "เลยกำหนด", cls: "bg-red-50 text-red-700" }
        : task.status === "in_progress"
          ? { text: "กำลังทำ", cls: "bg-amber-50 text-amber-800" }
          : { text: "ยังไม่เริ่ม", cls: "bg-[var(--bg-soft)] text-[var(--ink-soft)]" };
  const due = /^\d{4}-\d{2}-\d{2}$/.test(dueDay)
    ? new Date(`${dueDay}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="mt-1.5 max-w-md rounded-lg border border-[var(--line)] bg-white p-3 shadow-sm dark:bg-transparent" data-testid="report-task-card">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-soft)]">
        <ClipboardList className="h-4 w-4 text-[var(--brand-navy)]" aria-hidden="true" />
        งาน{task?.code ? ` · ${task.code}` : ""}
        {status && <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}>{status.text}</span>}
      </div>
      <p className="mt-1.5 text-[15px] font-semibold leading-snug text-[var(--ink)]">{task?.title ?? title}</p>
      {task ? (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[13px]">
          <dt className="text-[var(--ink-soft)]">มอบหมายให้:</dt>
          <dd className="min-w-0 text-[var(--ink)]">{names.join(", ") || "—"}</dd>
          {group && (
            <>
              <dt className="text-[var(--ink-soft)]">ความคืบหน้า:</dt>
              <dd className="text-[var(--ink)]">{doneCount}/{task.assigneeIds.length} คนเสร็จแล้ว</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="mt-1 text-[13px] text-[var(--ink-soft)]">เปิดดูรายละเอียดในหน้างาน</p>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {due ? (
          <span className={`inline-flex items-center gap-1 text-[13px] ${late ? "font-semibold text-red-700" : "text-[var(--ink-soft)]"}`}>
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> {due}
          </span>
        ) : (
          <span />
        )}
        {onOpen && (
          <button
            type="button"
            onClick={() => onOpen(taskId)}
            className="h-9 rounded-md border border-[var(--line)] bg-white px-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--bg-soft)] dark:bg-transparent"
          >
            เปิดงาน
          </button>
        )}
      </div>
    </div>
  );
}
