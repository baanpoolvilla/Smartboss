"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { submitLeaveAction, type LeaveState } from "../actions";

const EMPTY: LeaveState = {};

/** สัปดาห์เริ่มวันจันทร์ตามที่ใช้กันในที่ทำงาน ไม่ใช่วันอาทิตย์แบบปฏิทินสากล */
const DOW = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
const DOW_FULL = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];

export interface DayEntry {
  employmentId: string;
  name: string;
  status: "PENDING" | "APPROVED";
  mine: boolean;
}

export interface PersonLegend {
  id: string;
  name: string;
}

/**
 * สีประจำตัวคน — คำนวณจาก id ให้คงที่ ไม่ใช่สุ่มหรือไล่ตามลำดับในลิสต์
 * ถ้าไล่ตามลำดับ พอมีคนลาออกสีของทุกคนจะเลื่อนหมด จำกันไม่ได้
 */
function hueOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  // เลี่ยงช่วง 55-75 (เหลืองอ่อน) ที่อ่านบนพื้นขาวไม่ออก
  return hash >= 55 && hash <= 75 ? (hash + 40) % 360 : hash;
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function LeaveCalendar({
  month,
  today,
  employmentId,
  leaveTypes,
  entriesByDate,
  people,
}: {
  month: string;
  today: string;
  employmentId: string | null;
  leaveTypes: { id: string; label: string }[];
  entriesByDate: Record<string, DayEntry[]>;
  people: PersonLegend[];
}) {
  const [state, formAction, pending] = useActionState(submitLeaveAction, EMPTY);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const canRequest = employmentId !== null && leaveTypes.length > 0;

  /** 6 สัปดาห์เต็มเสมอ — ความสูงปฏิทินจะได้ไม่กระโดดเวลาสลับเดือน */
  const grid = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(Date.UTC(y!, m! - 1, 1));
    // getUTCDay(): 0=อาทิตย์ → แปลงเป็นดัชนีที่จันทร์=0
    const offset = (first.getUTCDay() + 6) % 7;
    const start = new Date(first.getTime() - offset * 86_400_000);
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(start.getTime() + i * 86_400_000);
      return { iso: toISO(date), day: date.getUTCDate(), inMonth: date.getUTCMonth() === m! - 1 };
    });
  }, [month]);

  function toggle(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="employment_id" value={employmentId ?? ""} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
        {/* ── แถบซ้าย: ใครหยุดบ้าง เปิด/ปิดดูรายคนได้ ── */}
        <aside className="order-2 lg:order-1">
          <p className="mb-2 text-xs font-semibold text-(--ink)">ปฏิทินของทีม</p>
          <div className="flex flex-col gap-0.5">
            {people.length === 0 && (
              <p className="text-xs text-(--ink-soft)">ยังไม่มีใครลงวันหยุดเดือนนี้</p>
            )}
            {people.map((person) => {
              const off = hidden.has(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => toggle(person.id)}
                  aria-pressed={!off}
                  className="flex items-center gap-2 rounded-(--radius) px-1.5 py-1 text-left text-xs transition-colors hover:bg-(--bg-soft)"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border-2"
                    style={{
                      borderColor: `hsl(${hueOf(person.id)} 60% 50%)`,
                      backgroundColor: off
                        ? "transparent"
                        : `hsl(${hueOf(person.id)} 60% 50%)`,
                    }}
                  />
                  <span
                    className="truncate"
                    style={{
                      color: off ? "var(--ink-soft)" : "var(--ink)",
                      textDecoration: off ? "line-through" : "none",
                    }}
                  >
                    {person.name}
                    {person.id === employmentId ? " (คุณ)" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── ตารางเดือน ── */}
        <div className="order-1 min-w-0 overflow-x-auto lg:order-2">
          <div className="min-w-[38rem]">
            <div className="grid grid-cols-7 border-b border-(--line) pb-1">
              {DOW.map((d, i) => (
                <span
                  key={d}
                  className="text-center text-xs font-medium text-(--ink-soft)"
                  title={DOW_FULL[i]}
                >
                  {d}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {grid.map((cell) => {
                const all = entriesByDate[cell.iso] ?? [];
                const entries = all.filter((e) => !hidden.has(e.employmentId));
                const iAmOff = all.some((e) => e.mine);
                const isToday = cell.iso === today;
                const selectable = canRequest && cell.inMonth && !iAmOff;

                const body = (
                  <span
                    className="flex h-full min-h-24 flex-col gap-0.5 border-b border-r border-(--line) p-1 transition-colors peer-checked:bg-(--app-soft) peer-checked:outline-2 peer-checked:-outline-offset-2 peer-checked:outline-(--app)"
                    style={{ opacity: cell.inMonth ? 1 : 0.4 }}
                  >
                    <span className="flex justify-end">
                      <span
                        className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px]"
                        style={
                          isToday
                            ? {
                                backgroundColor: "var(--app)",
                                color: "white",
                                fontWeight: 700,
                              }
                            : { color: "var(--ink-soft)" }
                        }
                      >
                        {cell.day}
                      </span>
                    </span>

                    {entries.slice(0, 3).map((entry, index) => {
                      const hue = hueOf(entry.employmentId);
                      return (
                        <span
                          key={`${entry.employmentId}-${index}`}
                          title={`${entry.name} · ${entry.status === "APPROVED" ? "อนุมัติแล้ว" : "รออนุมัติ"}`}
                          className="truncate rounded-sm border-l-2 px-1 text-[10px] leading-4"
                          style={{
                            borderLeftColor: `hsl(${hue} 60% 50%)`,
                            backgroundColor: `hsl(${hue} 85% 94%)`,
                            color: `hsl(${hue} 55% 30%)`,
                            fontWeight: entry.mine ? 700 : 400,
                            // รออนุมัติ = จาง + มีจุด ต่างจากอนุมัติแล้วให้เห็นชัด
                            opacity: entry.status === "APPROVED" ? 1 : 0.65,
                          }}
                        >
                          {entry.status === "PENDING" ? "• " : ""}
                          {entry.name}
                        </span>
                      );
                    })}

                    {entries.length > 3 && (
                      <span className="px-1 text-[10px] text-(--ink-soft)">
                        +{entries.length - 3} คน
                      </span>
                    )}
                  </span>
                );

                if (!selectable) {
                  return (
                    <span key={cell.iso} className="block">
                      {body}
                    </span>
                  );
                }

                return (
                  <label key={cell.iso} className="block cursor-pointer">
                    <input
                      type="checkbox"
                      name="day"
                      value={cell.iso}
                      className="peer sr-only"
                    />
                    {body}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── แถบขอหยุด ── */}
      {canRequest ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-(--line) pt-3">
          <label className="flex min-w-44 flex-col gap-1">
            <span className="text-xs font-medium text-(--ink-soft)">ประเภทการลา *</span>
            <select
              name="leave_type_id"
              required
              defaultValue={leaveTypes[0]?.id}
              className="h-11 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm"
            >
              {leaveTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-(--ink-soft)">เหตุผล</span>
            <input
              name="reason"
              maxLength={500}
              placeholder="ธุระส่วนตัว"
              className="h-11 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm"
            />
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "กำลังส่ง…" : "ขอหยุดวันที่เลือก"}
          </Button>
        </div>
      ) : (
        <p className="border-t border-(--line) pt-3 text-sm text-(--ink-soft)">
          {employmentId === null
            ? "บัญชีนี้ยังไม่ถูกผูกกับทะเบียนพนักงาน — ดูปฏิทินได้แต่ขอลาเองไม่ได้ แจ้งฝ่ายบุคคลให้เพิ่มคุณเข้าทะเบียนก่อน"
            : "ยังไม่มีประเภทการลาในระบบ — ฝ่ายบุคคลต้องสร้างก่อนอย่างน้อยหนึ่งประเภท"}
        </p>
      )}

      {state.error && <p className="text-sm text-(--danger)">{state.error}</p>}
      {state.ok && (
        <div className="rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3 text-sm">
          <p className="font-medium">ส่งคำขอแล้ว {state.days} วัน</p>
          <p className="mt-1 text-(--ink-soft)">
            ขึ้นเป็นแถบจาง ๆ มีจุดนำหน้า = รออนุมัติ —{" "}
            <strong>ยังถูกนับเป็นขาดงานอยู่จนกว่าจะได้รับอนุมัติ</strong>
          </p>
        </div>
      )}
    </form>
  );
}
