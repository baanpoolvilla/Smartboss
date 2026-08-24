"use client";

import { useMemo, useState } from "react";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Input } from "@/modules/report_task/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { users, departments, getDepartment } from "@/modules/report_task/lib/directory";
import { colorPalette } from "@/modules/report_task/store/event-color-store";
import { useCalendarVisibilityStore } from "@/modules/report_task/store/calendar-visibility-store";
import { cn } from "@/modules/report_task/lib/utils";
import { ChevronDown, Search } from "lucide-react";

const COLLAPSED_COUNT = 8;

/** A stable color per person, cycling through the shared palette by index. */
function colorFor(index: number) {
  return colorPalette[index % colorPalette.length]!.value;
}

/** Outlook-style "People's calendars" — toggle whose tasks/meetings/leave show. */
export function PeopleCalendarList({ singleColumn = false }: { singleColumn?: boolean }) {
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
  const visiblePeople = filterActive || expanded ? filtered : filtered.slice(0, COLLAPSED_COUNT);
  const hiddenCount = filtered.length - visiblePeople.length;
  const allHidden = hiddenUserIds.length >= users.length;

  return (
    <div>
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
          {/* alignItemWithTrigger (the Select default) aligns the currently
              selected row exactly over the trigger — its positioning math
              needs real room to measure against, and inside this dialog on a
              short mobile viewport it was instead visibly shoving the whole
              dialog sideways off-screen when opened (screenshot: cut off
              past the right edge), snapping back once closed. A plain
              anchor-below-trigger dropdown doesn't need that measurement at
              all — this filter doesn't benefit from the aligned-item style
              anyway (it's not a many-item native-select stand-in). */}
          <SelectContent alignItemWithTrigger={false}>
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
      {!filterActive && users.length > COLLAPSED_COUNT && (
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
