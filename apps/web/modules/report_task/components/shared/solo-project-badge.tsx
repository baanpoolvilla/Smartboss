"use client";

import { Lock } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";
import { isSoloProjectTask } from "@/modules/report_task/lib/personal-task";
import type { Task } from "@/modules/report_task/types";

/** คำอธิบายเดียวกันทุกที่ — งานโปรเจกต์ที่เปิดให้ตัวเอง (ผู้ใช้ 26/11/2569) */
export const SOLO_PROJECT_HINT = "งานส่วนตัวในโปรเจกต์ (เปิดให้ตัวเองคนเดียว) · สมาชิกโปรเจกต์ยังเห็น · ไม่มีผลกับคะแนน";

/**
 * ป้าย "ส่วนตัว" ของงานโปรเจกต์ที่คนสร้างเป็นผู้รับคนเดียว — หน้าตาเดียวกับป้ายงานส่วนตัวบนบอร์ด (task-card.tsx)
 * ไม่ใช่งานแบบนี้ = ไม่แสดงอะไร
 */
export function SoloProjectBadge({
  task,
  className,
}: {
  task: (Pick<Task, "assignedById" | "assigneeIds"> & { project?: Task["project"] }) | undefined | null;
  className?: string;
}) {
  if (!task || !isSoloProjectTask(task)) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 h-5 rounded-md px-1.5 text-[10px] font-semibold bg-[var(--accent)] text-[var(--brand-green-dark)] whitespace-nowrap",
        className
      )}
      title={SOLO_PROJECT_HINT}
      data-testid="solo-project-badge"
    >
      <Lock className="h-2.5 w-2.5" />
      ส่วนตัว
    </span>
  );
}
