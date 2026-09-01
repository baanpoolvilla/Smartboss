"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Button } from "@smartboss/ui/components/button";
import {
  cancelLeaveAction,
  submitLeaveAction,
  swapLeaveAction,
  type LeaveState,
  type SwapLeaveState,
} from "../actions";

const EMPTY: LeaveState = {};

/** สัปดาห์เริ่มวันจันทร์ตามที่ใช้กันในที่ทำงาน ไม่ใช่วันอาทิตย์แบบปฏิทินสากล */
const DOW = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
const DOW_FULL = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];

export interface DayEntry {
  employmentId: string;
  name: string;
  status: "PENDING" | "APPROVED";
  mine: boolean;
  /** มีค่าเฉพาะแถวของตัวเอง (mine) — ใช้กดยกเลิก คนอื่นไม่เห็น id ใบของคนอื่น */
  requestId?: string;
  /** มีค่าเฉพาะแถวของตัวเอง — ใช้ตอนสลับ (ต้องยื่นใบใหม่เป็นประเภทเดียวกับใบเดิม) */
  leaveTypeId?: string;
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
  leaveTypes: {
    id: string;
    label: string;
    autoApprove: boolean;
    monthlyQuotaDays: number;
  }[];
  entriesByDate: Record<string, DayEntry[]>;
  people: PersonLegend[];
}) {
  const [state, formAction, pending] = useActionState(submitLeaveAction, EMPTY);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // สลับวันหยุด — เลือกวันเดิมก่อน (กด "สลับ") แล้วเข้าโหมดคลิกเลือกวันใหม่
  const [swapFrom, setSwapFrom] = useState<{ date: string; leaveTypeId: string } | null>(null);
  const [swapResult, setSwapResult] = useState<SwapLeaveState | null>(null);
  const [swapPending, startSwapTransition] = useTransition();

  function requestSwap(toDate: string) {
    if (swapFrom === null) return;
    if (!window.confirm(`ขอสลับวันหยุดจาก ${swapFrom.date} เป็น ${toDate} — ต้องรออนุมัติก่อนมีผล ดำเนินการ?`)) {
      return;
    }
    const fromDate = swapFrom.date;
    const leaveTypeId = swapFrom.leaveTypeId;
    startSwapTransition(async () => {
      const result = await swapLeaveAction({
        employmentId: employmentId ?? "",
        leaveTypeId,
        fromDate,
        toDate,
        reason: "",
      });
      setSwapResult(result);
      if (result.ok) setSwapFrom(null);
    });
  }

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

      {swapFrom !== null && (
        <div className="flex items-center justify-between gap-2 rounded-(--radius) border border-(--app) bg-(--app-soft) px-3 py-2 text-sm">
          <span>
            กำลังสลับวันหยุดจาก <strong>{swapFrom.date}</strong> — คลิกวันที่ต้องการสลับไปในปฏิทิน
            (ต้องรออนุมัติก่อนมีผล)
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => setSwapFrom(null)}>
            ยกเลิก
          </Button>
        </div>
      )}
      {swapResult?.error && <p className="text-sm text-(--danger)">{swapResult.error}</p>}
      {swapResult?.ok && (
        <p className="text-sm text-(--ink-soft)">
          ส่งคำขอสลับแล้ว — วันเดิมยังเป็นวันหยุดของคุณจนกว่าจะได้รับอนุมัติ
        </p>
      )}

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

                // โหมดกำลังสลับวันหยุด — ปฏิทินทั้งหมดกลายเป็นตัวเลือกวันใหม่
                // (ยกเว้นวันเดิมที่กำลังจะสลับจาก และวันนอกเดือน)
                if (swapFrom !== null) {
                  const pickable = cell.inMonth && cell.iso !== swapFrom.date && !iAmOff;
                  if (!pickable) {
                    return (
                      <span key={cell.iso} className="block" style={cell.iso === swapFrom.date ? { outline: "2px dashed var(--app)", outlineOffset: "-2px" } : undefined}>
                        {body}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      disabled={swapPending}
                      onClick={() => requestSwap(cell.iso)}
                      className="block w-full text-left hover:bg-(--app-soft)"
                    >
                      {body}
                    </button>
                  );
                }

                if (!selectable) {
                  // วันที่เป็นของฉันเอง (ติ๊กไว้แล้ว) มีปุ่มยกเลิก/สลับให้กด — ใช้
                  // formAction ของปุ่มแทนการซ้อน <form> (ซ้อนฟอร์มทำไม่ได้ใน
                  // HTML) ปุ่มนี้ยิงไปคนละ action จากปุ่ม "ขอหยุด" ด้านล่าง
                  // แม้จะอยู่ใน <form> เดียวกัน · ปุ่มสลับไม่ใช่ formAction เพราะ
                  // ต้องเข้าโหมดเลือกวันใหม่ก่อน ไม่ใช่ยิง request ทันที
                  const mine = all.find((e) => e.mine);
                  return (
                    <span key={cell.iso} className="relative block">
                      {body}
                      {mine?.requestId && (
                        <span className="absolute right-0.5 top-0.5 flex gap-0.5">
                          {mine.leaveTypeId && (
                            <button
                              type="button"
                              title="สลับวันหยุดนี้ไปวันอื่น (ต้องรออนุมัติ)"
                              onClick={() => {
                                setSwapResult(null);
                                setSwapFrom({ date: cell.iso, leaveTypeId: mine.leaveTypeId! });
                              }}
                              className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-(--ink-soft) hover:bg-(--app) hover:text-white"
                            >
                              ⇄
                            </button>
                          )}
                          <button
                            type="submit"
                            formAction={cancelLeaveAction}
                            name="requestId"
                            value={mine.requestId}
                            title="ยกเลิกวันหยุดนี้"
                            onClick={(e) => {
                              if (!window.confirm(`ยกเลิกวันหยุดวันที่ ${cell.iso} ?`)) {
                                e.preventDefault();
                              }
                            }}
                            className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-(--ink-soft) hover:bg-(--danger) hover:text-white"
                          >
                            ×
                          </button>
                        </span>
                      )}
                    </span>
                  );
                }

                return (
                  <label key={cell.iso} className="relative block cursor-pointer">
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
                  {t.autoApprove
                    ? ` — ไม่ต้องอนุมัติ${t.monthlyQuotaDays > 0 ? ` (${t.monthlyQuotaDays} วัน/เดือน)` : ""}`
                    : " — ต้องรออนุมัติ"}
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
          <p className="font-medium">บันทึกแล้ว {state.days} วัน</p>
          <p className="mt-1 text-(--ink-soft)">
            ประเภทที่เป็น <strong>สิทธิ์</strong> มีผลทันที ขึ้นเป็นแถบสีเข้ม ·
            ประเภทที่ <strong>ต้องอนุมัติ</strong> ขึ้นเป็นแถบจางมีจุดนำหน้า และ
            <strong>ยังถูกนับเป็นขาดงานอยู่จนกว่าจะได้รับอนุมัติ</strong>
          </p>
        </div>
      )}
    </form>
  );
}
