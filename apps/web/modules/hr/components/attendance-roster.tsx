"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Avatar } from "@smartboss/ui/components/avatar";
import { Icon } from "@/components/icon";
import { FilterChips, type FilterChipOption } from "./design-kit-client";
import { AttendanceTimeline } from "./attendance-timeline";
import { eventSourceIcon, eventSourceLabel, formatTime } from "../lib/labels";
import type { TimeEvent } from "../lib/api";

export type RosterCategory = "ok" | "late" | "absent" | "off" | "noshift";

export interface RosterRow {
  employmentId: string;
  name: string;
  code: string;
  category: RosterCategory;
  scheduledStartMinutes: number | null;
  firstScanAt?: string;
  lateMinutes?: number;
  offLabel?: string;
  sourceType?: string | null;
}

const CATEGORY_DEFS: { key: RosterCategory; label: string; tone: string }[] = [
  { key: "ok", label: "มาแล้ว", tone: "var(--tone-ok)" },
  { key: "late", label: "สาย", tone: "var(--tone-warn)" },
  { key: "absent", label: "ขาด", tone: "var(--tone-danger)" },
  { key: "off", label: "หยุด/ลา", tone: "var(--tone-info)" },
  { key: "noshift", label: "ยังไม่ผูกกะ", tone: "var(--tone-muted)" },
];

/** 480 → "08:00" — เวลาเข้ากะเก็บเป็นนาทีจากเที่ยงคืน */
function fromMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * รายชื่อวันนี้แบบรวมเดียว — แทนที่การแยก "ลงเวลาแล้ว" กับ "ยังไม่ลงเวลา"
 * เป็นคนละ SectionCard ที่อยู่ไกลกัน (สเปคข้อ 4.1) ใช้ FilterChips กรองแทน
 * checkbox เล็กๆ ที่ไม่มีคำอธิบายว่ากดแล้วเกิดอะไร
 *
 * รายละเอียดการสแกนทีละครั้ง (Timeline เดิม) ไม่ได้ถูกตัดทิ้ง — ยุบไว้ใต้ปุ่ม
 * "ดูทุกครั้งที่มีการสแกน" เพราะเป็นข้อมูลที่มีค่าจริง (เห็นการตอกกลางวัน เช่น
 * พัก/ออกไซต์งานแล้วกลับ ซึ่งรายชื่อสรุปแบบคนละแถวบอกไม่ได้)
 */
export function AttendanceRoster({
  rows,
  timelineEvents,
}: {
  rows: RosterRow[];
  timelineEvents: TimeEvent[];
}) {
  const [active, setActive] = useState<Set<string>>(new Set());
  const [showTimeline, setShowTimeline] = useState(false);

  const counts = useMemo(() => {
    const out: Record<RosterCategory, number> = { ok: 0, late: 0, absent: 0, off: 0, noshift: 0 };
    for (const row of rows) out[row.category]++;
    return out;
  }, [rows]);

  const options: FilterChipOption[] = CATEGORY_DEFS.filter((c) => counts[c.key] > 0).map((c) => ({
    key: c.key,
    label: c.label,
    count: counts[c.key],
    tone: c.tone,
  }));

  const visible = active.size === 0 ? rows : rows.filter((r) => active.has(r.category));

  function toggle(key: string) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <FilterChips options={options} active={active} onToggle={toggle} />

      <div className="flex flex-col gap-2">
        {visible.length === 0 ? (
          <div className="rounded-(--radius) border border-(--line) bg-(--bg) p-10 text-center text-sm text-(--ink-soft)">
            {rows.length === 0 ? "ยังไม่มีพนักงานในระบบ" : "ไม่มีรายการที่ตรงกับตัวกรองที่เลือก"}
          </div>
        ) : (
          visible.map((row) => {
            const def = CATEGORY_DEFS.find((c) => c.key === row.category)!;
            return (
              <div
                key={row.employmentId}
                className="flex flex-wrap items-center gap-3 rounded-(--radius) border border-(--line) bg-(--bg) p-3"
              >
                <Avatar name={row.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-(--ink)">{row.name}</p>
                  <p className="truncate text-[11px] text-(--ink-soft)">
                    {row.code}
                    {row.scheduledStartMinutes !== null && (
                      <> · เข้ากะ {fromMinutes(row.scheduledStartMinutes)}</>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {row.category === "ok" && row.firstScanAt && (
                    <span className="font-mono text-sm tabular-nums text-(--ink)">
                      เข้า {formatTime(row.firstScanAt)}
                    </span>
                  )}
                  {row.category === "late" && (
                    <>
                      {row.firstScanAt && (
                        <span className="font-mono text-sm tabular-nums text-(--ink)">
                          เข้า {formatTime(row.firstScanAt)}
                        </span>
                      )}
                      <span
                        className="rounded-full px-2 py-px text-[10px] font-medium"
                        style={{ color: def.tone, backgroundColor: `color-mix(in srgb, ${def.tone} 14%, transparent)` }}
                      >
                        สาย {row.lateMinutes} นาที
                      </span>
                    </>
                  )}
                  {row.category === "absent" && (
                    <span
                      className="rounded-full px-2 py-px text-[10px] font-medium"
                      style={{ color: def.tone, backgroundColor: `color-mix(in srgb, ${def.tone} 14%, transparent)` }}
                    >
                      ขาดงาน
                    </span>
                  )}
                  {row.category === "off" && (
                    <span
                      className="rounded-full px-2 py-px text-[10px] font-medium"
                      style={{ color: def.tone, backgroundColor: `color-mix(in srgb, ${def.tone} 14%, transparent)` }}
                    >
                      {row.offLabel ?? "วันหยุด"}
                    </span>
                  )}
                  {row.category === "noshift" && (
                    <Link
                      href={`/hr/employees/${row.employmentId}`}
                      className="rounded-full px-2 py-px text-[10px] font-medium hover:underline"
                      style={{ color: def.tone, backgroundColor: `color-mix(in srgb, ${def.tone} 14%, transparent)` }}
                      title="ไปผูกกะของคนนี้"
                    >
                      ยังไม่ผูกกะ →
                    </Link>
                  )}
                </div>

                {row.sourceType && (
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-(--ink-soft)"
                    style={{ backgroundColor: "var(--bg-soft)" }}
                    title={eventSourceLabel(row.sourceType)}
                  >
                    <Icon name={eventSourceIcon(row.sourceType)} className="h-4 w-4" />
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-(--line) pt-3">
        <button
          type="button"
          onClick={() => setShowTimeline((v) => !v)}
          className="text-xs font-medium text-(--app-strong,var(--ink)) hover:underline"
        >
          {showTimeline ? "ซ่อน" : "ดู"}ทุกครั้งที่มีการสแกนวันนี้ ({timelineEvents.length} ครั้ง)
        </button>
        {showTimeline && (
          <div className="mt-3">
            <AttendanceTimeline events={timelineEvents} />
          </div>
        )}
      </div>
    </div>
  );
}
