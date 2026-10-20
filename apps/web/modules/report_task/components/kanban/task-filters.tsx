"use client";

import { Plus, AlertTriangle, Building2, Users, Flag, CircleDot, User as UserIcon, Group, SlidersHorizontal, Eye, Check, ChevronDown, X } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { getDepartment, getUser, isOwner, scopedDepartments, scopedUsers, users } from "@/modules/report_task/lib/directory";
import {
  FilterField,
  FILTER_FIELD_LABEL_CLASS,
  filterFieldTriggerClass,
  mobileFieldRowTriggerClass,
  MobileFieldIcon,
  MobileFieldValue,
  QuickFilterChip,
} from "@/modules/report_task/components/shared/filter-field";
import { cn } from "@/modules/report_task/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { NewTaskDialog } from "./new-task-dialog";
import { groupByLabels, type GroupBy } from "./kanban-board";
import { useMaintenanceBoardStore } from "@/modules/report_task/store/maintenance-board-store";
import type { BoardKind } from "@/modules/report_task/lib/maintenance-board";

/** ตัวเลือกจัดกลุ่มบนบอร์ด — "แผนก" ซ่อนไว้ก่อน จะทำเป็นมุมมองโปรเจค/แผนกแยกจากงาน
 * ("เอาแผนกออกก่อน เดี๋ยวงง") โค้ดบอร์ดแผนกใน kanban-board.tsx ยังอยู่ เปิดกลับได้ที่นี่ที่เดียว */
// จัดกลุ่มได้แค่ สถานะ / ความสำคัญ (ผู้ใช้ขอ 18/10/2569 — "คน" เอาออก)
const GROUP_BY_CHOICES: GroupBy[] = ["status", "priority"];

/** "แสดงบนบอร์ด" ในเมนูจัดกลุ่ม — ใบงานซ่อมปนกับงานบนบอร์ด (lib/maintenance-board.ts) */
const BOARD_KINDS: { id: BoardKind; icon: string; label: string }[] = [
  { id: "task", icon: "📋", label: "งาน" },
  { id: "wo", icon: "🔧", label: "ใบงานซ่อม" },
];

/** ชื่อสั้นบนปุ่มจัดกลุ่มในป๊อปอัปตัวกรอง — ชื่อเต็ม ("ผู้รับผิดชอบ") ทำปุ่มกว้างจนตกบรรทัดในป๊อปอัปกว้าง 380px */
const groupByShort: Record<GroupBy, string> = { status: "สถานะ", priority: "ความสำคัญ", assignee: "คน", department: "แผนก" };

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
  projectId: "none",
} as const;

/** จำนวนตัวกรองที่ตั้งอยู่ — เลขบนปุ่ม "ตัวกรอง" ของมือถือ (ปุ่มอยู่บนแถบหัวของหน้า ไม่ได้อยู่ในคอมโพเนนต์นี้) */
export function countActiveTaskFilters(filters: Record<keyof typeof defaultFilters, unknown>): number {
  return [
    filters.departmentId !== defaultFilters.departmentId,
    filters.assigneeId !== defaultFilters.assigneeId,
    filters.assignedById !== defaultFilters.assignedById,
    filters.priority !== defaultFilters.priority,
    filters.penalty !== defaultFilters.penalty,
    filters.preset !== defaultFilters.preset,
    filters.projectId !== defaultFilters.projectId,
  ].filter(Boolean).length;
}

export function TaskFilters({
  groupBy,
  onGroupByChange,
  resultCount,
  mobile,
  bar = false,
}: {
  /**
   * true = อยู่บนแถบหัวของหน้า (บอร์ดงาน) — เหลือปุ่ม "ตัวกรอง" ปุ่มเดียว กดแล้วเลือกจากตรงนั้น:
   * ≥640px เป็นป๊อปอัปใต้ปุ่ม (แบบปุ่ม "กรอง" ของหน้ารายงาน) · <640px เปิดแผ่นตัวกรองด้านล่างเหมือนเดิม
   * ไม่มีแถวตัวกรองเต็มแถว/ปุ่มสร้างงาน (สร้างงานเป็นปุ่มลอย +) — ใช้คู่กับ `mobile`
   */
  bar?: boolean;
  /** ตัวเลือก "จัดกลุ่มตาม" ของบอร์ด Kanban — ไม่ส่งมา (มุมมองตาราง/ภาระงาน) แล้วช่องนี้จะไม่โชว์เลย */
  groupBy?: GroupBy;
  onGroupByChange?: (g: GroupBy) => void;
  /** จำนวนงานที่ตรงตัวกรองปัจจุบัน — ขึ้นบนปุ่มท้าย bottom sheet ("แสดง N งาน")
   * แทน "ใช้ตัวกรอง" เฉยๆ ไม่ส่งมาก็ยัง fallback เป็นข้อความเดิมได้ */
  resultCount?: number;
  /**
   * มือถือ (<640px): ปุ่ม "ตัวกรอง" กับ "สร้างงานใหม่" ย้ายไปอยู่บนแถบหัว/ปุ่มลอยของหน้า (บอร์ดเต็มพื้นที่)
   * หน้าจึงเป็นคนถือสถานะเปิด/ปิด — ส่งมาแล้วแถวปุ่มของมือถือในนี้จะไม่แสดง เหลือแต่แผ่นตัวกรองกับหน้าต่างสร้างงาน
   */
  mobile?: {
    sheetOpen: boolean;
    onSheetOpenChange: (open: boolean) => void;
    newTaskOpen: boolean;
    onNewTaskOpenChange: (open: boolean) => void;
  };
}) {
  const filters = useTaskStore((s) => s.filters);
  const setFilters = useTaskStore((s) => s.setFilters);
  const resetFilters = useTaskStore((s) => s.resetFilters);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [ownNewTaskOpen, setOwnNewTaskOpen] = useState(false);
  // Mobile-only (<640px) — the 5 fields below collapse into this one button,
  // opened as a bottom sheet, instead of the full row (see the render below).
  const [ownSheetOpen, setOwnSheetOpen] = useState(false);
  const newTaskOpen = mobile ? mobile.newTaskOpen : ownNewTaskOpen;
  const setNewTaskOpen = mobile ? mobile.onNewTaskOpenChange : setOwnNewTaskOpen;
  const mobileSheetOpen = mobile ? mobile.sheetOpen : ownSheetOpen;
  const setMobileSheetOpen = mobile ? mobile.onSheetOpenChange : setOwnSheetOpen;
  const [desktopPanelOpen, setDesktopPanelOpen] = useState(false);

  const isFiltered =
    filters.departmentId !== defaultFilters.departmentId ||
    filters.assigneeId !== defaultFilters.assigneeId ||
    filters.assignedById !== defaultFilters.assignedById ||
    filters.priority !== defaultFilters.priority ||
    filters.penalty !== defaultFilters.penalty ||
    filters.preset !== defaultFilters.preset ||
    filters.projectId !== defaultFilters.projectId;

  // Same fields isFiltered already checks, just counted instead of
  // collapsed to a bool — feeds the "ตัวกรอง (N)" badge on the mobile button.
  const activeFilterCount = countActiveTaskFilters(filters);

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
  const boardKinds = useMaintenanceBoardStore((s) => s.kinds);
  const boardKindCounts = useMaintenanceBoardStore((s) => s.counts);
  const toggleBoardKind = useMaintenanceBoardStore((s) => s.toggleKind);
  const shownKindCount = BOARD_KINDS.filter((k) => boardKinds[k.id]).length;
  const kindsFiltered = shownKindCount < BOARD_KINDS.length;
  // ปุ่มธรรมดา (ไม่ใช่ SelectItem) — ติ๊กแล้วดรอปดาวน์ไม่ปิด เลือกได้หลายอย่างต่อกัน (แบบเดียวกับปุ่ม "มุมมองของฉัน")
  const kindToggles = (
    <SelectGroup>
      <SelectLabel>แสดงบนบอร์ด</SelectLabel>
      {BOARD_KINDS.map((k) => {
        const on = boardKinds[k.id];
        return (
          <button
            key={k.id}
            type="button"
            role="menuitemcheckbox"
            aria-checked={on}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleBoardKind(k.id);
            }}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-[var(--bg-soft)]"
          >
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold",
                on ? "border-[var(--brand-green)] bg-[var(--brand-green)] text-white" : "border-[var(--line)] bg-white"
              )}
              aria-hidden
            >
              {on ? "✓" : ""}
            </span>
            <span>{k.icon}</span>
            <span className="flex-1 text-left">{k.label}</span>
            <span className="text-[11px] tabular-nums text-[var(--ink-soft)]">{boardKindCounts[k.id]}</span>
          </button>
        );
      })}
    </SelectGroup>
  );
  const quickOverdueActive = filters.penalty === "overdue";

  // filters is global store state that outlives the identity switcher — a
  // department/assignee picked while viewing as one person would otherwise
  // stay applied (and possibly reference an option the new identity can't
  // even see) after switching. Reset on every identity change. This mutates
  // an external (Zustand) store, so it has to run as an effect, not during
  // render — setting store state mid-render is unsafe.
  //
  // ยกเว้นครั้งแรกหลังเปิด/รีเฟรชหน้า: ตัวตนเริ่มจากค่า default/ค่าที่จำในเครื่อง แล้วถูกตั้งเป็นคนที่ล็อกอินจริง
  // (report-task-scaffold.tsx setViewingAs) — นั่นไม่ใช่การสลับคน ถ้าล้างตรงนั้น ตัวกรองใน URL/ที่จำไว้หายทุกครั้ง
  // (เจอจากเทสต์ production บน localhost 17/10/2569: ?priority=high, ?project=all หายหมดในเบราว์เซอร์ที่เพิ่งล็อกอิน)
  const lastIdentity = useRef(viewingAsUserId);
  const settledIdentity = useRef(false);
  useEffect(() => {
    if (lastIdentity.current !== viewingAsUserId) {
      lastIdentity.current = viewingAsUserId;
      if (settledIdentity.current) resetFilters();
      settledIdentity.current = true;
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
            <SelectTrigger className={filterFieldTriggerClass(groupBy !== "status" || personalView !== "all" || kindsFiltered, "min-w-[170px]")}>
              <Group className="h-4 w-4 shrink-0" />
              <SelectValue placeholder="จัดกลุ่มตาม">
                {groupByLabels[groupBy]}
                {personalView !== "all" ? ` · ${personalViewLabel}` : ""}
                {kindsFiltered ? ` · ${shownKindCount} ประเภท` : ""}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectLabel>จัดกลุ่มตาม</SelectLabel>
                {(GROUP_BY_CHOICES).map((g) => {
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
              {kindToggles}
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
            <SelectTrigger className={filterFieldTriggerClass(personalView !== "all" || kindsFiltered, "min-w-[150px]")}>
              <Eye className="h-4 w-4 shrink-0" />
              <SelectValue placeholder="มุมมองของฉัน">
                {personalViewLabel}
                {kindsFiltered ? ` · ${shownKindCount} ประเภท` : ""}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value="all">ทั้งหมด</SelectItem>
              <SelectItem value="mine">งานของฉัน</SelectItem>
              <SelectItem value="tracking">งานที่กำลังติดตาม</SelectItem>
              {/* ติ๊กประเภทชุดเดียวกับบอร์ด — สลับไปตาราง/ภาระงานแล้วยังเห็นใบงานซ่อมเหมือนกัน */}
              <SelectSeparator />
              {kindToggles}
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

      {groupBy && onGroupByChange && (
        <Select value={groupBy} onValueChange={(v) => v && onGroupByChange(v as GroupBy)}>
          <SelectTrigger className={mobileFieldRowTriggerClass(groupBy !== "status" || kindsFiltered)}>
            <MobileFieldIcon icon={Group} active={groupBy !== "status" || kindsFiltered} />
            <span className="text-[13.5px] font-medium text-[var(--ink)]">จัดกลุ่มตาม</span>
            <MobileFieldValue active={groupBy !== "status" || kindsFiltered}>
              {groupByLabels[groupBy]}
              {kindsFiltered ? ` · ${shownKindCount} ประเภท` : ""}
            </MobileFieldValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {(GROUP_BY_CHOICES).map((g) => {
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
            <SelectSeparator />
            {kindToggles}
          </SelectContent>
        </Select>
      )}

      {/* ไม่มี "จัดกลุ่มตาม" (ตาราง/ภาระงาน) — ติ๊กประเภทที่แสดงยังต้องอยู่ ชุดเดียวกับบอร์ด */}
      {!groupBy && (
        <Select value="kinds">
          <SelectTrigger className={mobileFieldRowTriggerClass(kindsFiltered)}>
            <MobileFieldIcon icon={Eye} active={kindsFiltered} />
            <span className="text-[13.5px] font-medium text-[var(--ink)]">แสดง</span>
            <MobileFieldValue active={kindsFiltered}>
              {kindsFiltered ? `${shownKindCount} ประเภท` : "ทุกประเภท"}
            </MobileFieldValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>{kindToggles}</SelectContent>
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

  const quickChips = (
    <div className="flex gap-2.5 overflow-x-auto pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <QuickFilterChip icon={UserIcon} label="งานของฉัน" active={quickMineActive} onClick={() => setFilters({ assigneeId: quickMineActive ? "all" : viewingAsUserId })} />
      <QuickFilterChip icon={Eye} label="กำลังติดตาม" active={quickTrackingActive} onClick={() => setFilters({ assignedById: quickTrackingActive ? "all" : viewingAsUserId })} />
      <QuickFilterChip icon={AlertTriangle} label="เลยกำหนด" warn active={quickOverdueActive} onClick={() => setFilters({ penalty: quickOverdueActive ? "all" : "overdue" })} />
    </div>
  );

  const sheet = (
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
          {quickChips}
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
  );

  if (bar) {
    // ---- แบบใหม่ (mockup "ตัวกรองบอร์ดงานแบบใหม่" 18/10/2569) — ชิปกดทีเดียว ไม่ซ่อน ไม่ซ้ำ ----
    // งานของใคร: ทุกคน / งานของฉัน / ที่ฉันมอบหมาย + ⚠ เลยกำหนด · กำหนดส่ง · ความสำคัญ เป็นชิปทั้งหมด
    // แผนก/ผู้รับผิดชอบยังเป็นช่องเลือก (รายชื่อยาว) เฉพาะคนที่มีให้เลือก · "การแสดงผล" (จัดกลุ่ม/ประเภทบนบอร์ด) แยกไว้ล่างสุด
    const whoAll = filters.assigneeId === "all" && filters.assignedById === "all";
    const chip = (active: boolean, warn?: boolean) =>
      cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors",
        active
          ? warn
            ? "border-[var(--chart-red)] bg-[var(--chart-red)] font-semibold text-white"
            : "border-[var(--ink)] bg-[var(--ink)] font-semibold text-white"
          : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--ink-soft)]"
      );
    const sectionLabel = "mb-1.5 flex items-center justify-between text-[11px] font-semibold tracking-wide text-[var(--ink-faint)]";
    const panel = (inSheet: boolean) => (
      <div className="flex flex-col">
        <div className={cn("flex items-center justify-between gap-2 px-4", inSheet ? "pt-1 pr-11" : "pt-3.5")}>
          <p className={cn("font-semibold", inSheet ? "text-base" : "text-sm")}>ตัวกรอง</p>
          {isFiltered && (
            <button type="button" onClick={resetFilters} className="text-[13px] font-medium text-[var(--brand-green-dark)] underline-offset-2 hover:underline">
              ล้างทั้งหมด
            </button>
          )}
        </div>

        {/* เรียงจากใหญ่ไปเล็กแบบเดิม (ผู้ใช้ขอ 18/10/2569): แผนก → คน → กำหนดส่ง → ความสำคัญ → การแสดงผล
            แผนก/ช่องเลือกคน มีเฉพาะหัวหน้า/เจ้าของ (พนักงานทั่วไปเห็นแค่ของตัวเองอยู่แล้ว ไม่ต้องโชว์) */}
        {availableDepartments.length > 1 && (
          <div className="px-4 pt-3">
            <p className={sectionLabel}>แผนก</p>
            <Select value={filters.departmentId} onValueChange={(v) => v && setFilters({ departmentId: v })}>
              <SelectTrigger className={cn("h-9 w-full rounded-[10px] text-[13px]", filters.departmentId !== "all" && "border-[var(--brand-green-dark)]/40 bg-[var(--accent)]")}>
                <span className="w-[84px] shrink-0 text-left text-[var(--ink-soft)]">แผนก</span>
                <span className="flex-1 truncate text-left font-medium">
                  {filters.departmentId === "all" ? "ทุกแผนก" : (getDepartment(filters.departmentId)?.name ?? "แผนก")}
                </span>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="all">ทุกแผนก</SelectItem>
                {availableDepartments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="px-4 pt-3">
          <p className={sectionLabel}>คน</p>
          {peopleInScope.length > 1 && (
            <div className="mb-1.5">
              <Select value={filters.assigneeId} onValueChange={(v) => v && setFilters({ assigneeId: v, ...(v !== "all" ? { assignedById: "all" } : {}) })}>
                <SelectTrigger className={cn("h-9 w-full rounded-[10px] text-[13px]", filters.assigneeId !== "all" && "border-[var(--brand-green-dark)]/40 bg-[var(--accent)]")}>
                  <span className="w-[84px] shrink-0 text-left text-[var(--ink-soft)]">ผู้รับผิดชอบ</span>
                  <span className="flex-1 truncate text-left font-medium">
                    {filters.assigneeId === "all" ? "ทุกคน" : filters.assigneeId === viewingAsUserId ? "ของฉัน" : (getUser(filters.assigneeId)?.name ?? "ผู้รับผิดชอบ")}
                  </span>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectItem value="all">ทุกคน</SelectItem>
                  {viewerInScope && <SelectItem value={viewingAsUserId}>ของฉัน</SelectItem>}
                  {restOfScope.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={whoAll} className={chip(whoAll)} onClick={() => setFilters({ assigneeId: "all", assignedById: "all" })}>
              ทุกคน
            </button>
            <button
              type="button"
              aria-pressed={quickMineActive}
              className={chip(quickMineActive)}
              onClick={() => setFilters({ assigneeId: quickMineActive ? "all" : viewingAsUserId, assignedById: "all" })}
            >
              <UserIcon className="h-3.5 w-3.5" />
              งานของฉัน
            </button>
            <button
              type="button"
              aria-pressed={quickTrackingActive}
              className={chip(quickTrackingActive)}
              onClick={() => setFilters({ assignedById: quickTrackingActive ? "all" : viewingAsUserId, assigneeId: "all" })}
            >
              <Eye className="h-3.5 w-3.5" />
              ที่ฉันมอบหมาย
            </button>
          </div>
        </div>

        {/* หัวข้อ "กำหนดส่ง" เอาออก — ช่วงเวลาตัดทิ้งแล้ว และ "เลยกำหนด" ย้ายไปอยู่แถวจัดกลุ่มตามด้านล่าง (ผู้ใช้ขอ 18/10/2569) */}

        {/* ตัวกรองความสำคัญตัดทิ้งแล้ว (ผู้ใช้ขอ 18/10/2569 "เอาออกตรง filter อย่างเดียว") — จัดกลุ่มตามความสำคัญด้านล่างยังอยู่ */}

        {!inSheet && resultCount !== undefined && (
          <p className="px-4 pt-3 text-[12.5px] text-[var(--ink-soft)]">
            ตรงเงื่อนไข <b className="tabular-nums text-[var(--ink)]">{resultCount}</b> งาน · บอร์ดเปลี่ยนทันทีที่กด
          </p>
        )}

        {/* การแสดงผล — ไม่ใช่ตัวกรอง แยกไว้ล่างสุด และไม่นับเป็น "ใช้ตัวกรองอยู่" */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--line)] px-4 py-3">
          {groupBy && onGroupByChange && (
            <>
              <span className="text-[12.5px] text-[var(--ink-soft)]">จัดกลุ่มตาม</span>
              <span className="inline-flex gap-0.5 rounded-[9px] bg-[var(--bg-soft)] p-[3px]">
                {GROUP_BY_CHOICES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={groupBy === g}
                    onClick={() => onGroupByChange(g)}
                    className={cn(
                      "rounded-[7px] px-2.5 py-1 text-xs transition-colors",
                      groupBy === g ? "bg-white font-semibold text-[var(--ink)] shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                    )}
                  >
                    {groupByShort[g]}
                  </button>
                ))}
              </span>
            </>
          )}
          {/* "เลยกำหนด" ย้ายมาอยู่แถวนี้ (ผู้ใช้ขอ 18/10/2569) — ยังเป็นตัวกรอง: กดแล้วบอร์ดเหลือเฉพาะงานเลยกำหนด */}
          <button
            type="button"
            aria-pressed={quickOverdueActive}
            className={cn(chip(quickOverdueActive, true), "h-7 px-2.5 text-xs")}
            onClick={() => setFilters({ penalty: quickOverdueActive ? "all" : "overdue", quickView: "all" })}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            เลยกำหนด
          </button>
          <span className="ml-auto flex gap-1">
            {BOARD_KINDS.map((k) => {
              const on = boardKinds[k.id];
              return (
                <button
                  key={k.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleBoardKind(k.id)}
                  title={on ? `ซ่อน${k.label}บนบอร์ด` : `แสดง${k.label}บนบอร์ด`}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors",
                    on ? "border-[var(--line)] bg-white text-[var(--ink)]" : "border-dashed border-[var(--line)] bg-transparent text-[var(--ink-faint)] line-through"
                  )}
                >
                  <span>{k.icon}</span>
                  {k.label}
                  <span className="tabular-nums text-[var(--ink-soft)]">{boardKindCounts[k.id]}</span>
                </button>
              );
            })}
          </span>
        </div>
      </div>
    );

    // ป้ายตัวกรองที่ใช้อยู่ บนแถบบน (จอคอม) — กด ✕ เอาออกทีละอันได้โดยไม่ต้องเปิดป๊อปอัป
    const activeTags: { key: string; label: string; warn?: boolean; clear: Partial<typeof filters> }[] = [
      ...(quickMineActive ? [{ key: "mine", label: "งานของฉัน", clear: { assigneeId: "all" } }] : []),
      ...(!quickMineActive && filters.assigneeId !== "all"
        ? [{ key: "who", label: getUser(filters.assigneeId)?.name ?? "ผู้รับผิดชอบ", clear: { assigneeId: "all" } }]
        : []),
      ...(quickTrackingActive ? [{ key: "track", label: "ที่ฉันมอบหมาย", clear: { assignedById: "all" } }] : []),
      ...(quickOverdueActive ? [{ key: "late", label: "เลยกำหนด", warn: true, clear: { penalty: "all" } }] : []),
      ...(filters.departmentId !== "all" ? [{ key: "dept", label: getDepartment(filters.departmentId)?.name ?? "แผนก", clear: { departmentId: "all" } }] : []),
    ] as { key: string; label: string; warn?: boolean; clear: Partial<typeof filters> }[];

    return (
      <>
        {/* ≥1024px: ป้ายตัวกรองที่ใช้อยู่ ข้างปุ่ม (จอแคบกว่านี้ดูจำนวนบนปุ่มแทน) */}
        {activeTags.length > 0 && (
          <div className="hidden min-w-0 items-center gap-1.5 overflow-hidden lg:flex">
            {activeTags.map((t) => (
              <span
                key={t.key}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-0.5 rounded-full border pl-2.5 pr-1 text-xs",
                  t.warn ? "border-red-200 bg-red-50 text-[var(--chart-red)]" : "border-[var(--line)] bg-[var(--bg-soft)] text-[var(--ink)]"
                )}
              >
                <span className="max-w-[120px] truncate">{t.label}</span>
                <button
                  type="button"
                  onClick={() => setFilters({ ...t.clear, quickView: "all" })}
                  aria-label={`เอา ${t.label} ออก`}
                  className="flex h-5 w-5 items-center justify-center rounded-full opacity-70 hover:bg-black/5 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* <640px: ไอคอนอย่างเดียว เปิดแผ่นตัวกรองด้านล่าง */}
        <button
          type="button"
          onClick={() => setMobileSheetOpen(true)}
          aria-label={activeFilterCount > 0 ? `ตัวกรอง ใช้อยู่ ${activeFilterCount} รายการ` : "ตัวกรอง"}
          className={cn(
            "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:scale-95 sm:hidden",
            activeFilterCount > 0
              ? "bg-[var(--sidebar-accent)] text-[var(--brand-green-dark)]"
              : "text-(--app-strong) hover:bg-[var(--sidebar-accent)] hover:text-[var(--brand-green-dark)]"
          )}
        >
          <SlidersHorizontal className="h-5 w-5" />
          {activeFilterCount > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--brand-green-dark)] px-1 text-[10.5px] font-bold text-white tabular-nums">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* ≥640px: ปุ่ม "ตัวกรอง" → ป๊อปอัปใต้ปุ่ม เลือกจากตรงนั้นเลย */}
        <Popover open={desktopPanelOpen} onOpenChange={setDesktopPanelOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className={cn(
                  // สีเขียวแบรนด์ชุดเดียวกับแท็บมุมมอง: ปกติขาว · hover/เปิดอยู่ = พื้นเขียวอ่อน · มีตัวกรองใช้อยู่ = ขอบเขียว + เลขบนวงเขียว
                  "group hidden h-[34px] shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-all duration-200 active:scale-[0.97] sm:flex",
                  activeFilterCount > 0 || desktopPanelOpen
                    ? "border-[var(--brand-green-dark)]/45 bg-[var(--sidebar-accent)] text-[var(--brand-green-dark)] shadow-[0_2px_8px_rgba(30,120,48,0.15)]"
                    : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--brand-green-dark)]/40 hover:bg-[var(--sidebar-accent)] hover:text-[var(--brand-green-dark)] hover:shadow-sm"
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--brand-green-dark)] transition-transform duration-200 group-hover:scale-110" />
                ตัวกรอง
                {activeFilterCount > 0 && (
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--brand-green-dark)] px-1 text-[11px] font-bold text-white tabular-nums">
                    {activeFilterCount}
                  </span>
                )}
                <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", desktopPanelOpen && "rotate-180")} />
              </button>
            }
          />
          <PopoverContent align="end" className="w-[380px] max-h-[80vh] gap-0 overflow-y-auto p-0">
            {panel(false)}
          </PopoverContent>
        </Popover>

        <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
          <SheetContent side="bottom" className="max-h-[88vh] gap-0 overflow-y-auto rounded-t-2xl">
            <SheetHeader className="sr-only">
              <SheetTitle>ตัวกรอง</SheetTitle>
            </SheetHeader>
            <div className="pt-3">{panel(true)}</div>
            <SheetFooter className="sticky bottom-0 border-t border-[var(--line)] bg-white">
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
      <div className={cn("sm:hidden items-center gap-2", mobile ? "hidden" : "flex")}>
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

      {sheet}

      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} allowedTypes={["task"]} />
    </>
  );
}
