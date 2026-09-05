"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "@/components/module/dialog";
import {
  cancelLeaveAction,
  relabelLeaveAction,
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
  /**
   * ชื่อประเภทการลา — `null` เมื่อบริษัทตั้งประเภทนั้นให้ไม่ขึ้นปฏิทินรวม
   * (leave_types.show_on_calendar) ใบของตัวเองเห็นประเภทเสมอ
   */
  leaveTypeName: string | null;
  /** ชื่อที่เจ้าของใบตั้งเอง · "" = ยังไม่ได้ตั้ง ให้ประกอบจากชื่อ+ประเภท */
  displayLabel: string;
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

export interface LeaveTypeChoice {
  id: string;
  label: string;
  autoApprove: boolean;
  monthlyQuotaDays: number;
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

/** ทุกวันตั้งแต่ from ถึง to (รวมปลายทั้งสองข้าง) — ใช้ตอนลงหยุดหลายวันรวดเดียว */
function datesInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
    if (out.length > 62) break; // กันช่วงเพี้ยนจนยิงคำขอเป็นร้อยใบ
  }
  return out;
}

function firstWord(name: string): string {
  return name.trim().split(" ")[0] || name;
}

/**
 * ชื่อที่ขึ้นบนปฏิทินของหนึ่งรายการ
 *
 * ใช้ชื่อที่เจ้าตัวตั้งไว้ก่อนเสมอ — ทีมนี้ย้ายมาจากปฏิทิน Teams ที่แต่ละคนตั้งชื่อ
 * วันหยุดของตัวเองเป็น "Bee-Off" · "Aui-V3/6" · "Parguy-Off-OT" ซึ่งบอกเรื่องที่
 * ระบบไม่รู้ (กะที่สลับ, ควงต่อ OT) และเป็นภาษาที่ทีมอ่านแล้วเข้าใจทันที
 * ถ้ายังไม่ได้ตั้ง ค่อยประกอบจากชื่อ + ประเภทให้เอง
 */
function labelOf(entry: DayEntry): string {
  if (entry.displayLabel.trim() !== "") return entry.displayLabel;
  return entry.leaveTypeName ? `${entry.name} - ${entry.leaveTypeName}` : entry.name;
}

export function LeaveCalendar({
  month,
  today,
  employmentId,
  myName,
  leaveTypes,
  entriesByDate,
  people,
}: {
  month: string;
  today: string;
  employmentId: string | null;
  /** ชื่อผู้ใช้ปัจจุบัน — ใช้ตั้งชื่อวันหยุดให้อัตโนมัติตอนเปิดฟอร์ม */
  myName: string;
  leaveTypes: LeaveTypeChoice[];
  entriesByDate: Record<string, DayEntry[]>;
  people: PersonLegend[];
}) {
  const [state, formAction, pending] = useActionState(submitLeaveAction, EMPTY);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  /** วันที่กดเปิดหน้าต่างอยู่ — null = ปิดอยู่ */
  const [picked, setPicked] = useState<string | null>(null);

  // สลับวันหยุด — เลือกวันเดิมก่อน (กด "สลับ") แล้วเข้าโหมดคลิกเลือกวันใหม่
  const [swapFrom, setSwapFrom] = useState<
    { date: string; leaveTypeId: string; displayLabel: string } | null
  >(null);
  const [swapResult, setSwapResult] = useState<SwapLeaveState | null>(null);
  const [busy, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  const canRequest = employmentId !== null && leaveTypes.length > 0;

  function requestSwap(toDate: string) {
    if (swapFrom === null) return;
    if (
      !window.confirm(
        `ขอสลับวันหยุดจาก ${swapFrom.date} เป็น ${toDate} — ต้องรออนุมัติก่อนมีผล ดำเนินการ?`,
      )
    ) {
      return;
    }
    const from = swapFrom;
    startTransition(async () => {
      const result = await swapLeaveAction({
        employmentId: employmentId ?? "",
        leaveTypeId: from.leaveTypeId,
        fromDate: from.date,
        toDate,
        reason: "",
        displayLabel: from.displayLabel,
      });
      setSwapResult(result);
      if (result.ok) setSwapFrom(null);
    });
  }

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

  const pickedEntries = picked === null ? [] : (entriesByDate[picked] ?? []);
  const pickedMine = pickedEntries.find((e) => e.mine);

  return (
    <div className="flex flex-col gap-3">
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
      {rowError && <p className="text-sm text-(--danger)">{rowError}</p>}
      {state.error && <p className="text-sm text-(--danger)">{state.error}</p>}
      {state.ok && (
        <p className="text-sm text-(--ink-soft)">
          บันทึกแล้ว {state.days} วัน — ประเภทที่เป็น <strong>สิทธิ์</strong> มีผลทันที ส่วนประเภทที่
          <strong> ต้องอนุมัติ</strong> ยังถูกนับเป็นขาดงานจนกว่าจะได้รับอนุมัติ
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
                      backgroundColor: off ? "transparent" : `hsl(${hueOf(person.id)} 60% 50%)`,
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

                const body = (
                  <span
                    className="flex h-full min-h-24 flex-col gap-0.5 border-b border-r border-(--line) p-1 text-left"
                    style={{ opacity: cell.inMonth ? 1 : 0.4 }}
                  >
                    <span className="flex justify-end">
                      <span
                        className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px]"
                        style={
                          isToday
                            ? { backgroundColor: "var(--app)", color: "white", fontWeight: 700 }
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
                          title={`${labelOf(entry)} · ${entry.status === "APPROVED" ? "อนุมัติแล้ว" : "รออนุมัติ"}`}
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
                          {labelOf(entry)}
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
                // (ยกเว้นวันเดิมที่กำลังจะสลับจาก และวันที่ตัวเองหยุดอยู่แล้ว)
                if (swapFrom !== null) {
                  const pickable = cell.inMonth && cell.iso !== swapFrom.date && !iAmOff;
                  if (!pickable) {
                    return (
                      <span
                        key={cell.iso}
                        className="block"
                        style={
                          cell.iso === swapFrom.date
                            ? { outline: "2px dashed var(--app)", outlineOffset: "-2px" }
                            : undefined
                        }
                      >
                        {body}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      disabled={busy}
                      onClick={() => requestSwap(cell.iso)}
                      className="block w-full text-left hover:bg-(--app-soft)"
                    >
                      {body}
                    </button>
                  );
                }

                /*
                 * ทุกช่องในเดือนเป็นปุ่มเปิดหน้าต่าง — ไม่ใช่ติ๊ก checkbox แล้วไปกด
                 * ปุ่มรวมท้ายฟอร์มแบบเดิม
                 *
                 * ของเดิมซ่อนปุ่มสลับ/ยกเลิกไว้เป็นไอคอนเทา 20px ที่วางทับตัวเลข
                 * วันที่พอดี จนเจ้าของถามเองว่า "ไหนอะสลับวันหยุดหรือยกเลิกวันหยุด"
                 * แบบกดแล้วเด้งหน้าต่าง (อย่างที่ทีมคุ้นจาก Teams ที่ใช้อยู่เดิม)
                 * ทำให้ทุกอย่างที่ทำกับวันนั้นได้อยู่ในที่เดียว มีชื่อกำกับครบ และ
                 * นิ้วกดโดนบนมือถือ
                 */
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    disabled={!cell.inMonth}
                    onClick={() => {
                      setRowError(null);
                      setSwapResult(null);
                      setPicked(cell.iso);
                    }}
                    className="block w-full text-left transition-colors enabled:hover:bg-(--bg-soft)"
                  >
                    {body}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {!canRequest && (
        <p className="border-t border-(--line) pt-3 text-sm text-(--ink-soft)">
          {employmentId === null
            ? "บัญชีนี้ยังไม่ถูกผูกกับทะเบียนพนักงาน — ดูปฏิทินได้แต่ขอลาเองไม่ได้ แจ้งฝ่ายบุคคลให้เพิ่มคุณเข้าทะเบียนก่อน"
            : "ยังไม่มีประเภทการลาในระบบ — ฝ่ายบุคคลต้องสร้างก่อนอย่างน้อยหนึ่งประเภท"}
        </p>
      )}

      {picked !== null && (
        <DayDialog
          key={picked}
          date={picked}
          myName={myName}
          entries={pickedEntries}
          mine={pickedMine}
          employmentId={employmentId}
          leaveTypes={leaveTypes}
          canRequest={canRequest}
          busy={busy}
          submitting={pending}
          onClose={() => setPicked(null)}
          formAction={formAction}
          onStartSwap={(entry) => {
            const from = picked;
            setPicked(null);
            setSwapResult(null);
            setSwapFrom({
              date: from,
              leaveTypeId: entry.leaveTypeId ?? "",
              displayLabel: entry.displayLabel,
            });
          }}
          onCancelDay={(requestId) => {
            if (!window.confirm(`ยกเลิกวันหยุดวันที่ ${picked} ?`)) return;
            const form = new FormData();
            form.set("requestId", requestId);
            form.set("reason", "ยกเลิกจากปฏิทินวันหยุด");
            setPicked(null);
            startTransition(async () => {
              try {
                await cancelLeaveAction(form);
              } catch (error) {
                setRowError(error instanceof Error ? error.message : "ยกเลิกไม่สำเร็จ");
              }
            });
          }}
          onRelabel={(requestId, nextLabel) => {
            setPicked(null);
            startTransition(async () => {
              const result = await relabelLeaveAction({ requestId, displayLabel: nextLabel });
              if (result.error) setRowError(result.error);
            });
          }}
        />
      )}
    </div>
  );
}

/**
 * หน้าต่างของวันที่กด — รวมทุกอย่างที่ทำกับวันนั้นได้ไว้ที่เดียว
 *
 * แยกเป็นคอมโพเนนต์ของตัวเองเพราะมี state ของฟอร์ม (ประเภท/ชื่อ/ถึงวันที่) ที่ต้อง
 * เริ่มใหม่ทุกครั้งที่เปิดวันใหม่ — ตัวแม่ส่ง key={picked} มาให้ React ทิ้งของเก่า
 */
function DayDialog({
  date,
  myName,
  entries,
  mine,
  employmentId,
  leaveTypes,
  canRequest,
  busy,
  submitting,
  onClose,
  formAction,
  onStartSwap,
  onCancelDay,
  onRelabel,
}: {
  date: string;
  myName: string;
  entries: DayEntry[];
  mine: DayEntry | undefined;
  employmentId: string | null;
  leaveTypes: LeaveTypeChoice[];
  canRequest: boolean;
  busy: boolean;
  submitting: boolean;
  onClose: () => void;
  formAction: (formData: FormData) => void;
  onStartSwap: (entry: DayEntry) => void;
  onCancelDay: (requestId: string) => void;
  onRelabel: (requestId: string, label: string) => void;
}) {
  const [typeId, setTypeId] = useState(leaveTypes[0]?.id ?? "");
  const [endDate, setEndDate] = useState(date);
  /** ผู้ใช้แตะช่องชื่อแล้วหรือยัง — ถ้ายัง ให้ชื่อวิ่งตามประเภทที่เลือกไปเรื่อย ๆ */
  const [labelTouched, setLabelTouched] = useState(false);
  const [label, setLabel] = useState(
    `${firstWord(myName)}-${leaveTypes[0]?.label ?? "หยุด"}`,
  );
  const [editLabel, setEditLabel] = useState(mine?.displayLabel ?? "");

  const dates = datesInclusive(date, endDate < date ? date : endDate);
  const fieldClass =
    "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm";

  // ── โหมดแก้ไข: วันนี้เป็นวันหยุดของเราอยู่แล้ว ──
  if (mine) {
    return (
      <Modal title={`วันหยุดของคุณ · ${date}`} onClose={onClose}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-(--ink-soft)">
            {mine.leaveTypeName ?? "ลา"} ·{" "}
            {mine.status === "APPROVED"
              ? "มีผลแล้ว"
              : "รออนุมัติ — ยังถูกนับเป็นขาดงานจนกว่าจะอนุมัติ"}
          </p>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-(--ink-soft)">ชื่อที่แสดงบนปฏิทิน</span>
            <input
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              maxLength={60}
              placeholder={`${firstWord(myName)}-${mine.leaveTypeName ?? "หยุด"}`}
              className={fieldClass}
            />
            <span className="text-xs text-(--ink-soft)">
              ปล่อยว่างเพื่อกลับไปใช้ชื่อที่ระบบตั้งให้ (ชื่อคุณ + ประเภท)
            </span>
          </label>

          <div className="flex flex-col gap-2 border-t border-(--line) pt-3">
            {mine.requestId && mine.leaveTypeId && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onStartSwap(mine)}
              >
                ⇄ สลับวันหยุดนี้ไปวันอื่น (ต้องรออนุมัติ)
              </Button>
            )}
            {mine.requestId && (
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() => onCancelDay(mine.requestId!)}
              >
                ยกเลิกวันหยุดวันนี้
              </Button>
            )}
            {!mine.requestId && (
              <p className="text-xs text-(--ink-soft)">
                ใบนี้ไม่ได้ยื่นจากบัญชีนี้ จึงแก้ไข/ยกเลิกจากที่นี่ไม่ได้ — ติดต่อฝ่ายบุคคล
              </p>
            )}
          </div>

          <div className="border-t border-(--line) pt-3">
            <OthersOnDay entries={entries} />
          </div>
        </div>

        <ModalActions
          onClose={onClose}
          confirm={
            mine.requestId ? (
              <Button
                type="button"
                disabled={busy || editLabel === mine.displayLabel}
                onClick={() => onRelabel(mine.requestId!, editLabel)}
              >
                {busy ? "กำลังบันทึก…" : "บันทึกชื่อ"}
              </Button>
            ) : null
          }
        />
      </Modal>
    );
  }

  // ── ดูอย่างเดียว: ลงวันหยุดเองไม่ได้ ──
  if (!canRequest) {
    return (
      <Modal title={`วันที่ ${date}`} onClose={onClose}>
        <OthersOnDay entries={entries} />
        <p className="mt-3 text-sm text-(--ink-soft)">
          {employmentId === null
            ? "บัญชีนี้ยังไม่ถูกผูกกับทะเบียนพนักงาน จึงลงวันหยุดเองไม่ได้"
            : "ยังไม่มีประเภทการลาในระบบ"}
        </p>
        <ModalActions onClose={onClose} confirm={null} />
      </Modal>
    );
  }

  // ── โหมดลงวันหยุดใหม่ ──
  return (
    <Modal title={`ลงวันหยุด · ${date}`} onClose={onClose}>
      {/*
        ฟอร์มจริงเป็น <form action={formAction}> ไม่ใช่ onClick แล้วเรียก action เอง
        — ยังส่งได้แม้ JS ยังโหลดไม่เสร็จ และ useActionState คุม pending ให้อยู่แล้ว
        ปุ่มยืนยันอยู่นอก <form> จึงผูกด้วย form="day-off-form"
      */}
      <form id="day-off-form" action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="employment_id" value={employmentId ?? ""} />
        {dates.map((d) => (
          <input key={d} type="hidden" name="day" value={d} />
        ))}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-(--ink-soft)">ประเภทการลา *</span>
          <select
            name="leave_type_id"
            required
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              if (!labelTouched) {
                const next = leaveTypes.find((t) => t.id === e.target.value);
                setLabel(`${firstWord(myName)}-${next?.label ?? "หยุด"}`);
              }
            }}
            className={fieldClass}
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

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-(--ink-soft)">ชื่อที่แสดงบนปฏิทิน</span>
          <input
            name="display_label"
            value={label}
            onChange={(e) => {
              setLabelTouched(true);
              setLabel(e.target.value);
            }}
            maxLength={60}
            className={fieldClass}
          />
          <span className="text-xs text-(--ink-soft)">
            ทั้งทีมเห็นชื่อนี้ — ใส่อะไรที่คนอ่านแล้วรู้เรื่อง เช่น “Bee-Off” หรือ “กาย-ควง OT”
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-(--ink-soft)">หยุดถึงวันที่</span>
          <input
            type="date"
            value={endDate}
            min={date}
            onChange={(e) => setEndDate(e.target.value || date)}
            className={fieldClass}
          />
          <span className="text-xs text-(--ink-soft)">
            {dates.length === 1
              ? "หยุดวันเดียว"
              : `หยุด ${dates.length} วัน (${date} ถึง ${endDate})`}
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-(--ink-soft)">เหตุผล</span>
          <input name="reason" maxLength={500} placeholder="ธุระส่วนตัว" className={fieldClass} />
          <span className="text-xs text-(--ink-soft)">เห็นเฉพาะผู้อนุมัติ ไม่ขึ้นบนปฏิทินรวม</span>
        </label>
      </form>

      <div className="mt-4 border-t border-(--line) pt-3">
        <OthersOnDay entries={entries} />
      </div>

      <ModalActions
        onClose={onClose}
        confirm={
          <Button type="submit" form="day-off-form" disabled={submitting}>
            {submitting
              ? "กำลังบันทึก…"
              : dates.length === 1
                ? "ลงวันหยุด"
                : `ลงวันหยุด ${dates.length} วัน`}
          </Button>
        }
      />
    </Modal>
  );
}

/** ใครหยุดวันนี้บ้าง — ทุกโหมดของหน้าต่างใช้ร่วมกัน */
function OthersOnDay({ entries }: { entries: DayEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-(--ink-soft)">วันนี้ยังไม่มีใครหยุด</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-(--ink-soft)">วันนี้หยุด {entries.length} คน</p>
      {entries.map((e, i) => (
        <p key={`${e.employmentId}-${i}`} className="text-sm">
          <span
            className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
            style={{ backgroundColor: `hsl(${hueOf(e.employmentId)} 60% 50%)` }}
          />
          {labelOf(e)}
          {e.status === "PENDING" && <span className="text-(--ink-soft)"> · รออนุมัติ</span>}
        </p>
      ))}
    </div>
  );
}

/**
 * แถวปุ่มท้ายหน้าต่าง — Modal รับ actions เป็น node เดียว ที่นี่จึงห่อ "ปิด" คู่กับ
 * ปุ่มยืนยันของแต่ละโหมดไว้ ไม่ต้องเขียนซ้ำสามที่
 */
function ModalActions({ onClose, confirm }: { onClose: () => void; confirm: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-(--line) pt-3">
      <Button type="button" variant="outline" onClick={onClose}>
        ปิด
      </Button>
      {confirm}
    </div>
  );
}
