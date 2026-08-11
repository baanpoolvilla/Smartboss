"use client";

import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import { getUser, getDepartment, canManage } from "@/modules/report_task/data/mock";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { FilterField, FILTER_FIELD_LABEL_CLASS, filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { DateRangeSelectField } from "@/modules/report_task/components/shared/date-range-select-field";
import { Building2, Users } from "lucide-react";

/**
 * §7.2 — filter order is department → person → time, matching the
 * inverted-pyramid ordering used everywhere else on the Dashboard (widest
 * scope first). Department is never cleared when a person is picked (the
 * old code did that, which broke the hierarchy) — the two combine instead:
 * a department + "ทุกคนในแผนก..." reads as "everyone in that department."
 */
export function DashboardFilters() {
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  const setPersonId = useDashboardFilterStore((s) => s.setPersonId);
  const setDepartmentId = useDashboardFilterStore((s) => s.setDepartmentId);
  const setPreset = useDashboardFilterStore((s) => s.setPreset);
  const setCustomRange = useDashboardFilterStore((s) => s.setCustomRange);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  // Org-wide performance data (everyone's tasks/scores) is manager-eyes-only,
  // especially now the score ties to real bonuses — a regular employee can
  // only ever look at their own dashboard, not switch to "everyone" or a
  // specific coworker.
  const canPickPerson = canManage(viewingAsUserId);

  // Only offer people/departments that actually show up in tasks this viewer
  // can see (canSeeTask, via useVisibleTasks) — a department head's pickers
  // are their own department, not the whole company.
  const visibleTasks = useVisibleTasks();
  const pickablePeople = useMemo(() => {
    const ids = new Set(visibleTasks.flatMap((t) => t.assigneeIds));
    return [...ids].map((id) => getUser(id)).filter((u): u is NonNullable<typeof u> => !!u);
  }, [visibleTasks]);
  const availableDepartments = useMemo(() => {
    const ids = new Set(visibleTasks.flatMap((t) => t.departmentIds));
    return [...ids].map((id) => getDepartment(id)).filter((d): d is NonNullable<typeof d> => !!d);
  }, [visibleTasks]);

  // §7.2 — once a department is picked, the person list narrows to just that
  // department's people, and the "everyone" option's label says how many.
  const peopleInScope = useMemo(
    () => (departmentId === "all" ? pickablePeople : pickablePeople.filter((u) => u.departmentId === departmentId)),
    [pickablePeople, departmentId]
  );
  const allInDeptLabel =
    departmentId === "all" ? "ทุกคน" : `ทุกคนในแผนก${getDepartment(departmentId)?.name ?? ""} (${peopleInScope.length} คน)`;

  // The store is global and outlives the identity switcher, so whatever was
  // last picked (a specific coworker, "all") would otherwise carry over to
  // the next identity untouched — a manager seeing a stale "all" is harmless,
  // but a non-head seeing a stale "all"/coworker would leak org-wide data.
  const lastIdentity = useRef(viewingAsUserId);
  useEffect(() => {
    if (lastIdentity.current !== viewingAsUserId) {
      lastIdentity.current = viewingAsUserId;
      setPersonId(canPickPerson ? "all" : viewingAsUserId);
      setDepartmentId("all");
    }
  }, [viewingAsUserId, canPickPerson, setPersonId, setDepartmentId]);

  // §7.2 — switching department while a specific person is selected: if that
  // person isn't in the newly-picked department, fall back to "everyone in
  // this department" instead of silently keeping a now-mismatched person.
  // Department itself is never cleared here — only this effect's job.
  useEffect(() => {
    if (departmentId === "all" || personId === "all") return;
    if (getUser(personId)?.departmentId !== departmentId) setPersonId("all");
  }, [departmentId, personId, setPersonId]);

  const deptActive = departmentId !== "all";
  const personActive = personId !== "all";
  const presetActive = preset !== "all";
  const isFiltered = (canPickPerson && (deptActive || personActive)) || presetActive;
  const clearFilters = () => {
    if (canPickPerson) {
      setPersonId("all");
      setDepartmentId("all");
    }
    setPreset("all");
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      {canPickPerson && (
        <>
          <FilterField label="แผนก">
            <Select value={departmentId} onValueChange={(v) => v && setDepartmentId(v)}>
              <SelectTrigger className={filterFieldTriggerClass(deptActive, "min-w-[130px]")}>
                <Building2 className="h-4 w-4 shrink-0" />
                <SelectValue placeholder="แผนก">
                  {departmentId === "all" ? "ทุกแผนก" : (getDepartment(departmentId)?.name ?? "แผนก")}
                </SelectValue>
              </SelectTrigger>
              {/* alignItemWithTrigger off — that mode floats the selected
                  row exactly over the trigger using the trigger's position
                  *at open time*; this bar's height changes (the "ปรับแต่ง"
                  button, active-filter chips) shift the trigger afterward
                  without the floated clone following, leaving it stuck
                  overlapping whatever's now above it. Plain bottom-anchored
                  positioning re-measures every time instead. */}
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="all">ทุกแผนก</SelectItem>
                {availableDepartments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="พนักงาน">
            <Select value={personId} onValueChange={(v) => v && setPersonId(v)}>
              <SelectTrigger className={filterFieldTriggerClass(personActive, "min-w-[150px]")}>
                <Users className="h-4 w-4 shrink-0" />
                <SelectValue placeholder="ดูข้อมูลของ">
                  {personId === "all" ? allInDeptLabel : (getUser(personId)?.name ?? "ดูข้อมูลของ")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="all">{allInDeptLabel}</SelectItem>
                {peopleInScope.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        </>
      )}
      {!canPickPerson && (
        <div className="flex flex-col gap-1">
          <span className={FILTER_FIELD_LABEL_CLASS}>พนักงาน</span>
          <div
            className={filterFieldTriggerClass(false, "min-w-[130px] cursor-default")}
            title="แดชบอร์ดของพนักงานแสดงข้อมูลของตัวเองเท่านั้น"
          >
            <Users className="h-4 w-4 shrink-0" />
            <span>{getUser(viewingAsUserId)?.name}</span>
          </div>
        </div>
      )}

      <DateRangeSelectField
        preset={preset}
        customFrom={customFrom}
        customTo={customTo}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
      />

      {isFiltered && (
        <Button variant="ghost" size="sm" className="ml-auto h-8 px-2 text-[var(--ink-soft)]" onClick={clearFilters} aria-label="ล้างตัวกรอง">
          ✕ ล้างตัวกรอง
        </Button>
      )}
    </div>
  );
}
