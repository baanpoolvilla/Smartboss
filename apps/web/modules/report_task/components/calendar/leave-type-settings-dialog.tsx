"use client";

import { createElement, useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/modules/report_task/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { useLeaveTypeStore, type LeaveQuotaMode, type LeaveTypeDef } from "@/modules/report_task/store/leave-type-store";
import { colorPalette } from "@/modules/report_task/store/event-color-store";
import { useHolidayStore, THAI_SOURCE, importCountryHolidays } from "@/modules/report_task/store/holiday-store";
import { countryHolidayGrantResolver } from "@/modules/report_task/lib/holiday-grant";
import { leaveIconRegistry, leaveIconNames, leaveIconOf } from "@/modules/report_task/lib/leave-icons";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import { cn } from "@/modules/report_task/lib/utils";
import { Plus, Trash2, Check, Loader2, ChevronLeft, ChevronRight, Save, Info } from "lucide-react";
import { toast } from "sonner";

interface Country {
  countryCode: string;
  name: string;
}

const THAILAND: Country = { countryCode: THAI_SOURCE, name: "ไทย (Thailand)" };
const currentMonthKey = () => new Date().toISOString().slice(0, 7);
function shiftMonthKey(monthKey: string, delta: number): string {
  // monthKey เป็นรูปแบบ "YYYY-MM" ที่ระบบสร้างเอง
  const [y, m] = monthKey.split("-").map(Number) as [number, number];
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthKeyLabel(monthKey: string): string {
  return new Date(`${monthKey}-01T00:00:00`).toLocaleDateString("th-TH-u-ca-gregory", { month: "long", year: "numeric" });
}

function IconPicker({ value, onChange, color }: { value: string; onChange: (v: string) => void; color: string }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button className="h-9 w-9 rounded-md border border-[var(--line)] flex items-center justify-center hover:bg-[var(--bg-soft)]" title="เลือกไอคอน" aria-label="เลือกไอคอน">
            {createElement(leaveIconOf(value), { className: "h-4 w-4", style: { color } })}
          </button>
        }
      />
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-6 gap-1.5">
          {leaveIconNames.map((name) => (
            <button
              key={name}
              onClick={() => onChange(name)}
              className={cn("h-8 w-8 rounded-md flex items-center justify-center hover:bg-[var(--bg-soft)]", value === name && "ring-2 ring-[var(--brand-green)]")}
              aria-label={`เลือกไอคอน ${name}`}
            >
              {createElement(leaveIconOf(name), { className: "h-4 w-4 text-[var(--ink)]" })}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button className="h-9 w-9 rounded-md border border-[var(--line)] flex items-center justify-center hover:bg-[var(--bg-soft)]" title="เลือกสี" aria-label="เลือกสี">
            <span className="h-4 w-4 rounded-full" style={{ backgroundColor: value }} />
          </button>
        }
      />
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-4 gap-1.5">
          {colorPalette.map((c) => (
            <button
              key={c.value}
              onClick={() => onChange(c.value)}
              className="h-7 w-7 rounded-md flex items-center justify-center ring-1 ring-black/5 hover:scale-110 transition-transform"
              style={{ backgroundColor: c.value }}
              title={c.name}
              aria-label={c.name}
            >
              {value === c.value && <Check className="h-4 w-4 text-white" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MonthlyQuotaFields({ t, updateType }: { t: LeaveTypeDef; updateType: (id: string, patch: Partial<Omit<LeaveTypeDef, "id">>) => void }) {
  const holidays = useHolidayStore((s) => s.holidays);
  const [countries, setCountries] = useState<Country[]>([]);
  const [importing, setImporting] = useState(false);
  const source = t.monthlySource ?? "fixed";
  const countryCode = t.holidayCountryCode ?? THAI_SOURCE;

  useEffect(() => {
    if (source !== "country" || countries.length > 0) return;
    fetch("/api/report-task/holidays/countries")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setCountries([...data].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
  }, [source, countries.length]);

  async function selectCountry(code: string) {
    updateType(t.id, { holidayCountryCode: code });
    const year = new Date().getFullYear();
    setImporting(true);
    await Promise.all([importCountryHolidays(code, year), importCountryHolidays(code, year + 1)]);
    setImporting(false);
  }

  // Which month's grant this row is previewing/overriding — browsable with
  // ‹ › instead of being locked to whatever the real calendar month happens
  // to be when the dialog is opened, since a country's holiday count (and so
  // the override you might want) differs month to month.
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const previewGrant =
    source === "country" ? countryHolidayGrantResolver(holidays, countryCode, t.monthlyGrantOverrides)(monthKey) : null;
  const overrideValue = t.monthlyGrantOverrides?.[monthKey];

  function setOverride(v: string) {
    const overrides = { ...t.monthlyGrantOverrides };
    if (v === "") delete overrides[monthKey];
    else overrides[monthKey] = Math.max(0, Number(v));
    updateType(t.id, { monthlyGrantOverrides: overrides });
  }

  const labelCls = "text-xs text-[var(--ink-soft)] w-28 shrink-0 pt-2";
  const rowCls = "flex items-start gap-2";

  return (
    <div className="rounded-lg bg-[var(--bg-soft)]/70 p-2.5 space-y-2.5">
      <div className={rowCls}>
        <span className={cn(labelCls, "flex items-center gap-1")}>
          วิธีให้วันลา
          <Tooltip>
            <TooltipTrigger
              render={
                <button type="button" className="text-[var(--ink-soft)] hover:text-[var(--ink)]" aria-label="ความหมายของวิธีให้วันลา">
                  <Info className="h-3 w-3" />
                </button>
              }
            />
            <TooltipContent className="max-w-[260px]">
              <b>กำหนดจำนวนวันเอง</b> = พิมพ์จำนวนวันที่ให้ต่อเดือนตายตัวเอง
              <br />
              <b>อิงวันหยุดราชการของประเทศ</b> = ระบบนับจำนวนวันหยุดราชการของประเทศที่เลือกในเดือนนั้นๆ แล้วให้เท่ากับจำนวนวันหยุดนั้นโดยอัตโนมัติ (แก้ไขเฉพาะเดือนได้ถ้าต้องการ)
            </TooltipContent>
          </Tooltip>
        </span>
        <Select value={source} onValueChange={(v) => v && updateType(t.id, { monthlySource: v as "fixed" | "country" })}>
          <SelectTrigger className="w-full">
            <SelectValue>{source === "country" ? "อิงวันหยุดราชการของประเทศ" : "กำหนดจำนวนวันเอง"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">กำหนดจำนวนวันเอง</SelectItem>
            <SelectItem value="country">อิงวันหยุดราชการของประเทศ</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {source === "fixed" && (
        <div className={rowCls}>
          <span className={labelCls}>ให้ต่อเดือน</span>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              value={t.monthlyGrant ?? ""}
              onChange={(e) =>
                updateType(t.id, { monthlyGrant: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })
              }
              placeholder="0"
              className="w-16 text-center"
            />
            <span className="text-xs text-[var(--ink-soft)] whitespace-nowrap">วัน ทุกเดือน</span>
          </div>
        </div>
      )}

      {source === "country" && (
        <>
          <div className={rowCls}>
            <span className={labelCls}>ประเทศ</span>
            <Select value={countryCode} onValueChange={(v) => v && selectCountry(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>{countryCode === THAI_SOURCE ? THAILAND.name : (countries.find((c) => c.countryCode === countryCode)?.name ?? countryCode)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={THAI_SOURCE}>{THAILAND.name}</SelectItem>
                {countries.map((c) => (
                  <SelectItem key={c.countryCode} value={c.countryCode}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className={rowCls}>
            <span className={labelCls}>แต่ละเดือนได้</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 mb-1">
                <button
                  type="button"
                  onClick={() => setMonthKey((k) => shiftMonthKey(k, -1))}
                  title="เดือนก่อนหน้า"
                  aria-label="เดือนก่อนหน้า"
                  className="flex items-center justify-center h-5 w-5 rounded text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors shrink-0"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs font-medium">{monthKeyLabel(monthKey)}</span>
                <button
                  type="button"
                  onClick={() => setMonthKey((k) => shiftMonthKey(k, 1))}
                  title="เดือนถัดไป"
                  aria-label="เดือนถัดไป"
                  className="flex items-center justify-center h-5 w-5 rounded text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors shrink-0"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              {importing ? (
                <span className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)] h-9">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังดึงวันหยุด...
                </span>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium">{previewGrant} วัน</span>
                  <span className="text-xs text-[var(--ink-soft)] whitespace-nowrap">(นับจากวันหยุดราชการ)</span>
                </div>
              )}
              <div className="flex items-start gap-1.5 mt-1">
                <Input
                  type="number"
                  min={0}
                  value={overrideValue ?? ""}
                  onChange={(e) => setOverride(e.target.value)}
                  placeholder={String(previewGrant ?? 0)}
                  className="w-16 text-center shrink-0"
                />
                <span className="text-xs text-[var(--ink-soft)] leading-snug">
                  แก้ไขเฉพาะเดือน{monthKeyLabel(monthKey)} — เดือนอื่นไม่ถูกกระทบ
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      <div className={rowCls}>
        <span className={labelCls}>วันหมดอายุ</span>
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--ink-soft)] whitespace-nowrap">วันที่ไม่ได้ใช้จะหมดอายุใน</span>
            <Input
              type="number"
              min={0}
              value={t.expiryMonths ?? ""}
              onChange={(e) =>
                updateType(t.id, { expiryMonths: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })
              }
              placeholder="∞"
              className="w-16 text-center"
            />
            <span className="text-xs text-[var(--ink-soft)] whitespace-nowrap">เดือน</span>
          </div>
          <p className="text-[11px] text-[var(--ink-soft)] mt-0.5">เว้นว่าง = สะสมได้เรื่อยๆ ไม่มีวันหมดอายุ</p>
        </div>
      </div>
    </div>
  );
}

/** Manage leave types — company-wide config, lives on the settings page (src/app/settings/page.tsx). */
export function LeaveTypeSettingsPanel() {
  const storedTypes = useLeaveTypeStore((s) => s.types);
  const setTypes = useLeaveTypeStore((s) => s.setTypes);
  const [draft, setDraft] = useState<LeaveTypeDef[]>(storedTypes);
  const [newLabel, setNewLabel] = useState("");
  const [removeTarget, setRemoveTarget] = useState<LeaveTypeDef | null>(null);

  function updateDraft(id: string, patch: Partial<Omit<LeaveTypeDef, "id">>) {
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function removeDraft(id: string) {
    setDraft((d) => d.filter((x) => x.id !== id));
  }

  function add() {
    const label = newLabel.trim();
    if (!label) return;
    setDraft((d) => [...d, { id: `lt-${crypto.randomUUID()}`, label, color: chartColors.violet, icon: "umbrella", quotaMode: "none" }]);
    setNewLabel("");
  }

  function save() {
    setTypes(draft);
    toast.success("บันทึกการตั้งค่าประเภทการลาแล้ว");
  }

  const quotaModeLabel: Record<LeaveQuotaMode, string> = {
    none: "ไม่จำกัด",
    annual: "โควตาต่อปี",
    monthly: "สะสมรายเดือน",
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">จัดการประเภทการลา</h2>
        <p className="text-sm text-[var(--ink-soft)] mt-0.5">
          เพิ่ม แก้ไข หรือลบประเภทการลาได้เอง (ชื่อ · สี · ไอคอน) พร้อมเลือกรูปแบบโควตา: ไม่จำกัด, โควตาต่อปี หรือสะสมรายเดือน (กำหนดจำนวนวันที่ให้ต่อเดือนและวันที่ไม่ใช้จะหมดอายุกี่เดือน) — กด บันทึก เพื่อยืนยันการเปลี่ยนแปลง
        </p>
      </div>

      <div className="space-y-2">
          {draft.map((t) => (
            <div key={t.id} className="rounded-lg border border-[var(--line)] p-2 space-y-2">
              <div className="flex items-center gap-2">
                <IconPicker value={t.icon} color={t.color} onChange={(icon) => updateDraft(t.id, { icon })} />
                <ColorPicker value={t.color} onChange={(color) => updateDraft(t.id, { color })} />
                <Input value={t.label} onChange={(e) => updateDraft(t.id, { label: e.target.value })} className="flex-1" />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setRemoveTarget(t)}
                  disabled={draft.length <= 1}
                  title={draft.length <= 1 ? "ต้องมีอย่างน้อย 1 ประเภท" : "ลบ"}
                  aria-label={`ลบประเภทการลา ${t.label}`}
                >
                  <Trash2 className="h-4 w-4 text-[var(--ink-soft)]" />
                </Button>
              </div>

              <div className="flex items-center gap-2 pl-1">
                <Select
                  value={t.quotaMode}
                  onValueChange={(v) => v && updateDraft(t.id, { quotaMode: v as LeaveQuotaMode })}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue>{quotaModeLabel[t.quotaMode]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(["none", "annual", "monthly"] as LeaveQuotaMode[]).map((m) => (
                      <SelectItem key={m} value={m}>{quotaModeLabel[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button type="button" className="text-[var(--ink-soft)] hover:text-[var(--ink)] shrink-0" aria-label="ความหมายของแต่ละประเภทโควตา">
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    }
                  />
                  <TooltipContent className="max-w-[260px]">
                    <b>ไม่จำกัด</b> = ลาได้ไม่มีเพดาน ไม่มีการนับโควตา
                    <br />
                    <b>โควตาต่อปี</b> = ให้จำนวนวันครั้งเดียวตอนต้นปี ใช้หมดแล้วลาเพิ่มไม่ได้จนขึ้นปีใหม่
                    <br />
                    <b>สะสมรายเดือน</b> = ให้วันลาใหม่ทุกเดือนอัตโนมัติ วันที่ไม่ได้ใช้จะสะสมต่อไปจนกว่าจะหมดอายุ (ถ้าตั้งไว้)
                  </TooltipContent>
                </Tooltip>

                {t.quotaMode === "annual" && (
                  <Input
                    type="number"
                    min={0}
                    value={t.annualQuota ?? ""}
                    onChange={(e) =>
                      updateDraft(t.id, { annualQuota: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })
                    }
                    placeholder="จำนวนวัน"
                    title="โควตาต่อปี (วัน)"
                    className="w-24 text-center"
                  />
                )}
                {t.quotaMode === "annual" && <span className="text-xs text-[var(--ink-soft)]">วัน/ปี</span>}

              </div>

              {t.quotaMode === "monthly" && (
                <div className="pl-1 space-y-2">
                  <MonthlyQuotaFields t={t} updateType={updateDraft} />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--line)] p-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="ชื่อประเภทลาใหม่ เช่น ลาคลอด"
            className="flex-1"
          />
          <Button variant="outline" size="icon" onClick={add} aria-label="เพิ่มประเภทการลา">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

      <Button onClick={save}>
        <Save className="h-4 w-4" /> บันทึก
      </Button>

      <AlertDialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบประเภทการลา &quot;{removeTarget?.label}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              ยังไม่มีผลจนกว่าจะกด &quot;บันทึก&quot; แต่จะหายจากรายการด้านบนทันที
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
              onClick={() => {
                if (removeTarget) removeDraft(removeTarget.id);
                setRemoveTarget(null);
              }}
            >
              ลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
