"use client";

import { Search, Plus, AlertTriangle } from "lucide-react";
import { Input } from "@/modules/report_task/components/ui/input";
import { Button } from "@/modules/report_task/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { getDepartment, getUser } from "@/modules/report_task/data/mock";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { taskPriorityOrder, priorityMeta } from "@/modules/report_task/lib/task-meta";
import type { TaskPriority } from "@/modules/report_task/types";
import { cn } from "@/modules/report_task/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { NewTaskDialog } from "./new-task-dialog";

const penaltyFilterLabels = {
  all: "การหักคะแนน: ทั้งหมด",
  overdue: "งานเลยกำหนดทั้งหมด",
  pending: "เลยกำหนด · ยังไม่หัก",
  docked: "ถูกหักคะแนนแล้ว",
} as const;

export function TaskFilters() {
  const filters = useTaskStore((s) => s.filters);
  const setFilters = useTaskStore((s) => s.setFilters);
  const resetFilters = useTaskStore((s) => s.resetFilters);
  const allTasks = useTaskStore((s) => s.tasks);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  // filters is global store state that outlives the identity switcher — a
  // department/assignee picked while viewing as one person would otherwise
  // stay applied (and possibly reference an option the new identity can't
  // even see) after switching. Reset on every identity change. This mutates
  // an external (Zustand) store, so it has to run as an effect, not during
  // render — setting store state mid-render is unsafe.
  const lastIdentity = useRef(viewingAsUserId);
  useEffect(() => {
    if (lastIdentity.current !== viewingAsUserId) {
      lastIdentity.current = viewingAsUserId;
      resetFilters();
    }
  }, [viewingAsUserId, resetFilters]);

  // Only offer departments/people that actually show up among tasks this
  // viewer can see (canSeeTask) — picking one outside that set always came
  // back empty, which read as broken rather than "you don't have access".
  const { availableDepartments, availableAssignees } = useMemo(() => {
    const visible = allTasks.filter((t) => canSeeTask(t, viewingAsUserId));
    const deptIds = new Set(visible.flatMap((t) => t.departmentIds));
    const assigneeIds = new Set(visible.flatMap((t) => t.assigneeIds));
    return {
      availableDepartments: [...deptIds].map((id) => getDepartment(id)).filter((d): d is NonNullable<typeof d> => !!d),
      availableAssignees: [...assigneeIds].map((id) => getUser(id)).filter((u): u is NonNullable<typeof u> => !!u),
    };
  }, [allTasks, viewingAsUserId]);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ink-soft)]" />
        <Input
          placeholder="ค้นหางาน ผู้รับผิดชอบ หรือรายละเอียด..."
          className="pl-9 bg-white"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
        />
      </div>

      {availableDepartments.length > 1 ? (
        <Select value={filters.departmentId} onValueChange={(v) => v && setFilters({ departmentId: v })}>
          <SelectTrigger className="w-full sm:w-[160px] bg-white">
            <SelectValue placeholder="แผนก">
              {filters.departmentId === "all" ? "ทุกแผนก" : (getDepartment(filters.departmentId)?.name ?? "แผนก")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกแผนก</SelectItem>
            {availableDepartments.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        // Nothing to actually pick between — just say which one, no dropdown.
        <span className="inline-flex items-center h-9 px-3 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] text-sm text-[var(--ink-soft)] w-full sm:w-[160px] truncate">
          {availableDepartments[0]?.name ?? "ไม่มีแผนก"}
        </span>
      )}

      {availableAssignees.length > 1 ? (
        <Select value={filters.assigneeId} onValueChange={(v) => v && setFilters({ assigneeId: v })}>
          <SelectTrigger className="w-full sm:w-[160px] bg-white">
            <SelectValue placeholder="ผู้รับผิดชอบ">
              {filters.assigneeId === "all" ? "ทุกคน" : (getUser(filters.assigneeId)?.name ?? "ผู้รับผิดชอบ")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกคน</SelectItem>
            {availableAssignees.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="inline-flex items-center h-9 px-3 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] text-sm text-[var(--ink-soft)] w-full sm:w-[160px] truncate">
          {availableAssignees[0]?.id === viewingAsUserId ? "ตัวเอง" : (availableAssignees[0]?.name ?? "ไม่มีผู้รับผิดชอบ")}
        </span>
      )}

      <Select value={filters.priority} onValueChange={(v) => v && setFilters({ priority: v as typeof filters.priority })}>
        <SelectTrigger className="w-full sm:w-[140px] bg-white">
          <SelectValue placeholder="ความสำคัญ">
            {filters.priority === "all" ? "ทุกความสำคัญ" : (priorityMeta[filters.priority as TaskPriority]?.label ?? "ความสำคัญ")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">ทุกความสำคัญ</SelectItem>
          {taskPriorityOrder.map((p) => (
            <SelectItem key={p} value={p}>{priorityMeta[p].label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        onClick={() => setFilters({ penalty: filters.penalty === "overdue" ? "all" : "overdue" })}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 h-9 text-xs font-medium rounded-lg border transition-colors shrink-0",
          filters.penalty === "overdue"
            ? "bg-red-50 border-red-200 text-[var(--chart-red)]"
            : "border-[var(--line)] bg-white text-[var(--ink-soft)] hover:text-[var(--ink)]"
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        เลยกำหนดเท่านั้น
      </button>

      <Select value={filters.penalty} onValueChange={(v) => v && setFilters({ penalty: v as typeof filters.penalty })}>
        <SelectTrigger className="w-full sm:w-[170px] bg-white">
          <SelectValue placeholder="การหักคะแนน">
            {penaltyFilterLabels[filters.penalty]}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(penaltyFilterLabels) as (keyof typeof penaltyFilterLabels)[]).map((k) => (
            <SelectItem key={k} value={k}>{penaltyFilterLabels[k]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        className="sm:ml-auto bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
        onClick={() => setNewTaskOpen(true)}
      >
        <Plus className="h-4 w-4" />
        สร้างงานใหม่
      </Button>

      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} />
    </div>
  );
}
