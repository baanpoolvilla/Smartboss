"use client";

import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { departments, users } from "@/modules/report_task/lib/directory";
import { usePeopleGroupStore } from "@/modules/report_task/store/people-group-store";
import { cn } from "@/modules/report_task/lib/utils";
import { Check, ChevronDown, Save, Search, Trash2 } from "lucide-react";

const COLLAPSED_COUNT = 5;
const TRIGGER_VISIBLE_COUNT = 4;

/**
 * Multi-select people picker with per-department "select all" and named,
 * reusable saved groups (e.g. "ทีมการตลาด") — for meeting attendees, or
 * anywhere else a plain assignee list gets unwieldy with a large roster.
 */
export function AttendeePicker({
  value,
  onChange,
  placeholder = "เลือกผู้เข้าร่วม...",
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}) {
  const groups = usePeopleGroupStore((s) => s.groups);
  const addGroup = usePeopleGroupStore((s) => s.addGroup);
  const removeGroup = usePeopleGroupStore((s) => s.removeGroup);
  const [saving, setSaving] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  function toggleExpanded(deptId: string) {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  }

  const byDept = useMemo(() => {
    const q = query.trim().toLowerCase();
    return departments.map((d) => ({
      dept: d,
      people: users.filter((u) => u.departmentId === d.id && (q === "" || u.name.toLowerCase().includes(q))),
    }));
  }, [query]);
  const hasQuery = query.trim() !== "";

  function toggle(userId: string) {
    onChange(value.includes(userId) ? value.filter((id) => id !== userId) : [...value, userId]);
  }

  function toggleDept(deptUserIds: string[]) {
    const allSelected = deptUserIds.every((id) => value.includes(id));
    onChange(
      allSelected
        ? value.filter((id) => !deptUserIds.includes(id))
        : [...new Set([...value, ...deptUserIds])]
    );
  }

  const allUserIds = useMemo(() => users.map((u) => u.id), []);
  const everyoneSelected = allUserIds.every((id) => value.includes(id));
  function toggleAll() {
    onChange(everyoneSelected ? [] : allUserIds);
  }

  function applyGroup(userIds: string[]) {
    onChange([...new Set([...value, ...userIds])]);
  }

  function saveGroup() {
    const name = groupName.trim();
    if (!name || value.length === 0) return;
    addGroup(name, value);
    setGroupName("");
    setSaving(false);
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button className="w-full flex items-center gap-1.5 flex-wrap border border-[var(--line)] rounded-lg px-2 py-1.5 min-h-9 text-left hover:border-[var(--brand-green)] transition-colors">
            {value.length === 0 ? (
              <span className="text-sm text-[var(--ink-soft)]">{placeholder}</span>
            ) : (
              <>
                {value.slice(0, TRIGGER_VISIBLE_COUNT).map((id) => {
                  const u = users.find((usr) => usr.id === id);
                  return (
                    <span key={id} className="flex items-center gap-1 bg-[var(--bg-soft)] rounded-full pl-0.5 pr-2 py-0.5 text-xs">
                      <Avatar className="h-4 w-4">
                        <AvatarImage src={u?.avatarUrl ?? undefined} alt={u?.name} />
                        <AvatarFallback className="text-[8px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{u?.avatar}</AvatarFallback>
                      </Avatar>
                      {u?.name}
                    </span>
                  );
                })}
                {value.length > TRIGGER_VISIBLE_COUNT && (
                  <span className="text-xs font-medium text-[var(--ink-soft)] px-1">
                    +{value.length - TRIGGER_VISIBLE_COUNT} คน
                  </span>
                )}
              </>
            )}
          </button>
        }
      />
      <PopoverContent align="start" className="w-72 p-0 max-h-96 overflow-y-auto">
        {groups.length > 0 && (
          <div className="p-2 border-b border-[var(--line)] space-y-1.5">
            <p className="text-[11px] font-medium text-[var(--ink-soft)] px-1">กลุ่มที่บันทึกไว้</p>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <span key={g.id} className="group inline-flex items-center gap-1 rounded-full bg-[var(--bg-soft)] pl-2.5 pr-1 py-0.5">
                  <button onClick={() => applyGroup(g.userIds)} className="text-xs font-medium hover:text-[var(--brand-green-dark)]">
                    {g.name} ({g.userIds.length})
                  </button>
                  <button
                    onClick={() => removeGroup(g.id)}
                    className="text-[var(--ink-soft)] hover:text-[var(--chart-red)] rounded-full p-0.5"
                    aria-label={`ลบกลุ่ม ${g.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="p-2 border-b border-[var(--line)]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ink-soft)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อ..."
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        {!hasQuery && (
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--line)]">
            <span className="text-xs font-semibold text-[var(--ink)]">ทุกคน ({users.length} คน)</span>
            <button
              onClick={toggleAll}
              className="text-[11px] font-medium text-[var(--brand-green-dark)] hover:underline"
            >
              {everyoneSelected ? "ล้างการเลือกทั้งหมด" : "เลือกทั้งหมด"}
            </button>
          </div>
        )}

        <div className="p-1">
          {hasQuery && byDept.every(({ people }) => people.length === 0) && (
            <p className="text-sm text-[var(--ink-soft)] text-center py-4">ไม่พบคนที่ค้นหา</p>
          )}
          {byDept.map(({ dept, people }) => {
            if (people.length === 0) return null;
            const deptIds = people.map((u) => u.id);
            const allSelected = deptIds.every((id) => value.includes(id));
            const expanded = hasQuery || expandedDepts.has(dept.id);
            const visiblePeople = expanded ? people : people.slice(0, COLLAPSED_COUNT);
            const hiddenCount = people.length - visiblePeople.length;
            return (
              <div key={dept.id} className="py-1">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[11px] font-semibold text-[var(--ink-soft)] uppercase tracking-wide">{dept.name}</span>
                  <button
                    onClick={() => toggleDept(deptIds)}
                    className="text-[11px] font-medium text-[var(--brand-green-dark)] hover:underline"
                  >
                    {allSelected ? "ล้างการเลือกทั้งหมด" : "เลือกทั้งหมด"}
                  </button>
                </div>
                {visiblePeople.map((u) => {
                  const selected = value.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      onClick={() => toggle(u.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-soft)] text-left"
                    >
                      <span className={cn("h-4 w-4 rounded border flex items-center justify-center shrink-0", selected ? "bg-[var(--brand-green)] border-[var(--brand-green)]" : "border-[var(--line)]")}>
                        {selected && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={u.avatarUrl ?? undefined} alt={u.name} />
                        <AvatarFallback className="text-[9px] bg-[var(--bg-soft)]">{u.avatar}</AvatarFallback>
                      </Avatar>
                      <span className="flex-1 text-sm truncate">{u.name}</span>
                    </button>
                  );
                })}
                {!hasQuery && (hiddenCount > 0 || expanded) && people.length > COLLAPSED_COUNT && (
                  <button
                    onClick={() => toggleExpanded(dept.id)}
                    className="w-full flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)]"
                  >
                    <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
                    {expanded ? "ย่อกลับ" : `ดูเพิ่มเติม (${hiddenCount} คน)`}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-2 border-t border-[var(--line)]">
          {saving ? (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveGroup()}
                placeholder="ตั้งชื่อกลุ่ม เช่น ทีมการตลาด"
                className="h-8 text-sm"
              />
              <Button size="sm" className="h-8 shrink-0 bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white" onClick={saveGroup}>
                บันทึก
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setSaving(true)}
              disabled={value.length === 0}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)] disabled:opacity-40 disabled:hover:text-[var(--ink-soft)] py-1"
            >
              <Save className="h-3.5 w-3.5" /> บันทึกรายชื่อที่เลือกเป็นกลุ่ม
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
