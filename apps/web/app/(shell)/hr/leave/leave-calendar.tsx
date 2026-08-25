"use client";

import { useActionState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { submitLeaveAction, type LeaveState } from "../actions";

const EMPTY: LeaveState = {};
const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

export interface DayEntry {
  /** ชื่อคนที่หยุดวันนั้น */
  name: string;
  status: "PENDING" | "APPROVED";
  mine: boolean;
}

/**
 * ปฏิทินเดือน — เห็นวันหยุดของทุกคน และคลิกวันเพื่อขอลาของตัวเอง
 *
 * ใช้ checkbox จริงซ่อนไว้แล้วจัดสไตล์ที่ label เหมือนหน้าวันหยุดรายคน
 * ไม่เก็บ state ใน React จอกับค่าที่ส่งจึงไม่มีทางไม่ตรงกัน
 */
export function LeaveCalendar({
  month,
  employmentId,
  leaveTypes,
  entriesByDate,
}: {
  month: string;
  employmentId: string | null;
  leaveTypes: { id: string; label: string }[];
  entriesByDate: Record<string, DayEntry[]>;
}) {
  const [state, formAction, pending] = useActionState(submitLeaveAction, EMPTY);

  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year!, mon!, 0)).getUTCDate();
  const leading = new Date(Date.UTC(year!, mon! - 1, 1)).getUTCDay();
  const canRequest = employmentId !== null && leaveTypes.length > 0;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="employment_id" value={employmentId ?? ""} />

      <div className="grid grid-cols-7 gap-1">
        {DOW.map((d) => (
          <span key={d} className="pb-1 text-center text-xs font-medium text-(--ink-soft)">
            {d}
          </span>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <span key={`pad${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const entries = entriesByDate[date] ?? [];
          const iAmOff = entries.some((e) => e.mine);

          const cell = (
            <span className="block h-full min-h-24 rounded-(--radius) border border-(--line) p-1.5 text-left transition-colors peer-checked:border-(--app) peer-checked:bg-(--app-soft) hover:bg-(--bg-soft)">
              <span className="block text-xs font-semibold text-(--ink)">{day}</span>
              <span className="mt-1 flex flex-col gap-0.5">
                {entries.slice(0, 3).map((e, index) => (
                  <span
                    key={`${e.name}-${index}`}
                    className="truncate rounded px-1 text-[10px] leading-4"
                    style={{
                      color: e.status === "APPROVED" ? "var(--tone-ok)" : "var(--tone-warn)",
                      backgroundColor:
                        e.status === "APPROVED"
                          ? "color-mix(in srgb, var(--tone-ok) 14%, transparent)"
                          : "color-mix(in srgb, var(--tone-warn) 14%, transparent)",
                      fontWeight: e.mine ? 700 : 400,
                    }}
                    title={`${e.name} · ${e.status === "APPROVED" ? "อนุมัติแล้ว" : "รออนุมัติ"}`}
                  >
                    {e.name}
                  </span>
                ))}
                {entries.length > 3 && (
                  <span className="px-1 text-[10px] text-(--ink-soft)">
                    +{entries.length - 3} คน
                  </span>
                )}
              </span>
            </span>
          );

          // วันที่ตัวเองขอไปแล้ว ห้ามคลิกซ้ำ — จะได้ใบซ้ำแล้วโดนปฏิเสธเปล่า ๆ
          if (!canRequest || iAmOff) {
            return (
              <span key={date} className="block">
                {cell}
              </span>
            );
          }

          return (
            <label key={date} className="block cursor-pointer">
              <input type="checkbox" name="day" value={date} className="peer sr-only" />
              {cell}
            </label>
          );
        })}
      </div>

      {canRequest ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-(--line) pt-3">
          <label className="flex min-w-48 flex-col gap-1">
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
          <label className="flex min-w-56 flex-1 flex-col gap-1">
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
            สถานะยังเป็น “รออนุมัติ” (สีส้ม) —{" "}
            <strong>ยังถูกนับเป็นขาดงานอยู่จนกว่าจะได้รับอนุมัติ</strong>
          </p>
        </div>
      )}
    </form>
  );
}
