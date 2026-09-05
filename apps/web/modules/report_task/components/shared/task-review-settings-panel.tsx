"use client";

import { useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { getDepartment, departments, users } from "@/modules/report_task/lib/directory";
import { useTaskReviewSettingsStore } from "@/modules/report_task/store/task-review-settings-store";
import { toast } from "sonner";
import { ShieldCheck, Search, Save } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * Who's allowed to mark a done task "ผ่าน/ไม่ผ่าน" (see canReviewTask in
 * permissions.ts) — the company-wide owner always can, on top of whatever's
 * configured here:
 *   - หัวหน้าแผนก toggle: on by default, off centralizes review to just the
 *     owner + the manual list below (a company that wants every sign-off to
 *     go through one place instead of per-department).
 *   - รายชื่อเพิ่มเติม: specific people trusted to review regardless of
 *     department or head status — e.g. a senior employee who isn't an
 *     official head.
 * Staged locally and committed with one Save, same shape as the other
 * company settings panels on this page (AttachmentSettingsPanel,
 * SettingsAccessPanel).
 */
export function TaskReviewSettingsPanel() {
  const settings = useTaskReviewSettingsStore((s) => s.settings);
  const setHeadsCanReview = useTaskReviewSettingsStore((s) => s.setHeadsCanReview);
  const setExtraReviewerIds = useTaskReviewSettingsStore((s) => s.setExtraReviewerIds);

  const [draftHeadsCanReview, setDraftHeadsCanReview] = useState(settings.headsCanReview);
  const [draftExtraIds, setDraftExtraIds] = useState<string[]>(settings.extraReviewerIds);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");

  const employees = users.filter((u) => !u.isOwner);
  const filteredEmployees = employees.filter(
    (u) =>
      (departmentFilter === "all" || u.departmentId === departmentFilter) &&
      u.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  function toggleExtra(userId: string) {
    setDraftExtraIds((ids) => (ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId]));
    setDirty(true);
  }

  function save() {
    setHeadsCanReview(draftHeadsCanReview);
    setExtraReviewerIds(draftExtraIds);
    setDirty(false);
    toast.success("บันทึกการตั้งค่าการตรวจงานแล้ว");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--ink-soft)]" />
          การตรวจงาน
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-0.5">
          กำหนดว่าใครกดปุ่ม &ldquo;ผ่าน/ไม่ผ่าน&rdquo; ให้งานที่เสร็จแล้วได้บ้าง — เจ้าของบริษัทกดได้เสมอ ไม่ว่าจะตั้งค่านี้อย่างไร
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-[var(--line)] p-3">
        <div className="min-w-0 flex-1">
          <Label className="text-sm font-medium">ให้หัวหน้าแผนกตรวจงานได้</Label>
          <p className="text-xs text-[var(--ink-soft)]">
            ปิดไว้เพื่อรวมศูนย์การตรวจไว้ที่เจ้าของบริษัทกับรายชื่อเพิ่มเติมด้านล่างเท่านั้น
          </p>
        </div>
        <Switch
          checked={draftHeadsCanReview}
          onCheckedChange={(v) => {
            setDraftHeadsCanReview(v);
            setDirty(true);
          }}
        />
      </div>

      <div className="space-y-2">
        <div>
          <Label className="text-sm font-medium">ผู้ตรวจงานเพิ่มเติม</Label>
          <p className="text-xs text-[var(--ink-soft)]">
            ให้สิทธิ์ตรวจงานเป็นรายคน โดยไม่ต้องเลื่อนเป็นหัวหน้าแผนก — ตรวจได้ทุกงานไม่จำกัดแผนก
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
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

        <div className="max-h-80 overflow-y-auto rounded-lg border border-[var(--line)] divide-y divide-[var(--line)]">
          {filteredEmployees.length === 0 && (
            <p className="text-sm text-[var(--ink-soft)] text-center py-4">ไม่พบพนักงานที่ค้นหา</p>
          )}
          {filteredEmployees.map((u) => {
            const dept = getDepartment(u.departmentId);
            const checked = draftExtraIds.includes(u.id);
            return (
              <label
                key={u.id}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm cursor-pointer",
                  checked && "bg-[var(--bg-soft)]/60"
                )}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggleExtra(u.id)} />
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarImage src={u.avatarUrl ?? undefined} alt={u.name} />
                  <AvatarFallback className="text-[11px]">{u.avatar}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium leading-tight">{u.name}</p>
                  <p className="truncate text-[11px] text-[var(--ink-soft)] leading-tight">{dept?.name ?? u.role}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <Button onClick={save} disabled={!dirty}>
        <Save className="h-4 w-4" /> บันทึก
      </Button>
    </div>
  );
}
