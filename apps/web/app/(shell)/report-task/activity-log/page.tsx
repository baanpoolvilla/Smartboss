"use client";

import { useMemo, useState } from "react";
import { ScrollText, X, Users, ListFilter, Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import { Button } from "@/modules/report_task/components/ui/button";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { StickyFilterBar } from "@/modules/report_task/components/shared/sticky-filter-bar";
import { FilterField, filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { DateRangeSelectField } from "@/modules/report_task/components/shared/date-range-select-field";
import { DaySeparator } from "@/modules/report_task/components/report-feed/report-day-separator";
import { useActivityLogStore } from "@/modules/report_task/store/activity-log-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { getUser, getDepartment, users, canManage } from "@/modules/report_task/lib/directory";
import { relativeTime, formatDateTime, groupByDay } from "@/modules/report_task/lib/format";
import { presetRange, type DatePreset } from "@/modules/report_task/lib/date-filter";
import { activityActionMeta } from "@/modules/report_task/lib/activity-meta";
import { SYSTEM_USER_ID } from "@/modules/report_task/store/task-store";
import { ShieldAlert } from "lucide-react";

export default function ActivityLogPage() {
  const entries = useActivityLogStore((s) => s.entries);
  const [userId, setUserId] = useState<string>("all");
  const [departmentId, setDepartmentId] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [preset, setPreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const allowed = canManage(viewingAsUserId);

  // Only actions that have actually happened, not every possible one — an
  // empty log shouldn't show a dropdown full of options that filter to nothing.
  const actionOptions = useMemo(() => Array.from(new Set(entries.map((e) => e.action))), [entries]);
  const actorOptions = useMemo(() => {
    const ids = new Set(entries.map((e) => e.userId));
    return users.filter((u) => ids.has(u.id));
  }, [entries]);

  // A row's department is whoever *did* the thing (their departmentId) —
  // not the task's own department — since a lead using this page is
  // auditing "what did my department's people do", the same reason this
  // page is canManage-gated in the first place. System (auto-penalty)
  // entries have no actor department, so they only ever show under "ทุกแผนก".
  const departmentOptions = useMemo(() => {
    const ids = new Set(
      entries
        .map((e) => (e.userId === SYSTEM_USER_ID ? undefined : getUser(e.userId)?.departmentId))
        .filter((id): id is string => !!id)
    );
    return [...ids].map((id) => getDepartment(id)).filter((d): d is NonNullable<typeof d> => !!d);
  }, [entries]);

  const filtered = useMemo(() => {
    const range = presetRange(preset, customFrom, customTo);
    return entries.filter((e) => {
      if (departmentId !== "all") {
        if (e.userId === SYSTEM_USER_ID) return false;
        if (getUser(e.userId)?.departmentId !== departmentId) return false;
      }
      if (userId !== "all" && e.userId !== userId) return false;
      if (action !== "all" && e.action !== action) return false;
      if (range) {
        const t = new Date(e.createdAt).getTime();
        if (t < range.from.getTime() || t > range.to.getTime()) return false;
      }
      return true;
    });
  }, [entries, departmentId, userId, action, preset, customFrom, customTo]);

  const hasFilters = departmentId !== "all" || userId !== "all" || action !== "all" || preset !== "all";

  function clearFilters() {
    setDepartmentId("all");
    setUserId("all");
    setAction("all");
    setPreset("all");
    setCustomFrom("");
    setCustomTo("");
  }

  const grouped = useMemo(() => groupByDay(filtered, (e) => e.createdAt), [filtered]);

  return (
    <div className="flex flex-col gap-4 lg:gap-6 pb-6">
      <StickyFilterBar>
        {allowed && (
          <div className="flex flex-wrap items-end gap-2">
            {/* Ordered broadest → narrowest, same inverted-pyramid convention
                as every other filter bar (see date-filter.ts): "เมื่อไหร่"
                narrows the whole list the most, "แผนก" narrows within that,
                "ใคร" narrows within that, "ทำอะไร" narrows within that again. */}
            <DateRangeSelectField
              preset={preset}
              customFrom={customFrom}
              customTo={customTo}
              onPresetChange={setPreset}
              onCustomRangeChange={(from, to) => {
                setCustomFrom(from);
                setCustomTo(to);
              }}
            />

            {/* Same "hide the picker, show a plain label" fallback as the
                Task Board's own department field (task-filters.tsx) when
                there's nothing to actually pick between. */}
            {departmentOptions.length > 1 ? (
              <FilterField label="แผนก">
                <Select value={departmentId} onValueChange={(v) => v && setDepartmentId(v)}>
                  <SelectTrigger className={filterFieldTriggerClass(departmentId !== "all", "min-w-[140px]")}>
                    <Building2 className="h-4 w-4 shrink-0" />
                    <SelectValue>{departmentId === "all" ? "ทุกแผนก" : getDepartment(departmentId)?.name ?? "ทุกแผนก"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectItem value="all">ทุกแผนก</SelectItem>
                    {departmentOptions.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
            ) : departmentOptions.length === 1 ? (
              <FilterField label="แผนก">
                <span className={filterFieldTriggerClass(false, "min-w-[140px] cursor-default")}>
                  <Building2 className="h-4 w-4 shrink-0" />
                  {departmentOptions[0]?.name ?? "ไม่มีแผนก"}
                </span>
              </FilterField>
            ) : null}

            <FilterField label="คนที่ทำ">
              <Select value={userId} onValueChange={(v) => v && setUserId(v)}>
                <SelectTrigger className={filterFieldTriggerClass(userId !== "all", "min-w-[150px]")}>
                  <Users className="h-4 w-4 shrink-0" />
                  <SelectValue>{userId === "all" ? "ทุกคน" : getUser(userId)?.name ?? "ทุกคน"}</SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectItem value="all">ทุกคน</SelectItem>
                  {actorOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                  {entries.some((e) => e.userId === SYSTEM_USER_ID) && (
                    <SelectItem value={SYSTEM_USER_ID}>ระบบ (อัตโนมัติ)</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="การกระทำ">
              <Select value={action} onValueChange={(v) => v && setAction(v)}>
                <SelectTrigger className={filterFieldTriggerClass(action !== "all", "min-w-[170px]")}>
                  <ListFilter className="h-4 w-4 shrink-0" />
                  <SelectValue>{action === "all" ? "ทุกการกระทำ" : action}</SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectItem value="all">ทุกการกระทำ</SelectItem>
                  {actionOptions.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <div className="ml-auto flex items-end gap-2">
              {hasFilters && (
                <Button data-tour="activity-clear-filters" variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5" /> ล้างตัวกรอง
                </Button>
              )}
              <span className="text-xs text-[var(--ink-soft)] shrink-0 pb-2">{filtered.length} รายการ</span>
            </div>
          </div>
        )}
      </StickyFilterBar>

      {!allowed ? (
        <EmptyState
          icon={ShieldAlert}
          title="หน้านี้สำหรับหัวหน้าแผนกและผู้บริหารเท่านั้น"
          description="แสดงข้อมูลผลงาน/คะแนนของทุกคนในองค์กร จำกัดสิทธิ์ให้เห็นเฉพาะระดับหัวหน้าขึ้นไป"
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-[var(--line)] bg-white overflow-hidden">
          <EmptyState
            icon={ScrollText}
            title={entries.length === 0 ? "ยังไม่มีบันทึกกิจกรรม" : "ไม่พบรายการที่ตรงกับตัวกรอง"}
            description={entries.length === 0 ? "พอมีการเปลี่ยนสถานะงาน, แก้กำหนดส่ง, หักคะแนน ฯลฯ จะบันทึกไว้ที่นี่โดยอัตโนมัติ" : undefined}
            className="border-0"
          />
        </div>
      ) : (
        <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-0.5">
          {grouped.map((group) => (
            <div key={group.key} className="space-y-2">
              <DaySeparator label={group.label} />
              <div className="rounded-xl border border-[var(--line)] bg-white divide-y divide-[var(--line)] overflow-hidden">
                {group.items.map((e) => {
                  const isSystem = e.userId === SYSTEM_USER_ID;
                  const user = isSystem ? null : getUser(e.userId);
                  const meta = activityActionMeta(e.action);
                  const Icon = meta.icon;
                  return (
                    <div key={e.id} className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-soft)] transition-colors">
                      {/* Action-type chip first — lets the eye sort rows by
                          "what kind of thing happened" before reading any
                          text, since a long run of same-shaped grey rows is
                          what made this feed hard to scan. */}
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.bgClass} ${meta.colorClass}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                        <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                          {isSystem ? "SYS" : user?.avatar ?? "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-medium">{isSystem ? "ระบบ (อัตโนมัติ)" : user?.name ?? "ไม่ทราบ"}</span>{" "}
                          <span className="text-[var(--ink-soft)]">{e.action}</span>{" "}
                          <span className="font-medium">{e.target}</span>
                        </p>
                        {e.detail && <p className="text-xs text-[var(--ink-soft)] mt-0.5 truncate" title={e.detail}>{e.detail}</p>}
                      </div>
                      <span className="text-xs text-[var(--ink-soft)] shrink-0 text-right" title={relativeTime(e.createdAt)}>
                        {formatDateTime(e.createdAt)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
