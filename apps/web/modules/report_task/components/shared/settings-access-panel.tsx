"use client";

import { useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Input } from "@/modules/report_task/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { getDepartment, departments, users } from "@/modules/report_task/lib/directory";
import { useSettingsAccessStore, type GrantableSection } from "@/modules/report_task/store/settings-access-store";
import { toast } from "sonner";
import { ShieldCheck, Smile, Ticket, CalendarOff, FolderTree, Search, Tag } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

const grantableSections: { key: GrantableSection; label: string; icon: typeof Smile }[] = [
  { key: "stickers", label: "สติกเกอร์ & คะแนน", icon: Smile },
  { key: "leaveTypes", label: "ประเภทการลา", icon: Ticket },
  { key: "routineDayoff", label: "วันหยุดประจำ", icon: CalendarOff },
  { key: "reportTopics", label: "สร้าง/ลบหัวข้อ Report", icon: FolderTree },
  { key: "projectTopics", label: "หัวข้อโปรเจค", icon: Tag },
];

/**
 * Owner-only: grant specific employees access to specific company-tab
 * settings sections without making them a department head or owner —
 * section-level, matching the tab's own sectionsByTab.company keys.
 * Staged locally per row and committed with one Save, same shape as the
 * other company settings panels on this page.
 */
export function SettingsAccessPanel() {
  const grants = useSettingsAccessStore((s) => s.grants);
  const setGrant = useSettingsAccessStore((s) => s.setGrant);
  const [draft, setDraft] = useState<Record<string, GrantableSection[]>>(grants);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");

  const employees = users.filter((u) => !u.isOwner);
  const filteredEmployees = employees.filter(
    (u) =>
      (departmentFilter === "all" || u.departmentId === departmentFilter) &&
      u.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  function toggle(userId: string, section: GrantableSection) {
    setDraft((d) => {
      const current = d[userId] ?? grants[userId] ?? [];
      const next = current.includes(section) ? current.filter((s) => s !== section) : [...current, section];
      return { ...d, [userId]: next };
    });
    setDirty(true);
  }

  function sectionsFor(userId: string): GrantableSection[] {
    return draft[userId] ?? grants[userId] ?? [];
  }

  function save() {
    for (const u of employees) {
      setGrant(u.id, sectionsFor(u.id));
    }
    setDirty(false);
    toast.success("บันทึกสิทธิ์การตั้งค่าแล้ว");
  }

  return (
    <div className="rounded-lg border border-[var(--line)] overflow-hidden">
      <div className="p-4 pb-3.5 border-b border-[var(--line)] bg-[var(--bg-soft)]/60">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--brand-green-dark)] shrink-0">
            <ShieldCheck className="h-4 w-4" />
          </span>
          สิทธิ์การตั้งค่า
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          ให้พนักงานคนใดคนหนึ่งเข้าถึงหมวดตั้งค่าบริษัทบางหมวดได้ โดยไม่ต้องเลื่อนเป็นหัวหน้าแผนกหรือเจ้าของบริษัท
        </p>
      </div>

      <div className="p-4 space-y-1">
        <div className="flex items-center gap-2 flex-wrap pb-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ink-soft)]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อพนักงาน..."
              className="pl-8 h-8"
            />
          </div>
          <Select value={departmentFilter} onValueChange={(v) => v && setDepartmentFilter(v)}>
            <SelectTrigger className="w-44 shrink-0 h-8">
              <SelectValue>{departmentFilter === "all" ? "ทุกแผนก" : departments.find((d) => d.id === departmentFilter)?.name ?? "ทุกแผนก"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกแผนก</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-[1fr_repeat(4,7.5rem)] gap-2 px-2 pb-2 text-[11px] font-medium text-[var(--ink-soft)]">
          <span>พนักงาน</span>
          {grantableSections.map((s) => (
            <span key={s.key} className="text-center">{s.label}</span>
          ))}
        </div>

        <div className="max-h-96 overflow-y-auto space-y-0.5">
          {filteredEmployees.length === 0 && (
            <p className="text-sm text-[var(--ink-soft)] text-center py-4">ไม่พบพนักงานที่ค้นหา</p>
          )}
          {filteredEmployees.map((u) => {
            const dept = getDepartment(u.departmentId);
            const sections = sectionsFor(u.id);
            return (
              <div
                key={u.id}
                className={cn(
                  "grid grid-cols-[1fr_repeat(4,7.5rem)] items-center gap-2 rounded-lg px-2 py-2 text-sm",
                  sections.length > 0 && "bg-[var(--bg-soft)]/60"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarImage src={u.avatarUrl ?? undefined} alt={u.name} />
                    <AvatarFallback className="text-[11px]">{u.avatar}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate font-medium leading-tight">{u.name}</p>
                    <p className="truncate text-[11px] text-[var(--ink-soft)] leading-tight">{dept?.name ?? u.role}</p>
                  </div>
                </div>
                {grantableSections.map((s) => (
                  <div key={s.key} className="flex justify-center">
                    <Checkbox
                      checked={sections.includes(s.key)}
                      onCheckedChange={() => toggle(u.id, s.key)}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={save} disabled={!dirty}>บันทึก</Button>
        </div>
      </div>
    </div>
  );
}
