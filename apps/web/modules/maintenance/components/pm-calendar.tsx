"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CalendarCheck,
  CalendarSync,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Hash,
  Home as HomeIcon,
  Layers,
  Pencil,
  Plus,
  Repeat,
  User,
  Wrench,
} from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";
import { propertyGroup } from "./work-order-board";
import {
  groupByDueDate,
  monthGrid,
  monthOfIso,
  parseIso,
  pmStatusOf,
  shiftMonth,
  thaiMonthLabel,
  THAI_DOW,
  THAI_MONTHS,
  type PmStatusKey,
  type YearMonth,
} from "@/modules/maintenance/lib/pm-calendar";

/** สถานะ PM — สี/ไอคอน/คำอธิบาย (ตรรกะการตัดสินอยู่ที่ lib/pm-calendar.ts) */
export const PM_STATUS: Record<
  PmStatusKey,
  { label: string; hint: string; color: string; Icon: typeof AlertCircle }
> = {
  overdue: {
    label: "เกินกำหนด",
    hint: "เลยกำหนดแล้วและยังไม่มีใบงาน — ต้องรีบจัดการ",
    color: "#D32F2F",
    Icon: AlertCircle,
  },
  dueSoon: {
    label: "ใกล้ถึงกำหนด",
    hint: "ครบกำหนดภายใน 7 วัน",
    color: "#E65100",
    Icon: AlertTriangle,
  },
  hasWorkOrder: {
    label: "เปิดใบงานแล้ว",
    hint: "มีใบงานรอดำเนินการอยู่แล้ว",
    color: "#1565C0",
    Icon: ClipboardCheck,
  },
  awaitingSchedule: {
    label: "รอนัดวัน",
    hint: "ทำครั้งล่าสุดเสร็จแล้ว รอนัดวันครั้งถัดไป",
    color: "#6A1B9A",
    Icon: CalendarSync,
  },
  onTrack: {
    label: "ตามกำหนด",
    hint: "ยังไม่ถึงกำหนด เกิน 7 วันขึ้นไป",
    color: "#2E7D32",
    Icon: CheckCircle2,
  },
};

export interface PmRow {
  id: string;
  title: string;
  description: string | null;
  propertyId: string;
  propertyName: string;
  assetId: string | null;
  assetName: string | null;
  frequencyLabel: string;
  mode: "continuous" | "yearlyRounds" | "limitedCount";
  roundsDone: number;
  totalRounds: number | null;
  roundsPerYear: number | null;
  awaitingSchedule: boolean;
  daysUntilDue: number;
  nextDueLabel: string;
  /** YYYY-MM-DD — เป็นทั้งค่าใน input[type=date] และช่องวันบนปฏิทิน */
  nextDueInput: string;
  createdAtLabel: string;
  createdByName: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  requiresExpense: boolean;
  hasPendingWorkOrder: boolean;
}

/** ลิงก์สร้างใบงานจาก PM — คัดลอกรูปแบบ description ของเดิมทั้งหมด */
function workOrderHref(s: PmRow, selfId: string | null): string {
  const description =
    `PM: ${s.title}\nกำหนด: ${s.nextDueLabel}\nความถี่: ${s.frequencyLabel}` +
    (s.description ? `\nรายละเอียด: ${s.description}` : "");
  const q = new URLSearchParams({
    title: s.title,
    propertyId: s.propertyId,
    description,
    pmScheduleId: s.id,
  });
  if (s.assetId) q.set("assetId", s.assetId);
  if (s.assignedTo) q.set("technicianId", s.assignedTo);
  else if (selfId) q.set("technicianId", selfId);
  return `/maintenance/work-orders/new?${q.toString()}`;
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-(--ink-soft)">
      {icon}
      {label}
    </span>
  );
}

/** วันที่แบบสั้นสำหรับหัวรายการ เช่น "21 ส.ค. 2569" */
function shortThaiDate(iso: string): string {
  const p = parseIso(iso);
  return `${p.day} ${THAI_MONTHS[p.month]!.slice(0, 3)}. ${p.year + 543}`;
}

export function PmCalendar({
  schedules,
  canManage,
  selfIdForAssign,
  todayIso,
  scheduleNextAction,
  deleteAction,
  updateAction,
  frequencyOptions,
  userOptions,
}: {
  schedules: PmRow[];
  canManage: boolean;
  /** ผู้ดูแลบ้านมอบงานให้ตัวเองอัตโนมัติ (เหมือนของเดิม) */
  selfIdForAssign: string | null;
  /**
   * วันนี้ในรูป YYYY-MM-DD คิดมาจากฝั่ง server
   *
   * ไม่ใช้ new Date() ในคอมโพเนนต์ เพราะจะได้คนละค่ากับตอน server render
   * (hydration mismatch) และจะไม่ตรงกับ daysUntilDue ที่คิดจากฝั่ง server อยู่แล้ว
   */
  todayIso: string;
  scheduleNextAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  updateAction: (formData: FormData) => void | Promise<void>;
  frequencyOptions: { value: string; label: string }[];
  /** ผู้ที่มอบหมายงาน PM ให้ได้ — ใช้ในกล่องแก้ไข */
  userOptions: { id: string; label: string }[];
}) {
  const [ym, setYm] = useState<YearMonth>(() => monthOfIso(todayIso));
  const [pick, setPick] = useState<
    { kind: "day"; iso: string } | { kind: "overdue" } | { kind: "awaiting" }
  >({ kind: "day", iso: todayIso });
  const [group, setGroup] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PmRow | null>(null);
  const [scheduling, setScheduling] = useState<PmRow | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);

  const { groups, propertiesInGroup } = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>();
    const seen = new Set<string>();
    for (const s of schedules) {
      if (seen.has(s.propertyId)) continue;
      seen.add(s.propertyId);
      const g = propertyGroup(s.propertyName);
      const arr = map.get(g) ?? [];
      arr.push({ id: s.propertyId, name: s.propertyName });
      map.set(g, arr);
    }
    for (const arr of map.values())
      arr.sort((a, b) => a.name.localeCompare(b.name));
    return {
      groups: Array.from(map.keys()).sort(),
      propertiesInGroup: group ? (map.get(group) ?? []) : [],
    };
  }, [schedules, group]);

  const visible = useMemo(() => {
    if (propertyId) return schedules.filter((s) => s.propertyId === propertyId);
    if (!group) return schedules;
    return schedules.filter((s) => propertyGroup(s.propertyName) === group);
  }, [schedules, group, propertyId]);

  const byDate = useMemo(() => groupByDueDate(visible), [visible]);

  /**
   * เกินกำหนด/รอนัดวัน ต้องดึงออกมาจากทุกเดือน ไม่ใช่เฉพาะเดือนที่เปิดดูอยู่
   *
   * ปฏิทินซ่อนอดีตโดยธรรมชาติ — งานที่เลยกำหนดตั้งแต่เดือนก่อนจะไม่มีวันโผล่
   * ขึ้นมาเองถ้าไม่ปักไว้ข้างบน ส่วน "รอนัดวัน" ยังไม่มีวันให้วางบนปฏิทินเลย
   */
  const overdue = useMemo(
    () =>
      visible
        .filter((s) => pmStatusOf(s) === "overdue")
        .sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    [visible]
  );
  const awaiting = useMemo(
    () => visible.filter((s) => s.awaitingSchedule),
    [visible]
  );

  const cells = useMemo(() => monthGrid(ym), [ym]);

  const panel: { title: string; rows: PmRow[]; empty: string } =
    pick.kind === "overdue"
      ? {
          title: `เกินกำหนด (${overdue.length})`,
          rows: overdue,
          empty: "ไม่มีงานเกินกำหนด",
        }
      : pick.kind === "awaiting"
        ? {
            title: `รอนัดวัน (${awaiting.length})`,
            rows: awaiting,
            empty: "ไม่มีงานที่รอนัดวัน",
          }
        : {
            title: `${shortThaiDate(pick.iso)}${
              pick.iso === todayIso ? " (วันนี้)" : ""
            }`,
            rows: byDate.get(pick.iso) ?? [],
            empty: "ไม่มีงาน PM ในวันที่เลือก",
          };

  const chipStyle = (active: boolean) =>
    active
      ? { color: "#0F766E", borderColor: "#0D9488", backgroundColor: "#CCFBF1" }
      : { color: "var(--ink-soft)", borderColor: "var(--line)" };

  const selectedIso = pick.kind === "day" ? pick.iso : null;

  return (
    <div className="mx-auto max-w-[1100px]">
      {/* ─── แถบเดือน ─── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="เดือนก่อนหน้า"
            onClick={() => setYm(shiftMonth(ym, -1))}
            className="rounded-full p-2 text-(--app-strong) hover:bg-(--bg-soft)"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h2 className="min-w-[9.5rem] text-center text-base font-bold text-(--ink)">
            {thaiMonthLabel(ym)}
          </h2>
          <button
            type="button"
            aria-label="เดือนถัดไป"
            onClick={() => setYm(shiftMonth(ym, 1))}
            className="rounded-full p-2 text-(--app-strong) hover:bg-(--bg-soft)"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setYm(monthOfIso(todayIso));
            setPick({ kind: "day", iso: todayIso });
          }}
        >
          วันนี้
        </Button>

        <span className="text-xs text-(--ink-soft)">
          {visible.length} แผน PM
        </span>

        {canManage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setBatchOpen(true)}
          >
            <Layers className="h-4 w-4" /> รวมใบงาน
          </Button>
        )}
      </div>

      {/* ─── ตัวกรองบ้าน ─── */}
      {groups.length > 0 && (
        <Card className="mb-3 p-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setGroup(null);
                setPropertyId(null);
              }}
              className="rounded-full border px-3 py-1 text-xs"
              style={chipStyle(group === null && propertyId === null)}
            >
              ทุกโครงการ
            </button>
            {groups.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGroup(group === g ? null : g);
                  setPropertyId(null);
                }}
                className="rounded-full border px-3 py-1 text-xs"
                style={chipStyle(group === g)}
              >
                {g}
              </button>
            ))}
          </div>
          {propertiesInGroup.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 border-t border-(--line) pt-2">
              <button
                type="button"
                onClick={() => setPropertyId(null)}
                className="rounded-full border px-3 py-1 text-xs"
                style={chipStyle(propertyId === null)}
              >
                ทุกหลังในโครงการ
              </button>
              {propertiesInGroup.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setPropertyId(propertyId === p.id ? null : p.id)
                  }
                  className="rounded-full border px-3 py-1 text-xs"
                  style={chipStyle(propertyId === p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ─── สองกลุ่มที่ปฏิทินแสดงไม่ได้ ต้องปักไว้ให้เห็นทุกเดือน ─── */}
      {(overdue.length > 0 || awaiting.length > 0) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {overdue.length > 0 && (
            <AlertStrip
              meta={PM_STATUS.overdue}
              count={overdue.length}
              active={pick.kind === "overdue"}
              onClick={() =>
                setPick(
                  pick.kind === "overdue"
                    ? { kind: "day", iso: todayIso }
                    : { kind: "overdue" }
                )
              }
            />
          )}
          {awaiting.length > 0 && (
            <AlertStrip
              meta={PM_STATUS.awaitingSchedule}
              count={awaiting.length}
              active={pick.kind === "awaiting"}
              onClick={() =>
                setPick(
                  pick.kind === "awaiting"
                    ? { kind: "day", iso: todayIso }
                    : { kind: "awaiting" }
                )
              }
            />
          )}
        </div>
      )}

      {/* ─── ตารางเดือน ─── */}
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b border-(--line) bg-(--bg-soft)">
          {THAI_DOW.map((d) => (
            <span
              key={d}
              className="py-2 text-center text-[11px] font-medium text-(--ink-soft)"
            >
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, i) => {
            const rows = byDate.get(cell.iso) ?? [];
            const isToday = cell.iso === todayIso;
            const isPicked = cell.iso === selectedIso;
            return (
              <button
                key={cell.iso}
                type="button"
                onClick={() => setPick({ kind: "day", iso: cell.iso })}
                aria-pressed={isPicked}
                aria-label={`${shortThaiDate(cell.iso)} — ${rows.length} งาน PM`}
                className={`flex min-h-[62px] flex-col gap-1 p-1.5 text-left transition-colors sm:min-h-[94px] ${
                  i % 7 !== 0 ? "border-l border-(--line)" : ""
                } ${i >= 7 ? "border-t border-(--line)" : ""} ${
                  isPicked ? "" : "hover:bg-(--bg-soft)"
                }`}
                style={{
                  backgroundColor: isPicked
                    ? "var(--app-pale)"
                    : cell.inMonth
                      ? undefined
                      : "var(--bg-soft)",
                  boxShadow: isPicked ? "inset 0 0 0 2px var(--app)" : undefined,
                  opacity: cell.inMonth ? 1 : 0.55,
                }}
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums"
                  style={
                    isToday
                      ? { backgroundColor: "var(--app)", color: "#fff", fontWeight: 700 }
                      : { color: "var(--ink-soft)" }
                  }
                >
                  {cell.day}
                </span>

                {/* มือถือ: จุดสีพอ — ชิปตัวหนังสือในช่องกว้าง 50px อ่านไม่ออกอยู่ดี */}
                {rows.length > 0 && (
                  <span className="flex flex-wrap gap-0.5 sm:hidden">
                    {rows.slice(0, 4).map((s) => (
                      <span
                        key={s.id}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: PM_STATUS[pmStatusOf(s)].color }}
                      />
                    ))}
                    {rows.length > 4 && (
                      <span className="text-[9px] leading-none text-(--ink-soft)">
                        +{rows.length - 4}
                      </span>
                    )}
                  </span>
                )}

                <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                  {rows.slice(0, 2).map((s) => {
                    const color = PM_STATUS[pmStatusOf(s)].color;
                    return (
                      <span
                        key={s.id}
                        className="truncate rounded px-1 py-0.5 text-[10px] leading-tight"
                        style={{ backgroundColor: `${color}1a`, color }}
                        title={`${s.title} · ${s.propertyName}`}
                      >
                        {s.propertyName || s.title}
                      </span>
                    );
                  })}
                  {rows.length > 2 && (
                    <span className="px-1 text-[10px] text-(--ink-soft)">
                      +{rows.length - 2} รายการ
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* ─── คำอธิบายสี ─── */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {(Object.keys(PM_STATUS) as PmStatusKey[]).map((k) => (
          <span
            key={k}
            title={PM_STATUS[k].hint}
            className="inline-flex items-center gap-1.5 text-[11px] text-(--ink-soft)"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: PM_STATUS[k].color }}
            />
            {PM_STATUS[k].label}
          </span>
        ))}
      </div>

      {/* ─── รายการของวัน/กลุ่มที่เลือก ─── */}
      <div className="mb-2 mt-5 flex items-center gap-2">
        <h3 className="text-base font-bold text-(--ink)">{panel.title}</h3>
        {panel.rows.length > 0 && (
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-bold"
            style={{ backgroundColor: "#CCFBF1", color: "#0F766E" }}
          >
            {panel.rows.length} รายการ
          </span>
        )}
      </div>

      {panel.rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-(--ink-soft)">
          {panel.empty}
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {panel.rows.map((s) => (
            <PmDetailCard
              key={s.id}
              s={s}
              canManage={canManage}
              selfIdForAssign={selfIdForAssign}
              deleteAction={deleteAction}
              onEdit={() => setEditing(s)}
              onSchedule={() => setScheduling(s)}
            />
          ))}
        </div>
      )}

      {/* ─── นัดวันครั้งถัดไป ─── */}
      {scheduling && (
        <Modal
          title={`นัดวันครั้งที่ ${scheduling.roundsDone + 1}`}
          onClose={() => setScheduling(null)}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setScheduling(null)}
              >
                ยกเลิก
              </Button>
              <Button type="submit" form="pm-schedule-next" size="sm">
                บันทึก
              </Button>
            </>
          }
        >
          <form id="pm-schedule-next" action={scheduleNextAction}>
            <input type="hidden" name="id" value={scheduling.id} />
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-(--ink)">
                วันที่นัดครั้งถัดไป
              </span>
              <input
                type="date"
                name="date"
                required
                className="h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
              />
            </label>
          </form>
        </Modal>
      )}

      {/* ─── แก้ไข PM ─── */}
      {editing && (
        <Modal
          title="แก้ไข PM"
          onClose={() => setEditing(null)}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(null)}
              >
                ยกเลิก
              </Button>
              <Button type="submit" form="pm-edit" size="sm">
                บันทึก
              </Button>
            </>
          }
        >
          <form id="pm-edit" action={updateAction} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={editing.id} />
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-(--ink)">ชื่องาน PM</span>
              <input
                name="title"
                defaultValue={editing.title}
                required
                className="h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-(--ink)">ความถี่</span>
              <select
                name="frequency"
                defaultValue={
                  frequencyOptions.find((f) => f.label === editing.frequencyLabel)
                    ?.value ?? "monthly"
                }
                className="h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
              >
                {frequencyOptions.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-(--ink)">
                วันกำหนดถัดไป
              </span>
              <input
                type="date"
                name="nextDueDate"
                defaultValue={editing.nextDueInput}
                className="h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-(--ink)">ผู้รับผิดชอบ</span>
              <select
                name="assignedTo"
                defaultValue={editing.assignedTo ?? ""}
                className="h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
              >
                <option value="">ยังไม่มอบหมาย</option>
                {userOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-2.5 rounded-(--radius) border border-(--line) p-2.5">
              <input
                type="checkbox"
                name="noExpense"
                value="1"
                defaultChecked={!editing.requiresExpense}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="block text-sm font-medium text-(--ink)">
                  แผนนี้ไม่มีค่าใช้จ่าย
                </span>
                <span className="block text-xs text-(--ink-soft)">
                  มีผลกับใบงานที่ระบบสร้างหลังจากนี้ ใบที่เปิดค้างอยู่ไม่เปลี่ยนตาม
                </span>
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-(--ink)">รายละเอียด</span>
              <textarea
                name="description"
                rows={2}
                defaultValue={editing.description ?? ""}
                className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink)"
              />
            </label>
          </form>
        </Modal>
      )}

      {/* ─── รวมใบงานหลายบ้าน ─── */}
      {batchOpen && (
        <BatchWorkOrderDialog
          candidates={visible.filter((s) => !s.hasPendingWorkOrder)}
          selfIdForAssign={selfIdForAssign}
          onClose={() => setBatchOpen(false)}
        />
      )}
    </div>
  );
}

/** แถบเตือนเหนือปฏิทิน — กดเพื่อสลับให้รายการด้านล่างแสดงกลุ่มนี้ */
function AlertStrip({
  meta,
  count,
  active,
  onClick,
}: {
  meta: (typeof PM_STATUS)[PmStatusKey];
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={meta.hint}
      className="inline-flex items-center gap-2 rounded-(--radius) border px-3 py-2 text-sm transition-colors"
      style={{
        borderColor: meta.color,
        borderWidth: active ? 2 : 1,
        backgroundColor: `${meta.color}14`,
        color: meta.color,
      }}
    >
      <meta.Icon className="h-4 w-4" />
      <span className="font-bold">{meta.label}</span>
      <span className="tabular-nums">{count} รายการ</span>
    </button>
  );
}

function PmDetailCard({
  s,
  canManage,
  selfIdForAssign,
  deleteAction,
  onEdit,
  onSchedule,
}: {
  s: PmRow;
  canManage: boolean;
  selfIdForAssign: string | null;
  deleteAction: (formData: FormData) => void | Promise<void>;
  onEdit: () => void;
  onSchedule: () => void;
}) {
  const status = pmStatusOf(s);
  const meta = PM_STATUS[status];
  const statusText = s.awaitingSchedule
    ? "รอนัดวัน"
    : s.daysUntilDue < 0
      ? `เกินกำหนด ${-s.daysUntilDue} วัน`
      : s.daysUntilDue === 0
        ? "ครบกำหนดวันนี้"
        : `อีก ${s.daysUntilDue} วัน`;

  const body = (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-(--ink)">{s.title}</p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-(--ink-soft)">
            <HomeIcon className="h-3.5 w-3.5" /> {s.propertyName}
          </p>
        </div>
        <span
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold"
          style={{ color: meta.color, backgroundColor: `${meta.color}1a` }}
        >
          {statusText}
        </span>
        {canManage && (
          <button
            type="button"
            title="แก้ไข PM"
            onClick={(e) => {
              e.preventDefault();
              onEdit();
            }}
            className="shrink-0 text-(--ink-soft) hover:text-(--ink)"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </div>

      {s.description && (
        <p className="mt-1 text-xs text-(--ink-soft)">{s.description}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {s.mode === "limitedCount" ? (
          <Chip
            icon={<Hash className="h-3.5 w-3.5" />}
            label={`ครั้งที่ ${s.roundsDone}/${s.totalRounds}`}
          />
        ) : (
          <Chip
            icon={<Repeat className="h-3.5 w-3.5" />}
            label={s.frequencyLabel}
          />
        )}
        {!s.awaitingSchedule && (
          <Chip
            icon={<CalendarCheck className="h-3.5 w-3.5" />}
            label={s.nextDueLabel}
          />
        )}
        <Chip
          icon={<Clock className="h-3.5 w-3.5" />}
          label={`สร้างเมื่อ ${s.createdAtLabel}`}
        />
        {s.assignedToName && (
          <Chip icon={<User className="h-3.5 w-3.5" />} label={s.assignedToName} />
        )}
        {s.assetName && (
          <Chip icon={<Wrench className="h-3.5 w-3.5" />} label={s.assetName} />
        )}
      </div>
    </>
  );

  return (
    <Card className="p-3">
      {s.assetId ? (
        <Link href={`/maintenance/assets/${s.assetId}`} className="block">
          {body}
        </Link>
      ) : (
        body
      )}

      {canManage && s.awaitingSchedule && (
        <Button
          type="button"
          variant="outline"
          className="mt-2 w-full"
          onClick={onSchedule}
        >
          <CalendarCheck className="h-4 w-4" /> นัดวันครั้งที่ {s.roundsDone + 1}
        </Button>
      )}
      {canManage &&
        !s.awaitingSchedule &&
        (status === "overdue" || status === "dueSoon") && (
          <div className="mt-2">
            <Link href={workOrderHref(s, selfIdForAssign)}>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                style={{ color: meta.color, borderColor: meta.color }}
              >
                <Plus className="h-4 w-4" /> สร้างใบงาน
              </Button>
            </Link>
          </div>
        )}
      {canManage && status === "hasWorkOrder" && (
        <p
          className="mt-2 rounded-(--radius) px-3 py-2 text-center text-xs"
          style={{ backgroundColor: "#1565C014", color: "#1565C0" }}
        >
          มีใบงานรอดำเนินการอยู่แล้ว
        </p>
      )}

      {canManage && (
        <form action={deleteAction} className="mt-2 text-right">
          <input type="hidden" name="id" value={s.id} />
          <Button type="submit" size="sm" variant="ghost" className="text-[#DC2626]">
            ลบ
          </Button>
        </form>
      )}
    </Card>
  );
}

/** เลือก PM หลายรายการ → เปิดใบงานเดียวครอบทุกบ้าน (port จาก _BatchPmDialog) */
function BatchWorkOrderDialog({
  candidates,
  selfIdForAssign,
  onClose,
}: {
  candidates: PmRow[];
  selfIdForAssign: string | null;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);

  const sorted = [...candidates].sort((a, b) =>
    a.propertyName.localeCompare(b.propertyName)
  );
  const selected = sorted.filter((s) => picked.includes(s.id));

  let href = "#";
  if (selected.length > 0) {
    const first = selected[0]!;
    const houseLines = selected
      .map((s) => `- ${s.propertyName} (ครบกำหนด: ${s.nextDueLabel})`)
      .join("\n");
    const description =
      `PM: ${first.title}\nรวม ${selected.length} หลัง:\n${houseLines}` +
      `\nความถี่: ${first.frequencyLabel}` +
      (first.description ? `\nรายละเอียด: ${first.description}` : "");
    const q = new URLSearchParams({
      title: first.title,
      propertyId: first.propertyId,
      description,
      pmScheduleIds: selected.map((s) => s.id).join(","),
    });
    const additional = selected.slice(1).map((s) => s.propertyId);
    if (additional.length > 0)
      q.set("additionalPropertyIds", additional.join(","));
    const techs = new Set(selected.map((s) => s.assignedTo));
    const only = techs.size === 1 ? [...techs][0] : null;
    if (only) q.set("technicianId", only);
    else if (selfIdForAssign) q.set("technicianId", selfIdForAssign);
    href = `/maintenance/work-orders/new?${q.toString()}`;
  }

  return (
    <Modal
      title="รวมใบงานจากหลาย PM"
      wide
      onClose={onClose}
      actions={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            ยกเลิก
          </Button>
          {selected.length > 0 ? (
            <Link href={href}>
              <Button type="button" size="sm">
                สร้างใบงาน ({selected.length})
              </Button>
            </Link>
          ) : (
            <Button type="button" size="sm" disabled>
              สร้างใบงาน
            </Button>
          )}
        </>
      }
    >
      {sorted.length === 0 ? (
        <p className="text-sm text-(--ink-soft)">
          ไม่มี PM ที่สามารถรวมใบงานได้
        </p>
      ) : (
        <div className="flex flex-col">
          {sorted.map((s) => (
            <label
              key={s.id}
              className="flex items-start gap-3 border-b border-(--line) py-2.5 text-sm last:border-0"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={picked.includes(s.id)}
                onChange={(e) =>
                  setPicked(
                    e.target.checked
                      ? [...picked, s.id]
                      : picked.filter((x) => x !== s.id)
                  )
                }
              />
              <span className="min-w-0">
                <span className="block text-(--ink)">{s.title}</span>
                <span className="block text-xs text-(--ink-soft)">
                  {s.propertyName}
                  {s.assetName ? ` · ${s.assetName}` : ""} · ครบกำหนด{" "}
                  {s.nextDueLabel}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
