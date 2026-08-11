"use client";

import { Plus, AlertTriangle, Building2, Users, Flag, AlarmClockOff } from "lucide-react";
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
import { getDepartment, getUser } from "@/modules/report_task/lib/directory";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { taskPriorityOrder, priorityMeta } from "@/modules/report_task/lib/task-meta";
import type { TaskPriority } from "@/modules/report_task/types";
import { FilterField, FILTER_FIELD_LABEL_CLASS, filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { DateRangeSelectField } from "@/modules/report_task/components/shared/date-range-select-field";
import { cn } from "@/modules/report_task/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { NewTaskDialog } from "./new-task-dialog";

const penaltyFilterLabels = {
  all: "ทั้งหมด",
  overdue: "งานเลยกำหนดทั้งหมด",
  pending: "เลยกำหนด · ยังไม่หัก",
  docked: "ถูกหักคะแนนแล้ว",
} as const;

const defaultFilters = {
  assigneeId: "all",
  departmentId: "all",
  priority: "all",
  penalty: "all",
  preset: "all",
  customFrom: "",
  customTo: "",
} as const;

export function TaskFilters() {
  const filters = useTaskStore((s) => s.filters);
  const setFilters = useTaskStore((s) => s.setFilters);
  const resetFilters = useTaskStore((s) => s.resetFilters);
  const allTasks = useTaskStore((s) => s.tasks);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const isFiltered =
    filters.departmentId !== defaultFilters.departmentId ||
    filters.assigneeId !== defaultFilters.assigneeId ||
    filters.priority !== defaultFilters.priority ||
    filters.penalty !== defaultFilters.penalty ||
    filters.preset !== defaultFilters.preset;

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
    <div className="flex flex-wrap items-end gap-2">
      {availableDepartments.length > 1 ? (
        <FilterField label="แผนก">
          <Select value={filters.departmentId} onValueChange={(v) => v && setFilters({ departmentId: v })}>
            <SelectTrigger className={filterFieldTriggerClass(filters.departmentId !== "all", "min-w-[130px]")}>
              <Building2 className="h-4 w-4 shrink-0" />
              <SelectValue placeholder="แผนก">
                {filters.departmentId === "all" ? "ทุกแผนก" : (getDepartment(filters.departmentId)?.name ?? "แผนก")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value="all">ทุกแผนก</SelectItem>
              {availableDepartments.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
      ) : (
        // Nothing to actually pick between — just say which one, no dropdown.
        <FilterField label="แผนก">
          <span className={filterFieldTriggerClass(false, "min-w-[130px] cursor-default")}>
            <Building2 className="h-4 w-4 shrink-0" />
            {availableDepartments[0]?.name ?? "ไม่มีแผนก"}
          </span>
        </FilterField>
      )}

      {availableAssignees.length > 1 ? (
        <FilterField label="พนักงาน">
          <Select value={filters.assigneeId} onValueChange={(v) => v && setFilters({ assigneeId: v })}>
            <SelectTrigger className={filterFieldTriggerClass(filters.assigneeId !== "all", "min-w-[150px]")}>
              <Users className="h-4 w-4 shrink-0" />
              <SelectValue placeholder="ผู้รับผิดชอบ">
                {filters.assigneeId === "all" ? "ทุกคน" : (getUser(filters.assigneeId)?.name ?? "ผู้รับผิดชอบ")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value="all">ทุกคน</SelectItem>
              {availableAssignees.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
      ) : (
        <FilterField label="พนักงาน">
          <span className={filterFieldTriggerClass(false, "min-w-[130px] cursor-default")}>
            <Users className="h-4 w-4 shrink-0" />
            {availableAssignees[0]?.id === viewingAsUserId ? "ตัวเอง" : (availableAssignees[0]?.name ?? "ไม่มีผู้รับผิดชอบ")}
          </span>
        </FilterField>
      )}

      <DateRangeSelectField
        preset={filters.preset}
        customFrom={filters.customFrom}
        customTo={filters.customTo}
        onPresetChange={(preset) => setFilters({ preset })}
        onCustomRangeChange={(customFrom, customTo) => setFilters({ customFrom, customTo })}
      />

      <FilterField label="ความสำคัญ">
        <Select value={filters.priority} onValueChange={(v) => v && setFilters({ priority: v as typeof filters.priority })}>
          <SelectTrigger className={filterFieldTriggerClass(filters.priority !== "all", "min-w-[130px]")}>
            <Flag className="h-4 w-4 shrink-0" />
            <SelectValue placeholder="ความสำคัญ">
              {filters.priority === "all" ? "ทุกความสำคัญ" : (priorityMeta[filters.priority as TaskPriority]?.label ?? "ความสำคัญ")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectItem value="all">ทุกความสำคัญ</SelectItem>
            {taskPriorityOrder.map((p) => (
              <SelectItem key={p} value={p}>{priorityMeta[p].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label="การหักคะแนน">
        <Select value={filters.penalty} onValueChange={(v) => v && setFilters({ penalty: v as typeof filters.penalty })}>
          <SelectTrigger className={filterFieldTriggerClass(filters.penalty !== "all", "min-w-[150px]")}>
            <AlarmClockOff className="h-4 w-4 shrink-0" />
            <SelectValue placeholder="การหักคะแนน">{penaltyFilterLabels[filters.penalty]}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {(Object.keys(penaltyFilterLabels) as (keyof typeof penaltyFilterLabels)[]).map((k) => (
              <SelectItem key={k} value={k}>{penaltyFilterLabels[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      <div className="flex flex-col gap-1">
        <span className={FILTER_FIELD_LABEL_CLASS}>&nbsp;</span>
        <button
          onClick={() => setFilters({ penalty: filters.penalty === "overdue" ? "all" : "overdue" })}
          className={cn(
            filterFieldTriggerClass(filters.penalty === "overdue"),
            "shrink-0",
            filters.penalty === "overdue" && "bg-red-50 border-red-200 text-[var(--chart-red)] [&_svg]:text-[var(--chart-red)]"
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          เลยกำหนดเท่านั้น
        </button>
      </div>

      <div className="ml-auto flex items-end gap-2">
        {isFiltered && (
          <Button variant="ghost" size="sm" className="h-8 px-2 text-[var(--ink-soft)]" onClick={resetFilters} aria-label="ล้างตัวกรอง">
            ✕ ล้างตัวกรอง
          </Button>
        )}
        <Button
          className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
          onClick={() => setNewTaskOpen(true)}
        >
          <Plus className="h-4 w-4" />
          สร้างงานใหม่
        </Button>
      </div>

      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} />
    </div>
  );
}
