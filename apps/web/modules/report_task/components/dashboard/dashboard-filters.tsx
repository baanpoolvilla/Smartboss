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
import { getUser, getDepartment, canManage, scopedDepartments, scopedUsers } from "@/modules/report_task/lib/directory";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { FilterField, FILTER_FIELD_LABEL_CLASS, filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { DateRangeSelectField } from "@/modules/report_task/components/shared/date-range-select-field";
import { Building2, Users, X } from "lucide-react";

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

  // Offer every real person/department the viewer has rights to, not just
  // whoever already happens to have a task — a freshly-added department with
  // no tasks yet still needs to show its people so a head can start
  // assigning to them. Owner sees the whole company; a department head sees
  // only the department(s) they head (report_task's own headId, separate
  // from core's DepartmentHead — see Phase 0.2 decision in
  // PLAN_role_only_department_heads_2.md, report_task stays on its own
  // identity system for now) — everyone else never reaches this branch at
  // all (gated by canPickPerson below).
  const availableDepartments = useMemo(() => scopedDepartments(viewingAsUserId), [viewingAsUserId]);
  const pickablePeople = useMemo(() => scopedUsers(viewingAsUserId), [viewingAsUserId]);

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
                {/* max-w + truncate — SelectTrigger sizes to its content
                    (w-fit) with no width cap of its own, so a long
                    department name would otherwise stretch the whole pill
                    wide instead of clipping with "…". */}
                <SelectValue placeholder="แผนก" className="max-w-[140px] truncate">
                  {departmentId === "all" ? "ทั้งบริษัท" : (getDepartment(departmentId)?.name ?? "แผนก")}
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
                <SelectItem value="all">ทั้งบริษัท</SelectItem>
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
                {/* max-w + truncate — allInDeptLabel ("ทุกคนในแผนก...(N คน)")
                    can run long once a department has a real name + count,
                    and SelectTrigger's own w-fit sizing has no cap that
                    would otherwise clip it. */}
                <SelectValue placeholder="ดูข้อมูลของ" className="max-w-[160px] truncate">
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
            <span className="max-w-[160px] truncate">{getUser(viewingAsUserId)?.name}</span>
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
        <Button variant="ghost" size="sm" className="ml-auto h-8 px-2 gap-1 text-[var(--ink-soft)]" onClick={clearFilters} aria-label="ล้างตัวกรอง">
          <X className="h-3.5 w-3.5" /> ล้างตัวกรอง
        </Button>
      )}
    </div>
  );
}
