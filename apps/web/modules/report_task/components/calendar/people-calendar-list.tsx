"use client";

import { useMemo, useState } from "react";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Input } from "@/modules/report_task/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { users, departments, getDepartment, getUser } from "@/modules/report_task/lib/directory";
import { colorPalette, useEventColorStore } from "@/modules/report_task/store/event-color-store";
import { useCalendarVisibilityStore } from "@/modules/report_task/store/calendar-visibility-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useGoogleCalendarStore } from "@/modules/report_task/store/google-calendar-store";
import { cn } from "@/modules/report_task/lib/utils";
import { ChevronDown, Search } from "lucide-react";

const COLLAPSED_COUNT = 8;

/** A stable color per person, cycling through the shared palette by index. */
function colorFor(index: number) {
  return colorPalette[index % colorPalette.length]!.value;
}

/** "ปฏิทินของฉัน" — pinned above the org list, always visible regardless of
 * search/department filter (same idea Outlook's own sidebar uses: "My
 * calendars" never scrolls away with "People's calendars"). Two independent
 * rows, not one: your own regular items (tasks/meetings/leave) and your own
 * connected external calendar used to share a single toggle, so turning one
 * off silently turned the other off too ("กดปิดแล้วมันปิดหมดเลย") — now
 * hiddenUserIds and hiddenGoogleOwnerIds each only ever mean what they say. */
function MyCalendarsSection() {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const hiddenUserIds = useCalendarVisibilityStore((s) => s.hiddenUserIds);
  const toggle = useCalendarVisibilityStore((s) => s.toggle);
  const hiddenGoogleOwnerIds = useCalendarVisibilityStore((s) => s.hiddenGoogleOwnerIds);
  const toggleGoogleOwner = useCalendarVisibilityStore((s) => s.toggleGoogleOwner);
  const linksByUser = useGoogleCalendarStore((s) => s.linksByUser);
  const googleColor = useEventColorStore((s) => s.colors.google);

  const me = getUser(viewingAsUserId);
  const hasExternalCalendar = (linksByUser[viewingAsUserId] ?? []).length > 0;
  const myVisible = !hiddenUserIds.includes(viewingAsUserId);
  const myGoogleVisible = !hiddenGoogleOwnerIds.includes(viewingAsUserId);
  const myColor = colorFor(users.findIndex((u) => u.id === viewingAsUserId));

  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold">ปฏิทินของฉัน</h3>
      <div className="flex flex-col mt-2">
        <label className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-soft)] cursor-pointer">
          <Checkbox checked={myVisible} onCheckedChange={() => toggle(viewingAsUserId)} aria-label="แสดงปฏิทินของฉัน" />
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: myColor }} />
          <span className={cn("text-sm truncate", !myVisible && "text-[var(--ink-soft)] line-through")}>
            {me?.name ?? "ปฏิทินของฉัน"} (ฉัน)
          </span>
        </label>
        {hasExternalCalendar && (
          <label className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-soft)] cursor-pointer">
            <Checkbox
              checked={myGoogleVisible}
              onCheckedChange={() => toggleGoogleOwner(viewingAsUserId)}
              aria-label="แสดงปฏิทินภายนอกของฉัน"
            />
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: googleColor }} />
            <span className={cn("text-sm truncate", !myGoogleVisible && "text-[var(--ink-soft)] line-through")}>
              ปฏิทินภายนอกของฉัน
            </span>
          </label>
        )}
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
}: { singleColumn?: boolean; alwaysExpanded?: boolean }) {
  const hiddenUserIds = useCalendarVisibilityStore((s) => s.hiddenUserIds);
  const toggle = useCalendarVisibilityStore((s) => s.toggle);
  const hideAll = useCalendarVisibilityStore((s) => s.hideAll);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("all");

  // Self moved up into "ปฏิทินของฉัน" above (see MyCalendarsSection) — not
  // repeated a second time down here.
  const others = useMemo(() => users.filter((u) => u.id !== viewingAsUserId), [viewingAsUserId]);
  const filtered = useMemo(
    () =>
      others.filter(
        (u) =>
          (departmentId === "all" || u.departmentId === departmentId) &&
          u.name.toLowerCase().includes(search.trim().toLowerCase())
      ),
    [others, search, departmentId]
  );
  // Filtering narrows the list on its own — collapsing an already-filtered
  // result would just hide matches, so only collapse the unfiltered browse view.
  const filterActive = search.trim() !== "" || departmentId !== "all";
  const visiblePeople =
    alwaysExpanded || filterActive || expanded ? filtered : filtered.slice(0, COLLAPSED_COUNT);
  const hiddenCount = filtered.length - visiblePeople.length;
  const allHidden = others.length > 0 && others.every((u) => hiddenUserIds.includes(u.id));

  return (
    <div>
      <MyCalendarsSection />
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">คนในองค์กร</h3>
        <button
          onClick={() => {
            // Scoped to "others" only, both ways — hiddenUserIds is one flat
            // array shared with "ปฏิทินของฉัน" above, so replacing it outright
            // with just "others" (hideAll's own shape) would silently show
            // your own calendar back if it happened to be hidden. Preserving
            // whatever your own hidden state already was, either direction.
            const mine = hiddenUserIds.includes(viewingAsUserId) ? [viewingAsUserId] : [];
            hideAll(allHidden ? mine : [...mine, ...others.map((u) => u.id)]);
          }}
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
