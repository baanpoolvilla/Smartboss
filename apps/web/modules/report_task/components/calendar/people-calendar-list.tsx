"use client";

import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Input } from "@/modules/report_task/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { users, departments, getDepartment } from "@/modules/report_task/lib/directory";
import { colorPalette, useEventColorStore } from "@/modules/report_task/store/event-color-store";
import { useCalendarVisibilityStore } from "@/modules/report_task/store/calendar-visibility-store";
import { useHolidayStore, THAI_SOURCE, isSourceSelected } from "@/modules/report_task/store/holiday-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { cn } from "@/modules/report_task/lib/utils";
import { ChevronDown, Search } from "lucide-react";

const COLLAPSED_COUNT = 8;

/** A stable color per person, cycling through the shared palette by index. */
function colorFor(index: number) {
  return colorPalette[index % colorPalette.length]!.value;
}

// Nager.Date has no Thai data, so Thailand is a fixed, locally-sourced entry
// pinned above the fetched list — same shape as add-calendar-dialog's own
// THAILAND constant (kept separate since that one isn't exported).
const THAILAND_COUNTRY = { countryCode: THAI_SOURCE, name: "ไทย (Thailand)" };

/** Toggle whose country-holiday sets show on your own calendar — the same
 * per-user selection add-calendar-dialog's "เพิ่มวันหยุดตามประเทศ" pane
 * manages, surfaced here as one more show/hide row so it doesn't take a
 * trip to settings just to hide a country you already turned on. Only
 * rendered on the วันหยุด·ลา tab (see showCountryHolidays), since work-tab
 * calendars don't show holidays at all. */
function CountryHolidayToggleList() {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const selectedByUser = useHolidayStore((s) => s.selectedByUser);
  const selectSource = useHolidayStore((s) => s.selectSource);
  const deselectSource = useHolidayStore((s) => s.deselectSource);
  const holidayColor = useEventColorStore((s) => s.colors.holiday);
  const [countries, setCountries] = useState<{ countryCode: string; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/report-task/holidays/countries")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setCountries(data))
      .catch(() => {});
  }, []);

  const isChecked = (code: string) => isSourceSelected(selectedByUser, viewingAsUserId, code);
  // Only countries this person already turned on — adding a new one still
  // happens from add-calendar-dialog's full country picker; this list is
  // just for showing/hiding what's already selected.
  const active = [THAILAND_COUNTRY, ...countries].filter((c) => isChecked(c.countryCode));
  if (active.length === 0) return null;

  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold">วันหยุดประเทศ</h3>
      <p className="text-xs text-[var(--ink-soft)] mt-1 mb-3">ติ๊กเพื่อแสดง/ซ่อนวันหยุดของแต่ละประเทศที่เลือกไว้</p>
      <div className="flex flex-col">
        {active.map((c) => {
          const checked = isChecked(c.countryCode);
          return (
            <label
              key={c.countryCode}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-soft)] cursor-pointer"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() =>
                  checked ? deselectSource(viewingAsUserId, c.countryCode) : selectSource(viewingAsUserId, c.countryCode)
                }
                aria-label={`แสดงวันหยุดของ ${c.name}`}
              />
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: holidayColor }} />
              <span className={cn("text-sm truncate", !checked && "text-[var(--ink-soft)] line-through")}>{c.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** Outlook-style "People's calendars" — toggle whose tasks/meetings/leave show. */
export function PeopleCalendarList({
  singleColumn = false,
  // CalendarRail's box now has a real fixed height (matching the calendar
  // next to it) with its own overflow-y:auto — collapsing at a flat 8
  // regardless of that meant most orgs left a big dead gap under "ดูเพิ่มเติม"
  // even though the box had plenty of room left ("แสดงให้เต็มก่อนสิ"). This
  // shows the full list by default instead and leans on the box's own
  // scroll for the rare org too big to fit — no fixed count involved.
  alwaysExpanded = false,
  // Only true on the วันหยุด·ลา tab (see calendar-view.tsx/calendar-rail.tsx)
  // — the งาน tab has no holiday data to toggle.
  showCountryHolidays = false,
}: { singleColumn?: boolean; alwaysExpanded?: boolean; showCountryHolidays?: boolean }) {
  const hiddenUserIds = useCalendarVisibilityStore((s) => s.hiddenUserIds);
  const toggle = useCalendarVisibilityStore((s) => s.toggle);
  const showAll = useCalendarVisibilityStore((s) => s.showAll);
  const hideAll = useCalendarVisibilityStore((s) => s.hideAll);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("all");

  const filtered = useMemo(
    () =>
      users.filter(
        (u) =>
          (departmentId === "all" || u.departmentId === departmentId) &&
          u.name.toLowerCase().includes(search.trim().toLowerCase())
      ),
    [search, departmentId]
  );
  // Filtering narrows the list on its own — collapsing an already-filtered
  // result would just hide matches, so only collapse the unfiltered browse view.
  const filterActive = search.trim() !== "" || departmentId !== "all";
  const visiblePeople =
    alwaysExpanded || filterActive || expanded ? filtered : filtered.slice(0, COLLAPSED_COUNT);
  const hiddenCount = filtered.length - visiblePeople.length;
  const allHidden = hiddenUserIds.length >= users.length;

  return (
    <div>
      {showCountryHolidays && <CountryHolidayToggleList />}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">คนในองค์กร</h3>
        <button
          onClick={() => (allHidden ? showAll() : hideAll(users.map((u) => u.id)))}
          className="text-[11px] font-medium text-[var(--brand-green-dark)] hover:underline"
        >
          {allHidden ? "แสดงทั้งหมด" : "ซ่อนทั้งหมด"}
        </button>
      </div>
      <p className="text-xs text-[var(--ink-soft)] mt-1 mb-3">ติ๊กเพื่อแสดง/ซ่อนงาน ประชุม และวันลาของแต่ละคนในปฏิทิน</p>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative max-w-[220px] flex-1 min-w-[160px]">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-soft)]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ" className="pl-8 h-9" />
        </div>
        <Select value={departmentId} onValueChange={(v) => v && setDepartmentId(v)}>
          <SelectTrigger className="w-[160px] bg-white">
            <SelectValue placeholder="แผนก">
              {departmentId === "all" ? "ทุกแผนก" : (getDepartment(departmentId)?.name ?? "แผนก")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกแผนก</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--ink-soft)] py-4 text-center">ไม่พบคนที่ตรงกับตัวกรอง</p>
      ) : (
        <div
          className={
            singleColumn
              ? "flex flex-col"
              // Two columns need real width to keep names from truncating to
              // "A." — only try it once the viewport's actually wide enough
              // (this component also renders full-width inside the mobile
              // "เพิ่มปฏิทิน" sheet, which is exactly as narrow as a phone).
              : "columns-1 sm:columns-2 gap-x-6 max-w-2xl"
          }
        >
          {visiblePeople.map((u) => {
            const visible = !hiddenUserIds.includes(u.id);
            const color = colorFor(users.indexOf(u));
            return (
              <label
                key={u.id}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-soft)] cursor-pointer break-inside-avoid"
              >
                <Checkbox checked={visible} onCheckedChange={() => toggle(u.id)} aria-label={`แสดงปฏิทินของ ${u.name}`} />
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarFallback className="text-[9px] bg-[var(--bg-soft)]">{u.avatar}</AvatarFallback>
                </Avatar>
                <span className={cn("text-sm truncate", !visible && "text-[var(--ink-soft)] line-through")}>
                  {u.name}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {!alwaysExpanded && !filterActive && users.length > COLLAPSED_COUNT && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 mt-2 px-1.5 py-1 text-[11px] font-medium text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)]"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
          {expanded ? "ย่อกลับ" : `ดูเพิ่มเติม (${hiddenCount} คน)`}
        </button>
      )}
    </div>
  );
}
