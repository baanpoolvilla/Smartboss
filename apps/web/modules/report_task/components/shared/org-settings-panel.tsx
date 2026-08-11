"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/modules/report_task/components/ui/alert-dialog";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { colorPalette } from "@/modules/report_task/store/event-color-store";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import type { Department, User } from "@/modules/report_task/types";
import { Building2, Check, Crown, Plus, Save, Search, Trash2, Users } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";
import { toast } from "sonner";

/**
 * Owner-only: manage the company's real org structure (departments +
 * employees) — company-wide config, lives on the settings page
 * (src/app/settings/page.tsx, "permissions" tab, same owner-only gate as
 * SettingsAccessPanel). This is the data every other page's department
 * dropdowns/pickers, task assignment, and Report-room visibility already
 * read through `@/data/mock`'s `departments`/`users` (a live view over
 * these two stores — see mock.ts) — so an edit here takes effect
 * everywhere else in the app, not just in this panel.
 */
export function DepartmentSettingsPanel() {
  const stored = useDepartmentStore((s) => s.departments);
  const setDepartments = useDepartmentStore((s) => s.setDepartments);
  const employees = useEmployeeStore((s) => s.employees);
  const reportTopics = useReportFeedStore((s) => s.topics);
  const [draft, setDraft] = useState<Department[]>(stored);
  const [newName, setNewName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [search, setSearch] = useState("");
  const filtered = draft.filter((dep) => dep.name.toLowerCase().includes(search.trim().toLowerCase()));

  function update(id: string, patch: Partial<Omit<Department, "id">>) {
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  // Checked against the *committed* employees/rooms, not this panel's own
  // draft — deleting a department is only safe once nobody actually
  // assigned to it (or scoped Report room) exists anymore.
  function blockReason(dep: Department): string | null {
    const memberCount = employees.filter((u) => u.departmentId === dep.id).length;
    if (memberCount > 0) return `ยังมีพนักงาน ${memberCount} คนอยู่ในแผนกนี้ — ย้ายออกก่อนถึงจะลบได้`;
    const roomCount = reportTopics.filter((t) => t.visibility?.departmentIds?.includes(dep.id)).length;
    if (roomCount > 0) return `ยังมีหัวข้อ Report ${roomCount} ห้องผูกกับแผนกนี้อยู่ — แก้ไข/ลบห้องนั้นก่อน`;
    return null;
  }

  function requestRemove(dep: Department) {
    const reason = blockReason(dep);
    if (reason) {
      toast.error(reason);
      return;
    }
    setDeleteTarget(dep);
  }

  function confirmRemove() {
    if (!deleteTarget) return;
    setDraft((d) => d.filter((x) => x.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  function add() {
    const name = newName.trim();
    if (!name) return;
    setDraft((d) => [
      ...d,
      { id: `dep-${crypto.randomUUID()}`, name, color: colorPalette[d.length % colorPalette.length]!.value, headId: "" },
    ]);
    setNewName("");
  }

  function save() {
    setDepartments(draft);
    toast.success("บันทึกรายชื่อแผนกแล้ว");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Building2 className="h-4 w-4 text-[var(--ink-soft)]" />
          จัดการแผนก
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-0.5">
          เพิ่ม แก้ไข หรือลบแผนก — ใช้ร่วมกันทั้งระบบ (มอบหมายงาน, สิทธิ์เห็นห้อง Report, กราฟแยกแผนก ฯลฯ)
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ink-soft)]" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อแผนก..."
          className="pl-8"
        />
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-sm text-[var(--ink-soft)] text-center py-4">ไม่พบแผนกที่ค้นหา</p>
        )}
        {filtered.map((dep) => {
          const deptEmployees = employees.filter((u) => u.departmentId === dep.id);
          return (
            <div key={dep.id} className="rounded-lg border border-[var(--line)] p-2 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 shrink-0">
                  {colorPalette.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => update(dep.id, { color: c.value })}
                      title={c.name}
                      aria-label={`เลือกสี ${c.name}`}
                      className="h-5 w-5 rounded-full flex items-center justify-center ring-1 ring-black/5 shrink-0"
                      style={{ backgroundColor: c.value }}
                    >
                      {dep.color === c.value && <Check className="h-3 w-3 text-white" />}
                    </button>
                  ))}
                </div>
                <Input value={dep.name} onChange={(e) => update(dep.id, { name: e.target.value })} className="flex-1" />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => requestRemove(dep)}
                  aria-label={`ลบแผนก ${dep.name}`}
                >
                  <Trash2 className="h-4 w-4 text-[var(--ink-soft)]" />
                </Button>
              </div>
              <div className="flex items-center gap-2 pl-1">
                <span className="flex items-center gap-1 text-xs text-[var(--ink-soft)] shrink-0 w-24">
                  <Crown className="h-3 w-3" /> หัวหน้าแผนก
                </span>
                <Select value={dep.headId || undefined} onValueChange={(v) => v && update(dep.id, { headId: v })}>
                  <SelectTrigger className="w-56">
                    <SelectValue>{deptEmployees.find((u) => u.id === dep.headId)?.name ?? "ยังไม่ได้เลือก"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {deptEmployees.length === 0 ? (
                      <SelectItem value="_none" disabled>ยังไม่มีพนักงานในแผนกนี้</SelectItem>
                    ) : (
                      deptEmployees.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <span className="flex items-center gap-1 text-[11px] text-[var(--ink-soft)]">
                  <Users className="h-3 w-3" /> {deptEmployees.length} คน
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--line)] p-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="ชื่อแผนกใหม่ เช่น ฝ่ายบัญชี"
          className="flex-1"
        />
        <Button variant="outline" size="icon" onClick={add} aria-label="เพิ่มแผนก">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Button onClick={save}>
        <Save className="h-4 w-4" /> บันทึก
      </Button>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบแผนก &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>ย้อนกลับไม่ได้ — ต้องกด &quot;บันทึก&quot; ด้านล่างเพื่อยืนยันจริง</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction className="bg-[var(--chart-red)] hover:bg-red-700 text-white" onClick={confirmRemove}>
              ลบแผนก
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function initialsOf(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 2) : "??";
}

/** Sibling panel to DepartmentSettingsPanel — same file, same owner-only Settings section. */
export function EmployeeSettingsPanel() {
  const stored = useEmployeeStore((s) => s.employees);
  const setEmployees = useEmployeeStore((s) => s.setEmployees);
  const departments = useDepartmentStore((s) => s.departments);
  const [draft, setDraft] = useState<User[]>(stored);
  const [newName, setNewName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const filtered = draft.filter(
    (u) =>
      (departmentFilter === "all" || u.departmentId === departmentFilter) &&
      u.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  function update(id: string, patch: Partial<Omit<User, "id">>) {
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  // Checked against committed departments — an employee currently set as a
  // department's head can't be removed until someone else takes over, and
  // the last remaining owner can't be removed at all (the company always
  // needs at least one).
  function blockReason(u: User): string | null {
    if (departments.some((d) => d.headId === u.id)) return `${u.name} เป็นหัวหน้าแผนกอยู่ — เปลี่ยนหัวหน้าแผนกก่อนถึงจะลบได้`;
    if (u.isOwner && draft.filter((x) => x.isOwner).length <= 1) return "ต้องมีเจ้าของบริษัทอย่างน้อย 1 คนเสมอ";
    return null;
  }

  function requestRemove(u: User) {
    const reason = blockReason(u);
    if (reason) {
      toast.error(reason);
      return;
    }
    setDeleteTarget(u);
  }

  function confirmRemove() {
    if (!deleteTarget) return;
    setDraft((d) => d.filter((x) => x.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  function add() {
    const name = newName.trim();
    if (!name || departments.length === 0) return;
    setDraft((d) => [
      ...d,
      {
        id: `usr-${crypto.randomUUID()}`,
        name,
        email: "",
        avatar: initialsOf(name),
        role: "",
        departmentId: departments[0]!.id,
      },
    ]);
    setNewName("");
  }

  function save() {
    setEmployees(draft);
    toast.success("บันทึกรายชื่อพนักงานแล้ว");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Users className="h-4 w-4 text-[var(--ink-soft)]" />
          จัดการพนักงาน
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-0.5">
          เพิ่ม แก้ไข ลบ หรือย้ายพนักงานข้ามแผนกได้เอง — ตั้ง &quot;เจ้าของบริษัท&quot; ให้เห็น/แก้ได้ทุกอย่างโดยไม่จำกัดแผนก
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ink-soft)]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อพนักงาน..."
            className="pl-8"
          />
        </div>
        <Select value={departmentFilter} onValueChange={(v) => v && setDepartmentFilter(v)}>
          <SelectTrigger className="w-44 shrink-0">
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

      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-sm text-[var(--ink-soft)] text-center py-4">ไม่พบพนักงานที่ค้นหา</p>
        )}
        {filtered.map((u) => (
          <div key={u.id} className="rounded-lg border border-[var(--line)] p-2 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={u.avatar}
                onChange={(e) => update(u.id, { avatar: e.target.value.slice(0, 2) })}
                className="w-12 text-center shrink-0"
                title="ชื่อย่อ (2 ตัวอักษร)"
                maxLength={2}
              />
              <Input value={u.name} onChange={(e) => update(u.id, { name: e.target.value })} placeholder="ชื่อ-นามสกุล" className="flex-1 min-w-0" />
              <Button variant="ghost" size="icon" onClick={() => requestRemove(u)} aria-label={`ลบพนักงาน ${u.name}`}>
                <Trash2 className="h-4 w-4 text-[var(--ink-soft)]" />
              </Button>
            </div>
            <div className="flex items-center gap-2 pl-1 flex-wrap">
              <Input
                value={u.email}
                onChange={(e) => update(u.id, { email: e.target.value })}
                placeholder="อีเมล"
                className="w-52"
              />
              <Input
                value={u.role}
                onChange={(e) => update(u.id, { role: e.target.value })}
                placeholder="ตำแหน่ง เช่น หัวหน้าฝ่ายขาย"
                className="w-48"
              />
              <Select value={u.departmentId} onValueChange={(v) => v && update(u.id, { departmentId: v })}>
                <SelectTrigger className="w-40">
                  <SelectValue>{departments.find((d) => d.id === u.departmentId)?.name ?? "เลือกแผนก"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)] cursor-pointer">
                <Checkbox checked={u.isOwner ?? false} onCheckedChange={(v) => update(u.id, { isOwner: v === true })} />
                เจ้าของบริษัท
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--line)] p-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="ชื่อพนักงานใหม่"
          className={cn("flex-1", departments.length === 0 && "opacity-50")}
          disabled={departments.length === 0}
        />
        <Button variant="outline" size="icon" onClick={add} aria-label="เพิ่มพนักงาน" disabled={departments.length === 0}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {departments.length === 0 && (
        <p className="text-[11px] text-[var(--ink-soft)]">สร้างแผนกอย่างน้อย 1 แผนกก่อน ถึงจะเพิ่มพนักงานได้</p>
      )}

      <Button onClick={save}>
        <Save className="h-4 w-4" /> บันทึก
      </Button>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบพนักงาน &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>ย้อนกลับไม่ได้ — ต้องกด &quot;บันทึก&quot; ด้านล่างเพื่อยืนยันจริง</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction className="bg-[var(--chart-red)] hover:bg-red-700 text-white" onClick={confirmRemove}>
              ลบพนักงาน
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
