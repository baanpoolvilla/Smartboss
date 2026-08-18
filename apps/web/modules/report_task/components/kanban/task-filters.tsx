"use client";

import { Plus, AlertTriangle, Building2, Users, Flag, CircleDot, User as UserIcon, Group } from "lucide-react";
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
import { getDepartment, getUser, isOwner, scopedDepartments, scopedUsers, users } from "@/modules/report_task/lib/directory";
import { taskPriorityOrder, priorityMeta } from "@/modules/report_task/lib/task-meta";
import type { TaskPriority } from "@/modules/report_task/types";
import { FilterField, FILTER_FIELD_LABEL_CLASS, filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { DateRangeSelectField } from "@/modules/report_task/components/shared/date-range-select-field";
import { cn } from "@/modules/report_task/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { NewTaskDialog } from "./new-task-dialog";
import { groupByLabels, type GroupBy } from "./kanban-board";

const groupByIcon: Record<GroupBy, typeof CircleDot> = {
  status: CircleDot,
  priority: Flag,
  assignee: UserIcon,
};

const defaultFilters = {
  assigneeId: "all",
  departmentId: "all",
  priority: "all",
  penalty: "all",
  preset: "all",
  customFrom: "",
  customTo: "",
} as const;

export function TaskFilters({
  groupBy,
  onGroupByChange,
}: {
  /** ตัวเลือก "จัดกลุ่มตาม" ของบอร์ด Kanban — ไม่ส่งมา (มุมมองตาราง/ภาระงาน) แล้วช่องนี้จะไม่โชว์เลย */
  groupBy?: GroupBy;
  onGroupByChange?: (g: GroupBy) => void;
}) {
  const filters = useTaskStore((s) => s.filters);
  const setFilters = useTaskStore((s) => s.setFilters);
  const resetFilters = useTaskStore((s) => s.resetFilters);
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

  // Offer every real department/person the viewer has rights to, not just
  // whoever already happens to have a task assigned — a freshly-added
  // department or hire with zero tasks yet still needs to be pickable so a
  // head can start assigning work to them. Owner sees the whole company; a
  // department head sees only the department(s) they head (report_task's
  // own headId — see lib/directory.ts's scopedDepartments/scopedUsers,
  // shared with dashboard-filters.tsx/workload-view.tsx/activity-log).
  const { availableDepartments, availableAssignees } = useMemo(() => {
    const deptScope = scopedDepartments(viewingAsUserId);
    if (isOwner(viewingAsUserId) || deptScope.length > 0) {
      return { availableDepartments: deptScope, availableAssignees: scopedUsers(viewingAsUserId) };
    }
    // Regular staff (not owner, not a department head) — nothing to pick
    // between, just themselves; renders as the plain-label fallback below.
    const me = users.find((u) => u.id === viewingAsUserId);
    const myDept = me?.departmentId ? getDepartment(me.departmentId) : undefined;
    return {
      availableDepartments: myDept ? [myDept] : [],
      availableAssignees: me ? [me] : [],
    };
  }, [viewingAsUserId]);

  // Once a department is picked, the person list narrows to just that
  // department's people — same "department → person" hierarchy as the
  // Dashboard's filter bar (dashboard-filters.tsx). Without this, picking a
  // department left the assignee dropdown showing everyone (including people
  // outside that department), so a department+person combo that could never
  // match anything silently returned zero tasks instead of narrowing sensibly.
  const peopleInScope = useMemo(
    () =>
      filters.departmentId === "all"
        ? availableAssignees
        : availableAssignees.filter((u) => u.departmentId === filters.departmentId),
    [availableAssignees, filters.departmentId]
  );

  // Switching department while a specific person is selected: if that person
  // isn't in the newly-picked department, fall back to "ทุกคน" instead of
  // silently keeping a now-mismatched assignee filter (same fix as
  // dashboard-filters.tsx's identical effect).
  useEffect(() => {
    if (filters.departmentId === "all" || filters.assigneeId === "all") return;
    if (getUser(filters.assigneeId)?.departmentId !== filters.departmentId) {
      setFilters({ assigneeId: "all" });
    }
  }, [filters.departmentId, filters.assigneeId, setFilters]);

  return (
    <div className="flex flex-wrap items-end gap-2">
      {availableDepartments.length > 1 ? (
        <FilterField label="แผนก">
          <Select value={filters.departmentId} onValueChange={(v) => v && setFilters({ departmentId: v })}>
            <SelectTrigger className={filterFieldTriggerClass(filters.departmentId !== "all", "min-w-[130px]")}>
              <Building2 className="h-4 w-4 shrink-0" />
              <SelectValue placeholder="แผนก">
                {filters.departmentId === "all" ? "ทั้งบริษัท" : (getDepartment(filters.departmentId)?.name ?? "แผนก")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value="all">ทั้งบริษัท</SelectItem>
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

      {peopleInScope.length > 1 ? (
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
              {peopleInScope.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
      ) : (
        <FilterField label="พนักงาน">
          <span className={filterFieldTriggerClass(false, "min-w-[130px] cursor-default")}>
            <Users className="h-4 w-4 shrink-0" />
            {peopleInScope[0]?.id === viewingAsUserId ? "ตัวเอง" : (peopleInScope[0]?.name ?? "ไม่มีผู้รับผิดชอบ")}
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

      {groupBy && onGroupByChange && (
        <FilterField label="จัดกลุ่มตาม">
          <Select value={groupBy} onValueChange={(v) => v && onGroupByChange(v as GroupBy)}>
            <SelectTrigger className={filterFieldTriggerClass(false, "min-w-[150px]")}>
              <Group className="h-4 w-4 shrink-0" />
              <SelectValue placeholder="จัดกลุ่มตาม">{groupByLabels[groupBy]}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {(["status", "priority", "assignee"] as GroupBy[]).map((g) => {
                const Icon = groupByIcon[g];
                return (
                  <SelectItem key={g} value={g}>
                    <span className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-[var(--ink-soft)]" />
                      {groupByLabels[g]}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </FilterField>
      )}

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
