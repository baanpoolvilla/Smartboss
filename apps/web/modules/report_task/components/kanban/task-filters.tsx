"use client";

import { Plus, AlertTriangle, Building2, Users, Flag, CircleDot, User as UserIcon, Group, SlidersHorizontal, CalendarDays, Eye, Check, ChevronDown } from "lucide-react";
import { Button } from "@/modules/report_task/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/modules/report_task/components/ui/sheet";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { getDepartment, getUser, isOwner, scopedDepartments, scopedUsers, users } from "@/modules/report_task/lib/directory";
import { taskPriorityOrder, priorityMeta } from "@/modules/report_task/lib/task-meta";
import { datePresetGroups, datePresetLabels } from "@/modules/report_task/lib/date-filter";
import type { TaskPriority } from "@/modules/report_task/types";
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
import { cn } from "@/modules/report_task/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { NewTaskDialog } from "./new-task-dialog";
import { groupByLabels, type GroupBy } from "./kanban-board";

const groupByIcon: Record<GroupBy, typeof CircleDot> = {
  status: CircleDot,
  priority: Flag,
  assignee: UserIcon,
  department: Building2,
};

const defaultFilters = {
  assigneeId: "all",
  assignedById: "all",
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
  resultCount,
}: {
  /** ตัวเลือก "จัดกลุ่มตาม" ของบอร์ด Kanban — ไม่ส่งมา (มุมมองตาราง/ภาระงาน) แล้วช่องนี้จะไม่โชว์เลย */
  groupBy?: GroupBy;
  onGroupByChange?: (g: GroupBy) => void;
  /** จำนวนงานที่ตรงตัวกรองปัจจุบัน — ขึ้นบนปุ่มท้าย bottom sheet ("แสดง N งาน")
   * แทน "ใช้ตัวกรอง" เฉยๆ ไม่ส่งมาก็ยัง fallback เป็นข้อความเดิมได้ */
  resultCount?: number;
}) {
  const filters = useTaskStore((s) => s.filters);
  const setFilters = useTaskStore((s) => s.setFilters);
  const resetFilters = useTaskStore((s) => s.resetFilters);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  // Mobile-only (<640px) — the 5 fields below collapse into this one button,
  // opened as a bottom sheet, instead of the full row (see the render below).
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const isFiltered =
    filters.departmentId !== defaultFilters.departmentId ||
    filters.assigneeId !== defaultFilters.assigneeId ||
    filters.assignedById !== defaultFilters.assignedById ||
    filters.priority !== defaultFilters.priority ||
    filters.penalty !== defaultFilters.penalty ||
    filters.preset !== defaultFilters.preset;

  // Same fields isFiltered already checks, just counted instead of
  // collapsed to a bool — feeds the "ตัวกรอง (N)" badge on the mobile button.
  const activeFilterCount = [
    filters.departmentId !== defaultFilters.departmentId,
    filters.assigneeId !== defaultFilters.assigneeId,
    filters.assignedById !== defaultFilters.assignedById,
    filters.priority !== defaultFilters.priority,
    filters.penalty !== defaultFilters.penalty,
    filters.preset !== defaultFilters.preset,
  ].filter(Boolean).length;

  // One-tap shortcuts in the mobile sheet — each just sets/clears one of the
  // same real filter fields above (no separate state), for the handful of
  // filters used often enough to deserve a tap ahead of opening its own row.
  const quickMineActive = filters.assigneeId === viewingAsUserId;
  // "งานที่กำลังติดตาม" — งานที่ตัวเองเป็นคนมอบหมาย (assignedById) ไม่ใช่คน
  // ทำ (assigneeId) คนละแกนกับ quickMineActive ข้างบน: หัวหน้าอยากติดตามงาน
  // ที่ตัวเองสั่งออกไป ไม่ว่าตอนนี้จะอยู่ในมือใคร
  const quickTrackingActive = filters.assignedById === viewingAsUserId;
  // Desktop's single "มุมมองของฉัน" dropdown — derives its displayed value
  // from the same two fields instead of adding a third piece of state, so it
  // can never drift out of sync with what quickMineActive/quickTrackingActive
  // (or the mobile chips) already show. Falls back to "all" for any other
  // combination (e.g. a specific teammate picked via "พนักงาน") — there's no
  // "mine + tracking" combo to represent since setting one always clears the
  // other (see its onValueChange).
  const personalView: "all" | "mine" | "tracking" =
    quickMineActive && filters.assignedById === "all"
      ? "mine"
      : quickTrackingActive && filters.assigneeId === "all"
        ? "tracking"
        : "all";
  const personalViewLabel = personalView === "mine" ? "งานของฉัน" : personalView === "tracking" ? "งานที่กำลังติดตาม" : "ทั้งหมด";
  // เดิม "งานของฉัน"/"งานที่กำลังติดตาม" โชว์อยู่ในลิสต์ตลอดเวลาใต้หัวข้อ
  // "มุมมองของฉัน" — ส่วนใหญ่คนที่ใช้ (หัวหน้า) สนใจแค่นี้จริง ๆ ("อยากให้ดู
  // ง่ายๆ งานที่เค้าเร่งติดตามแค่นั้นละ") ตัวเลือก 4 อันของ "จัดกลุ่มตาม" ที่
  // ใช้บ่อยกว่าเลยถูกกลบด้วยของที่ใช้เฉพาะกลุ่ม — ซ่อนไว้ก่อน ต้องกด "มุมมอง
  // ของฉัน" เองถึงจะกางออกมาเห็น 3 ตัวเลือก ("ต้องเลือกมุมมองของฉันก่อนนะ")
  // ปิดกลับทุกครั้งที่ดรอปดาวน์ปิด ไม่ค้างไว้ข้ามรอบเปิด
  const [personalViewOpen, setPersonalViewOpen] = useState(false);
  const quickTodayActive = filters.preset === "today";
  const quickOverdueActive = filters.penalty === "overdue";
  const quickCriticalActive = filters.priority === "critical";

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
  //
  // scopedDepartments/scopedUsers/isOwner read `users`/`departments`
  // (lib/directory.ts) through a plain JS Proxy over the Zustand stores, not
  // a reactive selector — React has no way to know that data changed, so a
  // useMemo keyed on `[viewingAsUserId]` alone caches whatever the FIRST
  // render saw and never recomputes once the real employee/department list
  // arrives async right after mount (see report-task-scaffold.tsx: the
  // viewer starts out with just a placeholder record, empty departmentId,
  // before ServerStoreSync fills in the real one). That's why this used to
  // read "ไม่มีแผนก / ตัวเอง" until navigating away and back forced a fresh
  // mount. Subscribing to both stores here (even though their values aren't
  // read directly below — the directory helpers read them internally) gives
  // React a real reason to re-run this memo the moment the data lands.
  const employeesForFilters = useEmployeeStore((s) => s.employees);
  const departmentsForFilters = useDepartmentStore((s) => s.departments);
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
    // employeesForFilters/departmentsForFilters aren't read directly in this
    // body — they're read internally by scopedDepartments/scopedUsers/
    // isOwner via the module-level `users`/`departments` proxy (see the
    // comment above). The lint rule can't see through that, but the deps are
    // real: dropping them reintroduces the "ไม่มีแผนก/ตัวเอง" staleness bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingAsUserId, employeesForFilters, departmentsForFilters]);

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
  // "ของฉัน" pinned right under "ทุกคน" — เดิมต้องไล่หาชื่อตัวเองในลิสต์ยาวๆ
  // ("อยากให้ชื่อเราเป็นคำว่าของฉันอยู่แถวรองจากทุกคน") ตัดตัวเองออกจากลิสต์
  // เต็มด้านล่างไปด้วย ไม่งั้นจะเห็นชื่อตัวเองซ้ำสองที่ (ของฉัน + ชื่อจริงในลิสต์)
  const viewerInScope = peopleInScope.some((u) => u.id === viewingAsUserId);
  const restOfScope = viewerInScope ? peopleInScope.filter((u) => u.id !== viewingAsUserId) : peopleInScope;

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

  // The 5 fields + "เลยกำหนดเท่านั้น" toggle — rendered once for the normal
  // desktop/tablet row (≥640px) and again, stacked, inside the mobile bottom
  // sheet (<640px, see the return below). Same fields, same state, just two
  // different containers around them — kept as one JSX value instead of two
  // copies so the two layouts can never drift out of sync with each other.
  const fieldsNode = (
    <>
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
              {viewerInScope && <SelectItem value={viewingAsUserId}>ของฉัน</SelectItem>}
              {restOfScope.map((u) => (
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

      {groupBy && onGroupByChange ? (
        // "งานของฉัน"/"งานที่กำลังติดตาม" ยุบมารวมอยู่ในดรอปดาวน์เดียวกับ
        // "จัดกลุ่มตาม" เลย ("อยู่ในนี้ไม่ได้หรอ" — เดิมแยกเป็นดรอปดาวน์ของ
        // ตัวเองต่างหาก) คนละแกนกันจริง (จัดกลุ่มตามเปลี่ยนรูปแบบคอลัมน์ของ
        // บอร์ด ส่วนมุมมองของฉันกรองว่าจะเห็นงานไหน) แต่ Select ตัวเดียวแสดง
        // ค่าที่ "เลือกอยู่จริง" ได้แค่ทีละหนึ่ง — ให้ groupBy ยังเป็นค่าที่ผูก
        // กับปุ่ม (checkmark ของ Radix ยังทำงานถูกต้องกับ 4 ตัวเลือกจัดกลุ่ม
        // ตามเดิมทุกอย่าง) ส่วน 2 แถว "มุมมองของฉัน" ท้ายลิสต์มีเครื่องหมายถูก
        // ของตัวเอง (คุมด้วย personalView โดยตรง ไม่พึ่ง Radix) และป้ายบนปุ่ม
        // ต่อท้ายด้วยชื่อมุมมองถ้าเปิดอยู่ ให้เห็นสถานะทั้งสองอย่างพร้อมกันได้
        <FilterField label="จัดกลุ่มตาม">
          <Select
            value={groupBy}
            onOpenChange={(isOpen: boolean) => {
              if (!isOpen) setPersonalViewOpen(false);
            }}
            onValueChange={(v: string | null) => {
              if (!v) return;
              if (v === "mine") setFilters({ assigneeId: viewingAsUserId, assignedById: "all" });
              else if (v === "tracking") setFilters({ assignedById: viewingAsUserId, assigneeId: "all" });
              else if (v === "view-all") setFilters({ assigneeId: "all", assignedById: "all" });
              else onGroupByChange(v as GroupBy);
            }}
          >
            {/* "สถานะ" is the resting default (matches the board's own
                columns) — picking anything else counts as an active choice,
                same as every other field here, so it should highlight the
                same way. Hardcoded `false` before meant this one never lit
                up green no matter what was picked ("เลือกแล้วทำไมไม่เขียว"). */}
            <SelectTrigger className={filterFieldTriggerClass(groupBy !== "status" || personalView !== "all", "min-w-[170px]")}>
              <Group className="h-4 w-4 shrink-0" />
              <SelectValue placeholder="จัดกลุ่มตาม">
                {groupByLabels[groupBy]}
                {personalView !== "all" ? ` · ${personalViewLabel}` : ""}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectLabel>จัดกลุ่มตาม</SelectLabel>
                {(["status", "priority", "assignee", "department"] as GroupBy[]).map((g) => {
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
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                {/* ปุ่มธรรมดา ไม่ใช่ SelectItem — กดแล้วแค่กาง/หุบตัวเลือกข้าง
                    ล่าง ไม่ได้ "เลือกค่า" ที่ทำให้ดรอปดาวน์ปิดตัวเองแบบ
                    SelectItem ปกติ (Radix/base-ui ปิด popover เฉพาะตอนเลือก
                    Item จริง ๆ เท่านั้น ปุ่มเปล่านี้เลยกดได้เรื่อย ๆ โดย
                    ดรอปดาวน์ยังเปิดค้างอยู่) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setPersonalViewOpen((v) => !v);
                  }}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                >
                  <Eye className="h-3 w-3 shrink-0" />
                  <span className="flex-1 text-left">มุมมองของฉัน</span>
                  {personalView !== "all" && (
                    <span className="text-[var(--brand-green-dark)] font-medium">{personalViewLabel}</span>
                  )}
                  <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", personalViewOpen && "rotate-180")} />
                </button>
                {personalViewOpen &&
                  (
                    [
                      { v: "view-all", key: "all", label: "ทั้งหมด" },
                      { v: "mine", key: "mine", label: "งานของฉัน" },
                      { v: "tracking", key: "tracking", label: "งานที่กำลังติดตาม" },
                    ] as const
                  ).map((opt) => (
                    <SelectItem key={opt.v} value={opt.v} className="pl-6">
                      <span className="flex items-center gap-1.5">
                        {opt.label}
                        {personalView === opt.key && <Check className="h-3.5 w-3.5 text-[var(--brand-green-dark)] ml-auto" />}
                      </span>
                    </SelectItem>
                  ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </FilterField>
      ) : (
        // ไม่มี "จัดกลุ่มตาม" ให้รวมด้วย (มุมมองตาราง/ภาระงาน) — คงดรอปดาวน์
        // แยกไว้ ไม่งั้นมุมมองของฉันจะหายไปจากหน้าพวกนี้เลย
        <FilterField label="มุมมองของฉัน">
          <Select
            value={personalView}
            onValueChange={(v) => {
              if (!v) return;
              if (v === "mine") setFilters({ assigneeId: viewingAsUserId, assignedById: "all" });
              else if (v === "tracking") setFilters({ assignedById: viewingAsUserId, assigneeId: "all" });
              else setFilters({ assigneeId: "all", assignedById: "all" });
            }}
          >
            <SelectTrigger className={filterFieldTriggerClass(personalView !== "all", "min-w-[150px]")}>
              <Eye className="h-4 w-4 shrink-0" />
              <SelectValue placeholder="มุมมองของฉัน">{personalViewLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value="all">ทั้งหมด</SelectItem>
              <SelectItem value="mine">งานของฉัน</SelectItem>
              <SelectItem value="tracking">งานที่กำลังติดตาม</SelectItem>
            </SelectContent>
          </Select>
        </FilterField>
      )}

      <div className="flex flex-col gap-1">
        <span className={FILTER_FIELD_LABEL_CLASS}>&nbsp;</span>
        <button
          // เดิมมีปุ่ม "งานของฉัน"/"กำลังติดตาม" แยกอยู่ตรงนี้ด้วย ซ้ำกับ
          // dropdown "พนักงาน"/"มอบหมายโดย" ข้างบนที่ปักหมุด "ของฉัน" ไว้ให้
          // อยู่แล้ว — สองปุ่มควบคุมค่าเดียวกันทำให้ดูรกและงงว่าต้องกดอันไหน
          // ("ทำให้มันใช้งานง่ายสิ") ตัด toggle ซ้ำออก เหลือ dropdown เป็นทาง
          // เดียวบนเดสก์ท็อป (มือถือยังมีชิปด่วนแยกอยู่ในหน้า bottom sheet —
          // ไม่ซ้ำเพราะ field เต็มอยู่คนละจุด ต้องเลื่อนลงไปอีกทีถึงจะเจอ)
          // Clears quickView (the KPI chip row above) — the two used to AND
          // together, which could filter down to an impossible intersection
          // (e.g. "in-progress AND overdue") and show zero results even with
          // plenty of overdue tasks elsewhere. Picking this one now replaces
          // whichever chip was active, instead of narrowing on top of it.
          onClick={() => setFilters({ penalty: filters.penalty === "overdue" ? "all" : "overdue", quickView: "all" })}
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
    </>
  );

  // Mobile bottom-sheet version of the same 5 fields — one full-width row
  // each (icon box + label + value, trigger's own chevron on the far right)
  // instead of the desktop row's fixed-width pills stacked awkwardly. Kept
  // as its own block rather than reused inside `fieldsNode` since the shape
  // (row vs. label-above-pill) differs, not just sizing.
  const mobileFieldsNode = (
    <>
      {availableDepartments.length > 1 ? (
        <Select value={filters.departmentId} onValueChange={(v) => v && setFilters({ departmentId: v })}>
          <SelectTrigger className={mobileFieldRowTriggerClass(filters.departmentId !== "all")}>
            <MobileFieldIcon icon={Building2} active={filters.departmentId !== "all"} />
            <span className="text-[13.5px] font-medium text-[var(--ink)]">แผนก</span>
            <MobileFieldValue active={filters.departmentId !== "all"}>
              {filters.departmentId === "all" ? "ทุกแผนก" : (getDepartment(filters.departmentId)?.name ?? "แผนก")}
            </MobileFieldValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectItem value="all">ทั้งบริษัท</SelectItem>
            {availableDepartments.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className={cn(mobileFieldRowTriggerClass(false), "cursor-default")}>
          <MobileFieldIcon icon={Building2} active={false} />
          <span className="text-[13.5px] font-medium text-[var(--ink)]">แผนก</span>
          <MobileFieldValue active={false}>{availableDepartments[0]?.name ?? "ไม่มีแผนก"}</MobileFieldValue>
        </div>
      )}

      {peopleInScope.length > 1 ? (
        <Select value={filters.assigneeId} onValueChange={(v) => v && setFilters({ assigneeId: v })}>
          <SelectTrigger className={mobileFieldRowTriggerClass(filters.assigneeId !== "all")}>
            <MobileFieldIcon icon={Users} active={filters.assigneeId !== "all"} />
            <span className="text-[13.5px] font-medium text-[var(--ink)]">ผู้รับผิดชอบ</span>
            <MobileFieldValue active={filters.assigneeId !== "all"}>
              {filters.assigneeId === "all" ? "ทุกคน" : (getUser(filters.assigneeId)?.name ?? "ผู้รับผิดชอบ")}
            </MobileFieldValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectItem value="all">ทุกคน</SelectItem>
            {viewerInScope && <SelectItem value={viewingAsUserId}>ของฉัน</SelectItem>}
            {restOfScope.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className={cn(mobileFieldRowTriggerClass(false), "cursor-default")}>
          <MobileFieldIcon icon={Users} active={false} />
          <span className="text-[13.5px] font-medium text-[var(--ink)]">ผู้รับผิดชอบ</span>
          <MobileFieldValue active={false}>
            {peopleInScope[0]?.id === viewingAsUserId ? "ตัวเอง" : (peopleInScope[0]?.name ?? "ไม่มีผู้รับผิดชอบ")}
          </MobileFieldValue>
        </div>
      )}

      <Select value={filters.preset} onValueChange={(v) => v && setFilters({ preset: v as typeof filters.preset })}>
        <SelectTrigger className={mobileFieldRowTriggerClass(filters.preset !== "all")}>
          <MobileFieldIcon icon={CalendarDays} active={filters.preset !== "all"} />
          <span className="text-[13.5px] font-medium text-[var(--ink)]">ช่วงเวลา</span>
          <MobileFieldValue active={filters.preset !== "all"}>{datePresetLabels[filters.preset]}</MobileFieldValue>
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
      {filters.preset === "custom" && (
        <div className="flex items-center gap-2 px-0.5">
          <DatePickerField value={filters.customFrom} onChange={(v) => setFilters({ customFrom: v })} className="h-11 flex-1" />
          <span className="text-[var(--ink-soft)] text-sm">ถึง</span>
          <DatePickerField value={filters.customTo} onChange={(v) => setFilters({ customTo: v })} minDate={filters.customFrom} className="h-11 flex-1" />
        </div>
      )}

      <Select value={filters.priority} onValueChange={(v) => v && setFilters({ priority: v as typeof filters.priority })}>
        <SelectTrigger className={mobileFieldRowTriggerClass(filters.priority !== "all")}>
          <MobileFieldIcon icon={Flag} active={filters.priority !== "all"} />
          <span className="text-[13.5px] font-medium text-[var(--ink)]">ความสำคัญ</span>
          <MobileFieldValue active={filters.priority !== "all"}>
            {filters.priority === "all" ? "ทุกความสำคัญ" : (priorityMeta[filters.priority as TaskPriority]?.label ?? "ความสำคัญ")}
          </MobileFieldValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="all">ทุกความสำคัญ</SelectItem>
          {taskPriorityOrder.map((p) => (
            <SelectItem key={p} value={p}>{priorityMeta[p].label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {groupBy && onGroupByChange && (
        <Select value={groupBy} onValueChange={(v) => v && onGroupByChange(v as GroupBy)}>
          <SelectTrigger className={mobileFieldRowTriggerClass(groupBy !== "status")}>
            <MobileFieldIcon icon={Group} active={groupBy !== "status"} />
            <span className="text-[13.5px] font-medium text-[var(--ink)]">จัดกลุ่มตาม</span>
            <MobileFieldValue active={groupBy !== "status"}>{groupByLabels[groupBy]}</MobileFieldValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {(["status", "priority", "assignee", "department"] as GroupBy[]).map((g) => {
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
      )}

      {/* Plain toggle, not a dropdown — same as the desktop pill (there's
          only ever "on" or "off", nothing to actually pick between), tap
          switches it directly instead of opening a 2-item list to choose
          from. */}
      <button
        type="button"
        onClick={() => setFilters({ penalty: filters.penalty === "overdue" ? "all" : "overdue", quickView: "all" })}
        className={mobileFieldRowTriggerClass(filters.penalty === "overdue")}
      >
        <MobileFieldIcon icon={AlertTriangle} active={filters.penalty === "overdue"} />
        <span className="text-[13.5px] font-medium text-[var(--ink)]">เลยกำหนดเท่านั้น</span>
        <span
          className={cn(
            "ml-auto flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
            filters.penalty === "overdue" ? "bg-[var(--brand-green-dark)]" : "bg-[var(--line)]"
          )}
        >
          <span
            className={cn(
              "h-4 w-4 rounded-full bg-white shadow transition-transform",
              filters.penalty === "overdue" && "translate-x-4"
            )}
          />
        </span>
      </button>
    </>
  );

  return (
    <>
      {/* ≥640px: full row, unchanged from before. */}
      <div className="hidden sm:flex flex-wrap items-end gap-2">
        {fieldsNode}
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
      </div>

      {/* <640px: the 5 fields collapse into one button that opens a bottom
          sheet, freeing up vertical space so the header doesn't eat most of
          a phone screen before a single task card is visible. */}
      <div className="flex sm:hidden items-center gap-2">
        {/* Same green circular count badge as the Dashboard's full-width
            filter button (that one has no second control to share the row
            with, so it can go full-width — this one still shares the row
            with "สร้างงานใหม่", just restyled to read as the same family). */}
        <button
          type="button"
          onClick={() => setMobileSheetOpen(true)}
          className={cn(
            "flex h-[42px] items-center gap-2 rounded-2xl border px-3.5 text-sm font-medium transition-colors",
            activeFilterCount > 0
              ? "border-[var(--brand-green-dark)]/30 bg-[color-mix(in_srgb,var(--brand-green)_22%,white)] text-[var(--ink)]"
              : "border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--bg-soft)]"
          )}
        >
          <SlidersHorizontal className={cn("h-4 w-4 shrink-0", activeFilterCount > 0 ? "text-[var(--brand-green-dark)]" : "text-[var(--ink-soft)]")} />
          ตัวกรอง
          {activeFilterCount > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--brand-green-dark)] px-1 text-[10.5px] font-semibold text-white tabular-nums">
              {activeFilterCount}
            </span>
          )}
        </button>
        <Button
          className="ml-auto h-[42px] rounded-2xl bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
          onClick={() => setNewTaskOpen(true)}
        >
          <Plus className="h-4 w-4" />
          สร้างงานใหม่
        </Button>
      </div>

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
                onClick={resetFilters}
                className="text-sm font-medium text-[var(--brand-green-dark)] underline-offset-2 hover:underline"
              >
                ล้างตัวกรอง
              </button>
            )}
          </SheetHeader>
          <div className="px-4">
            <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">ตัวกรองด่วน</p>
            <div className="flex gap-2.5 overflow-x-auto pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <QuickFilterChip icon={UserIcon} label="งานของฉัน" active={quickMineActive} onClick={() => setFilters({ assigneeId: quickMineActive ? "all" : viewingAsUserId })} />
              <QuickFilterChip icon={Eye} label="กำลังติดตาม" active={quickTrackingActive} onClick={() => setFilters({ assignedById: quickTrackingActive ? "all" : viewingAsUserId })} />
              <QuickFilterChip icon={CalendarDays} label="วันนี้" active={quickTodayActive} onClick={() => setFilters({ preset: quickTodayActive ? "all" : "today" })} />
              <QuickFilterChip icon={AlertTriangle} label="เลยกำหนด" warn active={quickOverdueActive} onClick={() => setFilters({ penalty: quickOverdueActive ? "all" : "overdue" })} />
              <QuickFilterChip icon={Flag} label="ด่วนมาก" active={quickCriticalActive} onClick={() => setFilters({ priority: quickCriticalActive ? "all" : "critical" })} />
            </div>
          </div>

          <div className="flex flex-col gap-2 px-4 pt-4">{mobileFieldsNode}</div>
          <SheetFooter>
            <Button
              className="h-[46px] w-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
              onClick={() => setMobileSheetOpen(false)}
            >
              {resultCount === undefined ? "ใช้ตัวกรอง" : `แสดง ${resultCount} งาน`}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} allowedTypes={["task"]} />
    </>
  );
}
