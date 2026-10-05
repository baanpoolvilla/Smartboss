"use client";

import { useMemo, useState } from "react";
import { UserMinus, UserPlus, UserCog } from "lucide-react";
import { getUser } from "@/modules/report_task/lib/directory";
import { formatDateTime } from "@/modules/report_task/lib/format";
import { useActivityLogStore } from "@/modules/report_task/store/activity-log-store";

const COLLAPSED_COUNT = 3;

/**
 * ประวัติผู้รับผิดชอบของงานนี้ — ใครเอาใครออก/เพิ่มใครเข้า เมื่อไร
 *
 * อ่านจากบันทึกกิจกรรมตัวเดียวกับหน้า "บันทึกกิจกรรม" (task-store setAssignees เป็นคนเขียน)
 * เอามาแสดงในหน้างานด้วย เพราะคนที่เปิดงานอยู่ไม่ควรต้องออกไปค้นในบันทึกรวมว่าทำไมชื่อหายไป
 * ไม่มีรายการ = ไม่แสดงอะไรเลย (งานส่วนใหญ่ไม่เคยเปลี่ยนคน)
 */
export function AssigneeHistory({ taskId }: { taskId: string }) {
  const entries = useActivityLogStore((s) => s.entries);
  const [expanded, setExpanded] = useState(false);
  const items = useMemo(
    // "ผู้รับผิดชอบ" ครอบทั้งข้อความใหม่ (เอาออก/เพิ่ม) และรายการเก่า ("เปลี่ยนผู้รับผิดชอบ")
    () => entries.filter((e) => e.taskId === taskId && e.action.includes("ผู้รับผิดชอบ")),
    [entries, taskId]
  );
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, COLLAPSED_COUNT);

  return (
    <div className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs">
      <p className="mb-1 font-medium text-[var(--ink-soft)]">ประวัติผู้รับผิดชอบ</p>
      <ul className="space-y-1">
        {shown.map((e) => {
          const removed = e.action.includes("ออก");
          const Icon = removed ? UserMinus : e.action.includes("เพิ่ม") ? UserPlus : UserCog;
          return (
            <li key={e.id} className="flex items-start gap-1.5">
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${removed ? "text-[var(--chart-red)]" : "text-[var(--chart-blue)]"}`} />
              <span className="min-w-0 text-[var(--ink)]">
                <span className="font-medium">{getUser(e.userId)?.name ?? "ไม่ทราบชื่อ"}</span> {e.action}
                {e.detail ? <span className="text-[var(--ink-soft)]"> · {e.detail}</span> : null}
                <span className="whitespace-nowrap text-[var(--ink-soft)]"> · {formatDateTime(e.createdAt)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {items.length > COLLAPSED_COUNT && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 font-medium text-[var(--chart-blue)] hover:underline">
          {expanded ? "ย่อ" : `ดูทั้งหมด ${items.length} รายการ`}
        </button>
      )}
    </div>
  );
}
