"use client";

import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import { getUser, getDepartment, canManage } from "@/modules/report_task/data/mock";
import { datePresetLabels, type DatePreset } from "@/modules/report_task/lib/date-filter";
import { taskPriorityOrder, priorityMeta } from "@/modules/report_task/lib/task-meta";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { cn } from "@/modules/report_task/lib/utils";
import type { TaskPriority } from "@/modules/report_task/types";
import { Users } from "lucide-react";

const presets: DatePreset[] = ["all", "today", "week", "month", "custom"];

export function DashboardFilters() {
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const priority = useDashboardFilterStore((s) => s.priority);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  const setPersonId = useDashboardFilterStore((s) => s.setPersonId);
  const setDepartmentId = useDashboardFilterStore((s) => s.setDepartmentId);
  const setPriority = useDashboardFilterStore((s) => s.setPriority);
  const setPreset = useDashboardFilterStore((s) => s.setPreset);
  const setCustomRange = useDashboardFilterStore((s) => s.setCustomRange);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  // Org-wide performance data (everyone's tasks/scores) is manager-eyes-only,
  // especially now the score ties to real bonuses — a regular employee can
  // only ever look at their own dashboard, not switch to "everyone" or a
  // specific coworker.
  const canPickPerson = canManage(viewingAsUserId);

  // Only offer people who actually show up in tasks this viewer can see
  // (canSeeTask, via useVisibleTasks) — a department head's "ดูข้อมูลของ"
  // list is their own department, not the whole company.
  const visibleTasks = useVisibleTasks();
  const pickablePeople = useMemo(() => {
    const ids = new Set(visibleTasks.flatMap((t) => t.assigneeIds));
    return [...ids].map((id) => getUser(id)).filter((u): u is NonNullable<typeof u> => !!u);
  }, [visibleTasks]);

  // Same idea as the person picker — only offer departments that actually
  // show up among tasks this viewer can see, and only while looking at
  // everyone at once (picking one person already narrows to their department).
  const availableDepartments = useMemo(() => {
    const ids = new Set(visibleTasks.flatMap((t) => t.departmentIds));
    return [...ids].map((id) => getDepartment(id)).filter((d): d is NonNullable<typeof d> => !!d);
  }, [visibleTasks]);

  // The store is global and outlives the identity switcher, so whatever was
  // last picked (a specific coworker, "all") would otherwise carry over to
  // the next identity untouched — a manager seeing a stale "all" is harmless,
  // but a non-head seeing a stale "all"/coworker would leak org-wide data.
  // Re-default on every identity change: "all" if the new identity can pick
  // people, otherwise locked to themselves. This mutates an external
  // (Zustand) store, so it has to run as an effect, not during render —
  // setting store state mid-render is unsafe even though the equivalent
  // local-useState pattern elsewhere in this file (e.g. escalations-panel)
  // is fine.
  const lastIdentity = useRef(viewingAsUserId);
  useEffect(() => {
    if (lastIdentity.current !== viewingAsUserId) {
      lastIdentity.current = viewingAsUserId;
      setPersonId(canPickPerson ? "all" : viewingAsUserId);
      setDepartmentId("all");
    }
  }, [viewingAsUserId, canPickPerson, setPersonId, setDepartmentId]);

  // Department only makes sense while looking at everyone at once — clear it
  // the moment a specific person is picked instead of leaving a stale value
  // silently applied underneath.
  useEffect(() => {
    if (personId !== "all" && departmentId !== "all") setDepartmentId("all");
  }, [personId, departmentId, setDepartmentId]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#eef2f7] bg-white p-2.5 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
      <div className="flex items-center gap-1.5 pl-1.5">
        <Users className="h-4 w-4 text-[var(--ink-soft)]" />
        {canPickPerson ? (
          <Select value={personId} onValueChange={(v) => v && setPersonId(v)}>
            <SelectTrigger className="w-[170px] border-none shadow-none bg-transparent">
              <SelectValue placeholder="ดูข้อมูลของ">
                {personId === "all" ? "ทุกคน (ภาพรวม)" : (getUser(personId)?.name ?? "ดูข้อมูลของ")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกคน (ภาพรวม)</SelectItem>
              {pickablePeople.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm font-medium px-2" title="แดชบอร์ดของพนักงานแสดงข้อมูลของตัวเองเท่านั้น">
            {getUser(viewingAsUserId)?.name}
          </span>
        )}
      </div>

      {canPickPerson && personId === "all" && availableDepartments.length > 1 && (
        <Select value={departmentId} onValueChange={(v) => v && setDepartmentId(v)}>
          <SelectTrigger className="w-[150px] bg-white">
            <SelectValue placeholder="แผนก">
              {departmentId === "all" ? "ทุกแผนก" : (getDepartment(departmentId)?.name ?? "แผนก")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกแผนก</SelectItem>
            {availableDepartments.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="h-6 w-px bg-[var(--line)] hidden sm:block" />

      <div className="flex items-center gap-1 bg-[var(--bg-soft)] rounded-lg p-1 max-w-full overflow-x-auto">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors shrink-0",
              preset === p ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
            )}
          >
            {datePresetLabels[p]}
          </button>
        ))}
      </div>

      <Select value={priority} onValueChange={(v) => v && setPriority(v as TaskPriority | "all")}>
        <SelectTrigger className="w-[140px] bg-white">
          <SelectValue placeholder="ความสำคัญ">
            {priority === "all" ? "ทุกความสำคัญ" : priorityMeta[priority as TaskPriority]?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">ทุกความสำคัญ</SelectItem>
          {taskPriorityOrder.map((p) => (
            <SelectItem key={p} value={p}>{priorityMeta[p].label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {preset === "custom" && (
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomRange(e.target.value, customTo)}
            className="w-[150px] max-w-full"
          />
          <span className="text-[var(--ink-soft)] text-sm">ถึง</span>
          <Input
            type="date"
            value={customTo}
            onChange={(e) => setCustomRange(customFrom, e.target.value)}
            className="w-[150px] max-w-full"
          />
        </div>
      )}

      {((canPickPerson && personId !== "all") || departmentId !== "all" || priority !== "all" || preset !== "all") && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-[var(--ink-soft)]"
          onClick={() => {
            if (canPickPerson) setPersonId("all");
            setDepartmentId("all");
            setPriority("all");
            setPreset("all");
          }}
        >
          ล้างตัวกรอง
        </Button>
      )}
    </div>
  );
}
