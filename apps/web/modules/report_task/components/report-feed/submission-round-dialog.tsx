"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import { Button } from "@/modules/report_task/components/ui/button";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { TimePickerField } from "@/modules/report_task/components/shared/time-picker-field";
import { departments, getDepartment, users } from "@/modules/report_task/lib/directory";
import { useReportFeedStore, type SubmissionRound, type SubmitterRule } from "@/modules/report_task/store/report-feed-store";
import { cn } from "@/modules/report_task/lib/utils";
import { Globe, Users, Building2, User as UserIcon, Search, Plus, Minus, Check, ImagePlus } from "lucide-react";
import { uuid } from "@/modules/report_task/lib/uuid";

const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MAX_IMAGES = 6;

type Mode = SubmitterRule["mode"];
const MODES: { mode: Mode; label: string; icon: typeof Globe }[] = [
  { mode: "everyone", label: "ทุกคนในห้อง", icon: Globe },
  { mode: "groups", label: "กลุ่ม", icon: Users },
  { mode: "departments", label: "แผนก", icon: Building2 },
  { mode: "people", label: "รายคน", icon: UserIcon },
];

/** เลือกคนหลายคนแบบมีช่องค้นหา — ใช้ซ้ำในหลายส่วนของกล่องนี้ */
function MemberChecklist({
  selected,
  onToggle,
  emptyHint,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
  emptyHint?: string;
}) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => !needle || u.name.toLowerCase().includes(needle) || (getDepartment(u.departmentId)?.name ?? "").toLowerCase().includes(needle));
  }, [q]);
  return (
    <div className="rounded-lg border border-[var(--line)] bg-white">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 text-[var(--ink-soft)] shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาพนักงาน…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--ink-soft)]"
        />
      </div>
      <div className="max-h-52 overflow-y-auto p-1">
        {rows.length === 0 && <p className="px-2 py-3 text-center text-xs text-[var(--ink-soft)]">{emptyHint ?? "ไม่พบพนักงาน"}</p>}
        {rows.map((u) => {
          const on = selected.has(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => onToggle(u.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-soft)]"
            >
              <Checkbox checked={on} className="pointer-events-none" />
              <Avatar className="h-6 w-6">
                <AvatarImage src={u.avatarUrl ?? undefined} alt={u.name} />
                <AvatarFallback className="text-[10px]">{u.name.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate text-sm">{u.name}</span>
              <span className="truncate text-[11px] text-[var(--ink-soft)]">{getDepartment(u.departmentId)?.name ?? u.role}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function SubmissionRoundDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: SubmissionRound | null;
  onSave: (round: SubmissionRound) => void;
}) {
  const submitterGroups = useReportFeedStore((s) => s.submitterGroups);
  const upsertSubmitterGroup = useReportFeedStore((s) => s.upsertSubmitterGroup);

  const [label, setLabel] = useState(initial?.label ?? "");
  const [time, setTime] = useState(initial?.time ?? "09:00");
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set(initial?.weekdays ?? []));
  // 3 ความถี่แยกจากกันชัดเจน ("รายสัปดาห์ แยกจากรายวันสิ") แทนที่จะรวม
  // "รายวัน" กับ "รายสัปดาห์" ไว้ปุ่มเดียวกันแล้วให้ตัวเลือกวันในสัปดาห์บอกใบ้
  // ว่า "ไม่เลือกวัน = ทุกวัน" (คลุมเครือ)
  const DEFAULT_MONTHLY_DAY = 30;
  // แก้ไขวันที่ของรอบรายเดือนได้เอง ("รายเดือนให้แก้ไขวันที่") ไม่ตายตัวที่
  // 30 อีกต่อไป — เดือนที่ไม่มีวันที่นี้ (30 ในเดือนกุมภาพันธ์ที่มีแค่ 28-29
  // วัน) ตกไปวันสุดท้ายของเดือนนั้นเสมอ ไม่ว่าจะตั้งวันที่ไว้เท่าไหร่ก็ตาม
  // (ดู roundRunsOnDay ใน submission-rounds.ts ที่คำนวณจริง)
  const [dayOfMonth, setDayOfMonth] = useState<number>(initial?.dayOfMonth ?? DEFAULT_MONTHLY_DAY);
  type Frequency = "daily" | "weekly" | "monthly";
  const [frequency, setFrequency] = useState<Frequency>(
    initial?.dayOfMonth ? "monthly" : initial?.weekdays && initial.weekdays.length > 0 ? "weekly" : "daily"
  );
  const [minImages, setMinImages] = useState<number>(initial?.minImages ?? 0);
  const [mode, setMode] = useState<Mode>(initial?.submitters.mode ?? "everyone");
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set(initial?.submitters.groupIds ?? []));
  const [departmentIds, setDepartmentIds] = useState<Set<string>>(new Set(initial?.submitters.departmentIds ?? []));
  const [peopleIds, setPeopleIds] = useState<Set<string>>(new Set(initial?.submitters.userIds ?? []));
  const [addUserIds, setAddUserIds] = useState<Set<string>>(new Set(initial?.submitters.addUserIds ?? []));
  const [removeUserIds, setRemoveUserIds] = useState<Set<string>>(new Set(initial?.submitters.removeUserIds ?? []));
  const [showAdjust, setShowAdjust] = useState(false);

  // สร้างกลุ่มใหม่ inline
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState<Set<string>>(new Set());

  function createGroup() {
    const name = newGroupName.trim();
    if (!name || newGroupMembers.size === 0) return;
    const id = `sgroup-${uuid()}`;
    upsertSubmitterGroup({ id, name, userIds: [...newGroupMembers] });
    setGroupIds((s) => new Set(s).add(id));
    setCreatingGroup(false);
    setNewGroupName("");
    setNewGroupMembers(new Set());
  }

  function handleSave() {
    const submitters: SubmitterRule = { mode };
    if (mode === "groups") submitters.groupIds = [...groupIds];
    if (mode === "departments") submitters.departmentIds = [...departmentIds];
    if (mode === "people") submitters.userIds = [...peopleIds];
    if (mode !== "people" && addUserIds.size > 0) submitters.addUserIds = [...addUserIds];
    if (removeUserIds.size > 0) submitters.removeUserIds = [...removeUserIds];
    onSave({
      id: initial?.id ?? `round-${uuid()}`,
      label: label.trim() || "รอบส่ง",
      time,
      weekdays: frequency === "weekly" && weekdays.size > 0 ? [...weekdays].sort((a, b) => a - b) : undefined,
      dayOfMonth: frequency === "monthly" ? dayOfMonth : undefined,
      minImages,
      // A brand-new round stamps "now" so the compliance checker never judges
      // days before it existed as missed; editing an existing round keeps
      // its original stamp — only creation resets the clock, not every save.
      createdAt: initial?.createdAt ?? new Date().toISOString(),
      submitters,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "แก้ไขรอบส่ง" : "เพิ่มรอบส่ง"}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          {/* ชื่อรอบ */}
          <div className="space-y-1.5">
            <Label className="text-xs text-[var(--ink-soft)]">ชื่อรอบ</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="เช่น กะเช้า" />
          </div>

          {/* ใครต้องส่ง */}
          <div className="space-y-2">
            <Label className="text-xs text-[var(--ink-soft)]">ใครต้องส่งรอบนี้</Label>
            <div className="grid grid-cols-4 gap-2">
              {MODES.map(({ mode: m, label: ml, icon: Icon }) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center transition-colors",
                    mode === m ? "border-[var(--brand-green)] bg-[var(--accent)]" : "border-[var(--line)] hover:bg-[var(--bg-soft)]"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-[11px] font-medium">{ml}</span>
                </button>
              ))}
            </div>

            {mode === "everyone" && (
              <p className="text-[11px] text-[var(--ink-soft)]">ทุกคนที่เห็นห้องนี้ต้องส่ง (ปรับยกเว้นรายคนได้ด้านล่าง)</p>
            )}

            {mode === "groups" && (
              <div className="space-y-1.5">
                {submitterGroups.length === 0 && !creatingGroup && (
                  <p className="text-[11px] text-[var(--ink-soft)]">ยังไม่มีกลุ่ม — สร้างกลุ่มแรกได้เลย</p>
                )}
                {submitterGroups.map((g) => {
                  const on = groupIds.has(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGroupIds((s) => toggleInSet(s, g.id))}
                      className="flex w-full items-center gap-2 rounded-md border border-[var(--line)] px-2 py-1.5 text-left hover:bg-[var(--bg-soft)]"
                    >
                      <Checkbox checked={on} className="pointer-events-none" />
                      <Users className="h-4 w-4 text-[var(--ink-soft)]" />
                      <span className="flex-1 truncate text-sm">{g.name}</span>
                      <span className="text-[11px] text-[var(--ink-soft)]">{g.userIds.length} คน</span>
                    </button>
                  );
                })}
                {creatingGroup ? (
                  <div className="space-y-1.5 rounded-lg border border-dashed border-[var(--line)] p-2">
                    <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="ชื่อกลุ่ม เช่น เซลหน้าร้าน" />
                    <MemberChecklist selected={newGroupMembers} onToggle={(id) => setNewGroupMembers((s) => toggleInSet(s, id))} />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setCreatingGroup(false)}>ยกเลิก</Button>
                      <Button size="sm" onClick={createGroup} disabled={!newGroupName.trim() || newGroupMembers.size === 0}>สร้างกลุ่ม</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setCreatingGroup(true)}>
                    <Plus className="mr-1 h-3.5 w-3.5" />สร้างกลุ่มใหม่
                  </Button>
                )}
              </div>
            )}

            {mode === "departments" && (
              <div className="grid grid-cols-2 gap-1">
                {departments.map((d) => {
                  const on = departmentIds.has(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDepartmentIds((s) => toggleInSet(s, d.id))}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--bg-soft)]"
                    >
                      <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-[var(--brand-green)] bg-[var(--brand-green)]" : "border-[var(--line)]")}>
                        {on && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <span className="truncate">{d.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {mode === "people" && (
              <MemberChecklist selected={peopleIds} onToggle={(id) => setPeopleIds((s) => toggleInSet(s, id))} />
            )}

            {/* ปรับรายคน (เพิ่ม/ยกเว้น) */}
            {mode !== "people" && (
              <div>
                <button type="button" onClick={() => setShowAdjust((v) => !v)} className="text-[11px] font-medium text-[var(--brand-green-dark)]">
                  {showAdjust ? "ซ่อนการปรับรายคน" : "ปรับรายคน (เพิ่ม/ยกเว้น)"}
                </button>
                {showAdjust && (
                  <div className="mt-1.5 space-y-2">
                    {mode !== "everyone" && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-[11px] text-[var(--tone-ok)]"><Plus className="h-3 w-3" />เพิ่มรายคน</div>
                        <MemberChecklist selected={addUserIds} onToggle={(id) => setAddUserIds((s) => toggleInSet(s, id))} />
                      </div>
                    )}
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-[11px] text-[var(--danger)]"><Minus className="h-3 w-3" />ยกเว้นรายคน (ไม่ต้องส่ง)</div>
                      <MemberChecklist selected={removeUserIds} onToggle={(id) => setRemoveUserIds((s) => toggleInSet(s, id))} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* เวลา + รูป */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">ส่งก่อนเวลา</Label>
              <TimePickerField value={time} onChange={setTime} className="w-full" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-xs text-[var(--ink-soft)]"><ImagePlus className="h-3 w-3" />รูปขั้นต่ำ</Label>
              <div className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-white px-1">
                <button type="button" className="flex h-6 w-6 items-center justify-center text-[var(--ink-soft)] disabled:opacity-30" disabled={minImages <= 0} onClick={() => setMinImages(Math.max(0, minImages - 1))} aria-label="ลดรูป"><Minus className="h-3 w-3" /></button>
                <span className="w-5 text-center text-sm tabular-nums">{minImages}</span>
                <button type="button" className="flex h-6 w-6 items-center justify-center text-[var(--ink-soft)] disabled:opacity-30" disabled={minImages >= MAX_IMAGES} onClick={() => setMinImages(Math.min(MAX_IMAGES, minImages + 1))} aria-label="เพิ่มรูป"><Plus className="h-3 w-3" /></button>
              </div>
            </div>
          </div>

          {/* ความถี่ — 3 ตัวเลือกแยกกันชัดเจน ("รายสัปดาห์ แยกจากรายวันสิ") */}
          <div className="space-y-1.5">
            <Label className="text-xs text-[var(--ink-soft)]">ความถี่</Label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: "daily", label: "รายวัน" },
                  { key: "weekly", label: "รายสัปดาห์" },
                  { key: "monthly", label: "รายเดือน" },
                ] as const
              ).map(({ key, label: freqLabel }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setFrequency(key);
                    // สลับเข้า "รายสัปดาห์" ต้องมีวันตั้งต้นเสมอ (บังคับเลือก
                    // วันเดียว ไม่ใช่ปล่อยว่างแล้วแปลว่า "ทุกวัน" แบบเดิมอีก
                    // ต่อไป) ไม่งั้นกดสลับมาแล้วไม่มีอะไรถูกเลือกเลย
                    if (key === "weekly" && weekdays.size === 0) setWeekdays(new Set([5]));
                  }}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-center text-xs font-medium transition-colors",
                    frequency === key ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]" : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                  )}
                >
                  {freqLabel}
                </button>
              ))}
            </div>
          </div>

          {/* วัน */}
          {frequency === "daily" && (
            <p className="flex items-center gap-1 text-[11px] text-[var(--ink-soft)] rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-2">
              <Check className="h-3 w-3 text-[var(--tone-ok)] shrink-0" />ส่งทุกวัน — วันหยุด/วันลา ตัดออกให้เองตามปฏิทิน HR
            </p>
          )}
          {frequency === "weekly" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">ส่งวันไหนของสัปดาห์ (เลือกได้วันเดียว)</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w, i) => {
                  const on = weekdays.has(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      // เลือกวันเดียวเสมอ (แทนที่ ไม่ใช่ toggle สะสมหลายวัน) —
                      // "บังคับให้เลือกวันเดียว" ต่างจากตอนเป็นแท็บ "รายวัน/
                      // รายสัปดาห์" รวมกันเดิมที่เลือกได้หลายวัน
                      onClick={() => setWeekdays(new Set([i]))}
                      className={cn(
                        "h-9 w-10 rounded-lg border text-xs font-medium transition-colors",
                        on ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]" : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                      )}
                    >
                      {w}
                    </button>
                  );
                })}
              </div>
              <p className="flex items-center gap-1 text-[11px] text-[var(--ink-soft)]"><Check className="h-3 w-3 text-[var(--tone-ok)]" />วันหยุด/วันลา ตัดออกให้เองตามปฏิทิน HR</p>
            </div>
          )}
          {frequency === "monthly" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">วันที่ต้องส่งของเดือน</Label>
              <div className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-white px-1 w-fit">
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center text-[var(--ink-soft)] disabled:opacity-30"
                  disabled={dayOfMonth <= 1}
                  onClick={() => setDayOfMonth((d) => Math.max(1, d - 1))}
                  aria-label="วันที่ก่อนหน้า"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-14 text-center text-sm font-semibold tabular-nums">วันที่ {dayOfMonth}</span>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center text-[var(--ink-soft)] disabled:opacity-30"
                  disabled={dayOfMonth >= 31}
                  onClick={() => setDayOfMonth((d) => Math.min(31, d + 1))}
                  aria-label="วันที่ถัดไป"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* คำนวณจำนวนวันจริงของกุมภาพันธ์ "ปีนี้" มาบอกเป็นรูปธรรม
                  ("บอกด้วยว่าเดือนกุมภามี 28-29 วัน จะปรับเป็นวันสุดท้ายของ
                  เดือนกุมภาปีนั้นๆแทน") แทนพูดลอย ๆ ว่า "28 หรือ 29 แล้วแต่ปี" */}
              {(() => {
                const thisYear = new Date().getFullYear();
                const febLastDay = new Date(thisYear, 2, 0).getDate();
                return dayOfMonth > febLastDay ? (
                  <p className="rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-2 text-xs text-[var(--ink)]">
                    เดือนที่ไม่มีวันที่ {dayOfMonth} ให้ใช้วันสุดท้ายของเดือนนั้นแทนอัตโนมัติ — เช่น กุมภาพันธ์ปี {thisYear} มี {febLastDay} วัน ก็จะปรับเป็นวันที่ {febLastDay} ของเดือนนั้นแทน (ปีอื่นอาจเป็น 28 หรือ 29 แล้วแต่ปีอธิกสุรทิน)
                  </p>
                ) : (
                  <p className="rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-2 text-xs text-[var(--ink)]">
                    ทุกเดือนมีวันที่ {dayOfMonth} อยู่แล้ว จึงส่งตรงวันที่ {dayOfMonth} ทุกเดือนโดยไม่ต้องปรับ
                  </p>
                );
              })()}
              <p className="flex items-center gap-1 text-[11px] text-[var(--ink-soft)]"><Check className="h-3 w-3 text-[var(--tone-ok)]" />วันหยุด/วันลา ตัดออกให้เองตามปฏิทิน HR</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button onClick={handleSave}>{initial ? "บันทึก" : "เพิ่มรอบ"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
