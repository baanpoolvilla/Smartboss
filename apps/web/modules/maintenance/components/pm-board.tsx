"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ClipboardCheck,
  CalendarSync,
  CheckCircle2,
  Home as HomeIcon,
  Wrench,
  Pencil,
  CalendarCheck,
  Plus,
  FilterX,
  Repeat,
  CalendarDays,
  Clock,
  UserPlus,
  User,
  Hash,
  Layers,
} from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";
import { propertyGroup } from "./work-order-board";

export type PmStatusKey =
  | "overdue"
  | "dueSoon"
  | "hasWorkOrder"
  | "awaitingSchedule"
  | "onTrack";

/** สถานะ PM — ลำดับ/สี/คำอธิบาย ตรงกับ _PmStatus เดิม */
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

const STATUS_ORDER: PmStatusKey[] = [
  "overdue",
  "dueSoon",
  "hasWorkOrder",
  "awaitingSchedule",
  "onTrack",
];

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
  nextDueInput: string;
  createdAtLabel: string;
  createdByName: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  hasPendingWorkOrder: boolean;
}

function statusOf(s: PmRow): PmStatusKey {
  if (s.awaitingSchedule) return "awaitingSchedule";
  if (s.hasPendingWorkOrder) return "hasWorkOrder";
  if (s.daysUntilDue < 0) return "overdue";
  if (s.daysUntilDue <= 7) return "dueSoon";
  return "onTrack";
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-(--ink-soft)">
      {icon}
      {label}
    </span>
  );
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

export function PmBoard({
  schedules,
  canManage,
  selfIdForAssign,
  scheduleNextAction,
  deleteAction,
  updateAction,
  frequencyOptions,
}: {
  schedules: PmRow[];
  canManage: boolean;
  /** ผู้ดูแลบ้านมอบงานให้ตัวเองอัตโนมัติ (เหมือนของเดิม) */
  selfIdForAssign: string | null;
  scheduleNextAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  updateAction: (formData: FormData) => void | Promise<void>;
  frequencyOptions: { value: string; label: string }[];
}) {
  const [group, setGroup] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [status, setStatus] = useState<PmStatusKey | null>(null);
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
    for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return {
      groups: Array.from(map.keys()).sort(),
      propertiesInGroup: group ? (map.get(group) ?? []) : [],
    };
  }, [schedules, group]);

  const propertyFiltered = useMemo(() => {
    if (propertyId) return schedules.filter((s) => s.propertyId === propertyId);
    if (!group) return schedules;
    return schedules.filter((s) => propertyGroup(s.propertyName) === group);
  }, [schedules, group, propertyId]);

  const visible = status
    ? propertyFiltered.filter((s) => statusOf(s) === status)
    : propertyFiltered;

  const counts: Record<PmStatusKey, number> = {
    overdue: 0,
    dueSoon: 0,
    hasWorkOrder: 0,
    awaitingSchedule: 0,
    onTrack: 0,
  };
  for (const s of propertyFiltered) counts[statusOf(s)]++;

  const scope = propertyId
    ? (schedules.find((s) => s.propertyId === propertyId)?.propertyName ??
      "บ้านที่เลือก")
    : group
      ? `โครงการ ${group}`
      : "ทุกโครงการ";
  const propertyCount = new Set(propertyFiltered.map((s) => s.propertyId)).size;
  const assetCount = new Set(
    propertyFiltered.filter((s) => s.assetId).map((s) => s.assetId)
  ).size;

  const chip = (active: boolean) =>
    active
      ? { color: "#0F766E", borderColor: "#0D9488", backgroundColor: "#CCFBF1" }
      : { color: "var(--ink-soft)", borderColor: "var(--line)" };

  return (
    <div className="mx-auto max-w-[1100px]">
      {/* ─── แถบสรุปด้านบน ─── */}
      <div
        className="mb-3 flex items-center gap-3 rounded-[20px] p-4 sm:p-[18px]"
        style={{
          background: "linear-gradient(135deg, #0F766E 0%, #0D9488 100%)",
          boxShadow: "0 8px 20px rgba(13,148,136,0.18)",
        }}
      >
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px]"
          style={{ backgroundColor: "rgba(255,255,255,0.16)" }}
        >
          <Wrench className="h-6 w-6 text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-white">{scope}</p>
          <p className="truncate text-xs text-white/80">
            ติดตามแผนบำรุงรักษาและงานที่ต้องดำเนินการ
          </p>
        </div>
        <div className="flex items-end gap-5">
          <div className="text-right">
            <p className="text-2xl font-extrabold leading-none text-white">
              {propertyFiltered.length}
            </p>
            <p className="mt-1 text-[11px] text-white/80">แผน PM</p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-2xl font-extrabold leading-none text-white">
              {propertyCount}
            </p>
            <p className="mt-1 text-[11px] text-white/80">บ้าน</p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-2xl font-extrabold leading-none text-white">
              {assetCount}
            </p>
            <p className="mt-1 text-[11px] text-white/80">อุปกรณ์</p>
          </div>
        </div>
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
              style={chip(group === null && propertyId === null)}
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
                style={chip(group === g)}
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
                style={chip(propertyId === null)}
              >
                ทุกหลังในโครงการ
              </button>
              {propertiesInGroup.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPropertyId(propertyId === p.id ? null : p.id)}
                  className="rounded-full border px-3 py-1 text-xs"
                  style={chip(propertyId === p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ─── แถวสถานะ (กดเพื่อกรอง) ─── */}
      {propertyFiltered.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {STATUS_ORDER.map((key) => {
            const st = PM_STATUS[key];
            const active = status === key;
            return (
              <button
                key={key}
                type="button"
                title={st.hint}
                onClick={() => setStatus(active ? null : key)}
                className="rounded-(--radius) border p-3 text-left"
                style={{
                  borderColor: active ? st.color : "var(--line)",
                  borderWidth: active ? 2 : 1,
                  backgroundColor: active ? `${st.color}14` : "var(--bg)",
                }}
              >
                <span className="flex items-center gap-1.5">
                  <st.Icon className="h-4 w-4" style={{ color: st.color }} />
                  <span className="text-[11px] text-(--ink-soft)">
                    {st.label}
                  </span>
                </span>
                <span
                  className="mt-1 block text-2xl font-extrabold leading-none"
                  style={{ color: st.color }}
                >
                  {counts[key]}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── หัวรายการ ─── */}
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-base font-bold text-(--ink)">
          {status ? `รายการ: ${PM_STATUS[status].label}` : "รายการ PM"}
        </h2>
        <span
          className="rounded-full px-2.5 py-1 text-[11px] font-bold"
          style={{ backgroundColor: "#CCFBF1", color: "#0F766E" }}
        >
          {visible.length} รายการ
        </span>
        {status && (
          <button
            type="button"
            onClick={() => setStatus(null)}
            title="แสดงทุกสถานะ"
            className="ml-auto text-(--ink-soft) hover:text-(--ink)"
          >
            <FilterX className="h-5 w-5" />
          </button>
        )}
        {canManage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={status ? "" : "ml-auto"}
            onClick={() => setBatchOpen(true)}
          >
            <Layers className="h-4 w-4" /> รวมใบงาน
          </Button>
        )}
      </div>

      {/* ─── การ์ด PM ─── */}
      {visible.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มีแผน PM
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((s) => {
            const overdue = s.daysUntilDue < 0;
            const dueSoon = s.daysUntilDue >= 0 && s.daysUntilDue <= 7;
            let statusColor = "#0D9488";
            let statusText = `อีก ${s.daysUntilDue} วัน`;
            if (s.awaitingSchedule) {
              statusColor = "#2563EB";
              statusText = "รอนัดวัน";
            } else if (overdue) {
              statusColor = "#DC2626";
              statusText = `เกินกำหนด ${-s.daysUntilDue} วัน`;
            } else if (dueSoon) {
              statusColor = "#EA580C";
            }

            const body = (
              <>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-(--ink)">
                      {s.title}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-(--ink-soft)">
                      <HomeIcon className="h-3.5 w-3.5" /> {s.propertyName}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold"
                    style={{ color: statusColor, backgroundColor: `${statusColor}1a` }}
                  >
                    {statusText}
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      title="แก้ไข PM"
                      onClick={(e) => {
                        e.preventDefault();
                        setEditing(s);
                      }}
                      className="shrink-0 text-(--ink-soft) hover:text-(--ink)"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {s.description && (
                  <p className="mt-1 text-xs text-(--ink-soft)">
                    {s.description}
                  </p>
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
                      icon={<CalendarDays className="h-3.5 w-3.5" />}
                      label={s.nextDueLabel}
                    />
                  )}
                  <Chip
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label={`สร้างเมื่อ ${s.createdAtLabel}`}
                  />
                  {s.createdByName && (
                    <Chip
                      icon={<UserPlus className="h-3.5 w-3.5" />}
                      label={`สร้างโดย ${s.createdByName}`}
                    />
                  )}
                  {s.assignedToName && (
                    <Chip
                      icon={<User className="h-3.5 w-3.5" />}
                      label={s.assignedToName}
                    />
                  )}
                  {s.assetName && (
                    <Chip
                      icon={<Wrench className="h-3.5 w-3.5" />}
                      label={s.assetName}
                    />
                  )}
                </div>
              </>
            );

            return (
              <Card key={s.id} className="p-3">
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
                    onClick={() => setScheduling(s)}
                  >
                    <CalendarCheck className="h-4 w-4" /> นัดวันครั้งที่{" "}
                    {s.roundsDone + 1}
                  </Button>
                )}
                {canManage && !s.awaitingSchedule && (dueSoon || overdue) && (
                  <div className="mt-2">
                    {s.hasPendingWorkOrder ? (
                      <p
                        className="rounded-(--radius) px-3 py-2 text-center text-xs"
                        style={{ backgroundColor: "#1565C014", color: "#1565C0" }}
                      >
                        มีใบงานรอดำเนินการอยู่แล้ว
                      </p>
                    ) : (
                      <Link href={workOrderHref(s, selfIdForAssign)}>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          style={{ color: statusColor, borderColor: statusColor }}
                        >
                          <Plus className="h-4 w-4" /> สร้างใบงาน
                        </Button>
                      </Link>
                    )}
                  </div>
                )}

                {canManage && (
                  <form action={deleteAction} className="mt-2 text-right">
                    <input type="hidden" name="id" value={s.id} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      className="text-[#DC2626]"
                    >
                      ลบ
                    </Button>
                  </form>
                )}
              </Card>
            );
          })}
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
          candidates={propertyFiltered.filter((s) => !s.hasPendingWorkOrder)}
          selfIdForAssign={selfIdForAssign}
          onClose={() => setBatchOpen(false)}
        />
      )}
    </div>
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
