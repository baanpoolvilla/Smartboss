"use client";

import { useState } from "react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { departments, getUser } from "@/modules/report_task/lib/directory";
import { useRoutineDayOffStore } from "@/modules/report_task/store/routine-dayoff-store";
import { CalendarOff, Wand2, Building2, Users, Save } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

interface Draft {
  companyMonthlyQuota: number;
  useDepartmentOverrides: boolean;
  departmentQuotas: Record<string, number>;
}

/** Routine day-off quotas — owner-only company config, lives on the settings page (src/app/settings/page.tsx). */
export function RoutineDayOffSettingsPanel() {
  const companyMonthlyQuota = useRoutineDayOffStore((s) => s.companyMonthlyQuota);
  const useDepartmentOverrides = useRoutineDayOffStore((s) => s.useDepartmentOverrides);
  const departmentQuotas = useRoutineDayOffStore((s) => s.departmentQuotas);
  const setRoutineSettings = useRoutineDayOffStore((s) => s.setRoutineSettings);

  const [draft, setDraft] = useState<Draft>({ companyMonthlyQuota, useDepartmentOverrides, departmentQuotas });

  function save() {
    setRoutineSettings(draft);
  }

  return (
    <div className="rounded-lg border border-[var(--line)] overflow-hidden">
      <div className="p-4 pb-3.5 border-b border-[var(--line)] bg-[var(--bg-soft)]/60">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--brand-green-dark)] shrink-0">
            <CalendarOff className="h-4 w-4" />
          </span>
          ตั้งค่าวันหยุดประจำ
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          กำหนดว่าพนักงานเลือกวันหยุดของตัวเองได้เดือนละกี่วัน — ถ้าเลือกเกินโควตาจะลงเพิ่มไม่ได้ — แผนกที่เพิ่มเข้าระบบใหม่จะโผล่ในนี้ให้เองอัตโนมัติ
        </p>
      </div>

      <div className="p-4 space-y-4">
          {/* Same-for-everyone vs. per-department, as a segmented toggle
              (matches ShareToggle/TargetToggle elsewhere) instead of a
              dropdown — both choices are visible and one click apart. */}
          <div className="inline-flex w-full rounded-lg bg-[var(--bg-soft)] p-1 text-sm">
            {([
              { key: false, label: "ใช้ค่าเดียวกันทั้งบริษัท", icon: Users },
              { key: true, label: "กำหนดแยกตามแผนก", icon: Building2 },
            ] as const).map((opt) => (
              <button
                key={String(opt.key)}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, useDepartmentOverrides: opt.key }))}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium transition-colors",
                  draft.useDepartmentOverrides === opt.key
                    ? "bg-white shadow-sm text-[var(--ink)]"
                    : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                )}
              >
                <opt.icon className="h-3.5 w-3.5" />
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3.5 py-3">
            <div>
              <p className="text-sm font-medium">
                {draft.useDepartmentOverrides ? "ค่าเริ่มต้น" : "โควตาบริษัท"}
              </p>
              {draft.useDepartmentOverrides && <p className="text-[11px] text-[var(--ink-soft)]">ใช้กับแผนกที่ยังไม่ได้ตั้งค่าของตัวเอง</p>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Input
                type="number"
                min={0}
                value={draft.companyMonthlyQuota}
                onChange={(e) => setDraft((d) => ({ ...d, companyMonthlyQuota: Number(e.target.value) }))}
                className="w-16 text-center"
              />
              <span className="text-xs text-[var(--ink-soft)] whitespace-nowrap">วัน/เดือน</span>
            </div>
          </div>

          {draft.useDepartmentOverrides && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--ink-soft)]">โควตาต่อแผนก ({departments.length} แผนก)</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 text-[var(--brand-green-dark)] hover:text-[var(--brand-green-dark)]"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      departmentQuotas: Object.fromEntries(departments.map((dep) => [dep.id, d.companyMonthlyQuota])),
                    }))
                  }
                >
                  <Wand2 className="h-3.5 w-3.5" /> ใช้ค่าเดียวกันทุกแผนก
                </Button>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-0.5">
                {departments.map((d) => {
                  const head = d.headId ? getUser(d.headId) : undefined;
                  return (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] px-3 py-2 hover:border-[var(--brand-green)]/40 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{d.name}</p>
                          {head && <p className="text-[11px] text-[var(--ink-soft)] truncate">หัวหน้า: {head.name}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Input
                          type="number"
                          min={0}
                          value={draft.departmentQuotas[d.id] ?? draft.companyMonthlyQuota}
                          onChange={(e) =>
                            setDraft((dr) => ({
                              ...dr,
                              departmentQuotas: { ...dr.departmentQuotas, [d.id]: Number(e.target.value) },
                            }))
                          }
                          className="w-16 text-center"
                        />
                        <span className="text-xs text-[var(--ink-soft)] whitespace-nowrap">วัน/เดือน</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <Button onClick={save}>
          <Save className="h-4 w-4" /> บันทึก
        </Button>
      </div>
  );
}

