"use client";

import { useState } from "react";
import Link from "next/link";
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
import type { Department, User } from "@/modules/report_task/types";
import { Building2, Check, Crown, Save, Search, Trash2, Users } from "lucide-react";
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
  const [draft, setDraft] = useState<Department[]>(stored);
  const [search, setSearch] = useState("");
  const filtered = draft.filter((dep) => dep.name.toLowerCase().includes(search.trim().toLowerCase()));

  function update(id: string, patch: Partial<Omit<Department, "id">>) {
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function save() {
    setDepartments(draft);
    toast.success("บันทึกสี/หัวหน้าแผนกแล้ว");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Building2 className="h-4 w-4 text-[var(--ink-soft)]" />
          แผนก
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-0.5">
          รายชื่อแผนกจัดการที่{" "}
          <Link href="/admin/departments" className="underline">
            หลังบ้าน → แผนก
          </Link>{" "}
          (ใช้ร่วมกันทุกโมดูล) — ที่นี่ปรับได้แค่สีกับหัวหน้าแผนกของโมดูลนี้เอง
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
        {draft.length === 0 && (
          <p className="text-sm text-[var(--ink-soft)] text-center py-4">
            ยังไม่มีแผนก — สร้างได้ที่{" "}
            <Link href="/admin/departments" className="underline">
              หลังบ้าน → แผนก
            </Link>
          </p>
        )}
        {draft.length > 0 && filtered.length === 0 && (
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
                <span className="flex-1 text-sm font-medium">{dep.name}</span>
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

      <Button onClick={save}>
        <Save className="h-4 w-4" /> บันทึก
      </Button>
    </div>
  );
}

/** Sibling panel to DepartmentSettingsPanel — same file, same owner-only Settings section. */
export function EmployeeSettingsPanel() {
  const stored = useEmployeeStore((s) => s.employees);
  const setEmployees = useEmployeeStore((s) => s.setEmployees);
  const departments = useDepartmentStore((s) => s.departments);
  const [draft, setDraft] = useState<User[]>(stored);
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
          แผนก/บทบาทของแต่ละคนจัดการที่{" "}
          <Link href="/admin/users" className="underline">
            หลังบ้าน → ผู้ใช้งาน
          </Link>
          {" "}— &quot;เจ้าของบริษัท&quot; (เห็น/แก้ได้ทุกอย่างโดยไม่จำกัดแผนก) ค่าเริ่มต้นมาจากบทบาท
          ผู้ดูแลบริษัท/CEO ที่ /admin แต่ยกเว้นเฉพาะคนได้ที่นี่ — ติ๊กออกได้แม้ยังถือบทบาทนั้นอยู่
          โดยไม่กระทบสิทธิ์เมนู/RBAC จริงเลย
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
              <span className="inline-flex items-center rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-2.5 py-1.5 text-xs text-[var(--ink-soft)]">
                {u.role || "ไม่ระบุตำแหน่ง"}
              </span>
              <span className="inline-flex items-center rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-2.5 py-1.5 text-xs text-[var(--ink-soft)]">
                {departments.find((d) => d.id === u.departmentId)?.name ?? "ไม่ระบุแผนก"}
              </span>
              <label className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)] cursor-pointer">
                <Checkbox checked={u.isOwner ?? false} onCheckedChange={(v) => update(u.id, { isOwner: v === true })} />
                เจ้าของบริษัท
              </label>
            </div>
          </div>
        ))}
      </div>

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
