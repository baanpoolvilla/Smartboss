"use client";

import { X } from "lucide-react";
import { getDepartment, getUser, canManage } from "@/modules/report_task/data/mock";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";

/**
 * §8.4 — when a click on a chart (e.g. a department Pie slice) sets the
 * Dashboard's own department/person filter instead of navigating away, this
 * is the "กำลังดู: แผนกขาย ✕" chip that shows it happened and lets it be
 * cleared with one click. Also covers the same filters when set via the
 * normal dropdowns up top, since the effect (and the need to see + clear it)
 * is identical either way.
 */
export function ActiveFilterChips() {
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const personId = useDashboardFilterStore((s) => s.personId);
  const setDepartmentId = useDashboardFilterStore((s) => s.setDepartmentId);
  const setPersonId = useDashboardFilterStore((s) => s.setPersonId);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  // A non-manager's personId is permanently locked to themselves (see
  // dashboard-filters.tsx) — that's their identity, not a chosen filter, so
  // it gets no chip (and no clear button that would silently do nothing
  // useful, since useVisibleTasks/canSeeTask still scope them to their own
  // data regardless of what personId says).
  const canPickPerson = canManage(viewingAsUserId);

  if (departmentId === "all" && (personId === "all" || !canPickPerson)) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {canPickPerson && personId !== "all" && (
        <Chip label={`กำลังดู: ${getUser(personId)?.name ?? "ไม่ทราบ"}`} onClear={() => setPersonId("all")} />
      )}
      {departmentId !== "all" && (
        <Chip label={`กำลังดู: แผนก${getDepartment(departmentId)?.name ?? ""}`} onClear={() => setDepartmentId("all")} />
      )}
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] text-[var(--brand-green-dark)] text-xs font-medium pl-3 pr-1.5 py-1">
      {label}
      <button
        onClick={onClear}
        aria-label={`ล้าง ${label}`}
        className="h-4 w-4 rounded-full flex items-center justify-center hover:bg-white/60 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
