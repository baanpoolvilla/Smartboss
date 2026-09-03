"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@smartboss/ui/components/avatar";
import { Icon } from "@/components/icon";
import {
  eventIntentLabel,
  eventIntentTone,
  eventSourceIcon,
  eventSourceLabel,
} from "../lib/labels";
import type { TimeEvent } from "../lib/api";

/**
 * Timeline การลงเวลา — เห็นทุกครั้งที่มีคนตอกบัตร เรียงจากล่าสุดลงไป
 *
 * ทำไมเป็น client component ทั้งที่หน้าอื่นในโมดูลเป็น server: ตัวกรองด้านซ้าย
 * ต้องติ๊กแล้วเห็นผลทันที ถ้าให้ไป-กลับเซิร์ฟเวอร์ทุกครั้งที่ติ๊ก จะรู้สึกหน่วง
 * และเปลืองรอบ query โดยไม่จำเป็น — ข้อมูลของทั้งวันเล็กพอจะกรองในเบราว์เซอร์
 *
 * ตัวเลขบนการ์ดคือ "ของทั้งวัน" ไม่ใช่ของที่กรองอยู่ — ไม่งั้นพอกรองแล้ว
 * ตัวเลขจะเปลี่ยนตามจนอ่านไม่รู้เรื่องว่าวันนี้มีคนเข้ากี่คนกันแน่
 */

interface Bucket {
  key: string;
  label: string;
  tone: string;
  icon: string;
  match: (event: TimeEvent) => boolean;
}

const BUCKETS: Bucket[] = [
  {
    key: "in",
    label: "เข้างาน",
    tone: "var(--tone-ok)",
    icon: "Clock",
    match: (e) => e.event_intent === "CLOCK_IN" || e.event_intent === "AUTO",
  },
  {
    key: "out",
    label: "ออกงาน",
    tone: "var(--tone-danger)",
    icon: "Clock",
    match: (e) => e.event_intent === "CLOCK_OUT",
  },
  {
    key: "late",
    label: "มาสาย",
    tone: "var(--tone-warn)",
    icon: "TriangleAlert",
    match: (e) => e.late_minutes > 0,
  },
  {
    key: "break",
    label: "พัก",
    tone: "var(--tone-muted)",
    icon: "Clock",
    match: (e) => e.event_intent === "BREAK_START" || e.event_intent === "BREAK_END",
  },
  {
    key: "site",
    label: "ไซต์งาน",
    tone: "var(--tone-muted)",
    icon: "Home",
    match: (e) =>
      e.event_intent === "SITE_CHECK_IN" || e.event_intent === "SITE_CHECK_OUT",
  },
];

function timeOf(iso: string, timeZone = "Asia/Bangkok"): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 480 → "08:00" — เวลาเข้ากะเก็บเป็นนาทีจากเที่ยงคืน */
function fromMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function AttendanceTimeline({ events }: { events: TimeEvent[] }) {
  // ว่าง = ไม่กรอง (เห็นทุกอย่าง) — ตรงกับที่คนคาดหวังตอนเพิ่งเปิดหน้า
  const [active, setActive] = useState<Set<string>>(new Set());

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const bucket of BUCKETS) {
      out[bucket.key] = events.filter(bucket.match).length;
    }
    return out;
  }, [events]);

  const visible = useMemo(() => {
    if (active.size === 0) return events;
    const picked = BUCKETS.filter((b) => active.has(b.key));
    return events.filter((e) => picked.some((b) => b.match(e)));
  }, [events, active]);

  function toggle(key: string) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      {/* ── ตัวกรอง ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        {BUCKETS.map((bucket) => {
          const on = active.has(bucket.key);
          return (
            <button
              key={bucket.key}
              type="button"
              onClick={() => toggle(bucket.key)}
              aria-pressed={on}
              className="flex items-center gap-3 rounded-(--radius) border bg-(--bg) p-3 text-left transition-colors hover:bg-(--bg-soft) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--app)/30"
              style={{
                borderColor: on
                  ? `color-mix(in srgb, ${bucket.tone} 55%, transparent)`
                  : "var(--line)",
                backgroundColor: on
                  ? `color-mix(in srgb, ${bucket.tone} 8%, transparent)`
                  : undefined,
              }}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor: `color-mix(in srgb, ${bucket.tone} 14%, transparent)`,
                  color: bucket.tone,
                }}
              >
                <Icon name={bucket.icon} className="h-4 w-4" />
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className="block text-xl font-bold leading-none tabular-nums"
                  style={{ color: bucket.tone }}
                >
                  {counts[bucket.key] ?? 0}
                </span>
                <span className="mt-0.5 block truncate text-xs text-(--ink-soft)">
                  {bucket.label}
                </span>
              </span>

              <span
                aria-hidden
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border"
                style={{
                  borderColor: on ? bucket.tone : "var(--line)",
                  backgroundColor: on ? bucket.tone : "transparent",
                }}
              >
                {on && (
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                    <path
                      d="M2.5 6.2 4.8 8.5 9.5 3.8"
                      stroke="white"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
            </button>
          );
        })}

        {active.size > 0 && (
          <button
            type="button"
            onClick={() => setActive(new Set())}
            className="mt-1 text-xs text-(--ink-soft) underline-offset-2 hover:underline"
          >
            ล้างตัวกรอง
          </button>
        )}
      </div>

      {/* ── รายการลงเวลา ─────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        {visible.length === 0 ? (
          <div className="rounded-(--radius) border border-(--line) bg-(--bg) p-10 text-center text-sm text-(--ink-soft)">
            {events.length === 0
              ? "วันนี้ยังไม่มีใครลงเวลา"
              : "ไม่มีรายการที่ตรงกับตัวกรองที่เลือก"}
          </div>
        ) : (
          visible.map((event) => {
            const tone = eventIntentTone(event.event_intent);
            return (
              <div
                key={event.id}
                className="flex items-center gap-3 rounded-(--radius) border border-(--line) bg-(--bg) p-3"
              >
                <Avatar name={event.display_name} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span
                      className="text-[11px] font-bold uppercase tracking-wide"
                      style={{ color: tone }}
                    >
                      {eventIntentLabel(event.event_intent)}
                    </span>
                    {event.late_minutes > 0 && (
                      <span
                        className="rounded-full px-2 py-px text-[10px] font-medium"
                        style={{
                          color: "var(--tone-warn)",
                          backgroundColor:
                            "color-mix(in srgb, var(--tone-warn) 14%, transparent)",
                        }}
                      >
                        สาย {event.late_minutes} นาที
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm font-medium text-(--ink)">
                    {event.display_name}
                  </p>
                  <p className="truncate text-[11px] text-(--ink-soft)">
                    {event.employee_code}
                    {event.scheduled_start_minutes !== null && (
                      <> · เข้ากะ {fromMinutes(event.scheduled_start_minutes)}</>
                    )}
                    {event.is_rest_day && <> · วันหยุดตามกะ</>}
                  </p>
                </div>

                {/* ช่องทางที่ใช้ตอก — บอกว่าเวลานี้มาจากไหน เชื่อถือได้แค่ไหน */}
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-(--ink-soft)"
                  style={{ backgroundColor: "var(--bg-soft)" }}
                  title={eventSourceLabel(event.source_type)}
                >
                  <Icon name={eventSourceIcon(event.source_type)} className="h-4 w-4" />
                </span>

                <span className="shrink-0 font-mono text-sm tabular-nums text-(--ink)">
                  {timeOf(event.captured_at)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
