"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/modules/report_task/components/ui/sheet";
import { SelectGroup, SelectLabel, SelectSeparator } from "@/modules/report_task/components/ui/select";
import { getUser, getDepartment, canManage, scopedDepartments, scopedUsers } from "@/modules/report_task/lib/directory";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import {
  FilterField,
  FILTER_FIELD_LABEL_CLASS,
  filterFieldTriggerClass,
  mobileFieldRowTriggerClass,
  MobileFieldIcon,
  MobileFieldValue,
  QuickFilterChip,
} from "@/modules/report_task/components/shared/filter-field";
import { DateRangeSelectField } from "@/modules/report_task/components/shared/date-range-select-field";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { datePresetGroups, datePresetLabels } from "@/modules/report_task/lib/date-filter";
import { cn } from "@/modules/report_task/lib/utils";
import { Building2, Users, User as UserIcon, CalendarDays, SlidersHorizontal, ChevronRight, X } from "lucide-react";

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
  // canManage/scopedDepartments/scopedUsers all read `users`/`departments`
  // (lib/directory.ts) through a plain JS Proxy over these two stores, not a
  // reactive selector — subscribing here is what actually makes this
  // component re-render (and canManage/the memos below recompute) once the
  // real employee/department list lands async right after mount, instead of
  // being stuck on whatever the placeholder-record first render saw (same
  // fix as task-filters.tsx's own copy of this exact bug).
  const employeesForFilters = useEmployeeStore((s) => s.employees);
  const departmentsForFilters = useDepartmentStore((s) => s.departments);
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
  // employeesForFilters/departmentsForFilters aren't read directly in either
  // body — they're read internally by scopedDepartments/scopedUsers via the
  // module-level `users`/`departments` proxy (see the comment above). The
  // lint rule can't see through that, but the deps are real: dropping them
  // reintroduces the department-filter staleness bug.
  const availableDepartments = useMemo(
    () => scopedDepartments(viewingAsUserId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewingAsUserId, employeesForFilters, departmentsForFilters]
  );
  const pickablePeople = useMemo(
    () => scopedUsers(viewingAsUserId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewingAsUserId, employeesForFilters, departmentsForFilters]
  );

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
  const activeFilterCount = [canPickPerson && deptActive, canPickPerson && personActive, presetActive].filter(Boolean).length;

  // One-tap shortcuts in the mobile sheet — same real fields as the rows
  // below, just the two most common picks ahead of opening a whole dropdown.
  const quickMineActive = canPickPerson && personId === viewingAsUserId;
  const quickTodayActive = preset === "today";
  const clearFilters = () => {
    if (canPickPerson) {
      setPersonId("all");
      setDepartmentId("all");
    }
    setPreset("all");
  };

  // <640px only — the 3 fields collapse into one button that opens a bottom
  // sheet (same pattern as the Kanban board's TaskFilters), instead of the
  // desktop row's pills wrapping awkwardly onto their own uneven lines.
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  return (
    <>
    <div className="hidden sm:flex flex-wrap items-end gap-2">
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

    {/* Full-width, not just the small pill the desktop bar uses — a lone
        small button here left a big empty strip of nothing next to it
        (Dashboard has no second action like the Task Board's "สร้างงานใหม่"
        to share the row with). Filling the row itself, with its own count
        badge + trailing chevron, reads as a real entry point instead of
        stranded next to dead space. */}
    <button
      type="button"
      onClick={() => setMobileSheetOpen(true)}
      className={cn(
        "flex sm:hidden w-full items-center gap-2.5 rounded-2xl border px-4 h-12 text-left transition-colors",
        activeFilterCount > 0
          ? "border-[var(--brand-green-dark)]/30 bg-[color-mix(in_srgb,var(--brand-green)_14%,white)]"
          : "border-[var(--line)] bg-white hover:bg-[var(--bg-soft)]"
      )}
    >
      <SlidersHorizontal className={cn("h-4 w-4 shrink-0", activeFilterCount > 0 ? "text-[var(--brand-green-dark)]" : "text-[var(--ink-soft)]")} />
      <span className="text-sm font-medium text-[var(--ink)]">ตัวกรอง</span>
      {activeFilterCount > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--brand-green-dark)] px-1.5 text-[11px] font-semibold text-white tabular-nums">
          {activeFilterCount}
        </span>
      )}
      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-[var(--ink-faint)]" />
    </button>

    <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        {/* pr-11 — clears the Sheet's own absolute close button (top-3
            right-3, size-7), which otherwise sits right on top of
            "ล้างตัวกรอง" since both are right-aligned in this row. */}
        <SheetHeader className="flex-row items-center justify-between gap-2 pb-2 pr-11">
          <SheetTitle>ตัวกรอง</SheetTitle>
          {isFiltered && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm font-medium text-[var(--brand-green-dark)] underline-offset-2 hover:underline"
            >
              ล้างตัวกรอง
            </button>
          )}
        </SheetHeader>

        {canPickPerson && (
          <div className="px-4">
            <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">ตัวกรองด่วน</p>
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <QuickFilterChip icon={UserIcon} label="ของฉัน" active={quickMineActive} onClick={() => setPersonId(quickMineActive ? "all" : viewingAsUserId)} />
              <QuickFilterChip icon={CalendarDays} label="วันนี้" active={quickTodayActive} onClick={() => setPreset(quickTodayActive ? "all" : "today")} />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 px-4 pt-4">
          {canPickPerson ? (
            <>
              <Select value={departmentId} onValueChange={(v) => v && setDepartmentId(v)}>
                <SelectTrigger className={mobileFieldRowTriggerClass(deptActive)}>
                  <MobileFieldIcon icon={Building2} active={deptActive} />
                  <span className="text-[13.5px] font-medium text-[var(--ink)]">แผนก</span>
                  <MobileFieldValue active={deptActive}>
                    {departmentId === "all" ? "ทั้งบริษัท" : (getDepartment(departmentId)?.name ?? "แผนก")}
                  </MobileFieldValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectItem value="all">ทั้งบริษัท</SelectItem>
                  {availableDepartments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={personId} onValueChange={(v) => v && setPersonId(v)}>
                <SelectTrigger className={mobileFieldRowTriggerClass(personActive)}>
                  <MobileFieldIcon icon={Users} active={personActive} />
                  <span className="text-[13.5px] font-medium text-[var(--ink)]">พนักงาน</span>
                  <MobileFieldValue active={personActive}>
                    {personId === "all" ? allInDeptLabel : (getUser(personId)?.name ?? "ดูข้อมูลของ")}
                  </MobileFieldValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectItem value="all">{allInDeptLabel}</SelectItem>
                  {peopleInScope.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : (
            <div className={cn(mobileFieldRowTriggerClass(false), "cursor-default")}>
              <MobileFieldIcon icon={Users} active={false} />
              <span className="text-[13.5px] font-medium text-[var(--ink)]">พนักงาน</span>
              <MobileFieldValue active={false}>{getUser(viewingAsUserId)?.name}</MobileFieldValue>
            </div>
          )}

          <Select value={preset} onValueChange={(v) => v && setPreset(v as typeof preset)}>
            <SelectTrigger className={mobileFieldRowTriggerClass(presetActive)}>
              <MobileFieldIcon icon={CalendarDays} active={presetActive} />
              <span className="text-[13.5px] font-medium text-[var(--ink)]">ช่วงเวลา</span>
              <MobileFieldValue active={presetActive}>{datePresetLabels[preset]}</MobileFieldValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {datePresetGroups.map((group, i) => (
                <SelectGroup key={i}>
                  {group.label && <SelectLabel>{group.label}</SelectLabel>}
                  {group.presets.map((p) => (
                    <SelectItem key={p} value={p}>{datePresetLabels[p]}</SelectItem>
                  ))}
                  {i < datePresetGroups.length - 1 && <SelectSeparator />}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {preset === "custom" && (
            <div className="flex items-center gap-2 px-0.5">
              <DatePickerField value={customFrom} onChange={(v) => setCustomRange(v, customTo)} className="h-11 flex-1" />
              <span className="text-[var(--ink-soft)] text-sm">ถึง</span>
              <DatePickerField value={customTo} onChange={(v) => setCustomRange(customFrom, v)} minDate={customFrom} className="h-11 flex-1" />
            </div>
          )}
        </div>
        <SheetFooter>
          <Button
            className="h-[46px] w-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
            onClick={() => setMobileSheetOpen(false)}
          >
            ใช้ตัวกรอง
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
    </>
  );
}
