"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

import { cn } from "@smartboss/ui/cn";
import { assignShiftAction, deleteOtAction, saveOtAction, setDaysOffAction } from "../actions";
import { baht, hoursLabel, minutesToHm, otMinutes, shiftMonth, type DayCell, type MonthData, type WorkerMonth } from "../lib/types";
import { TimeEditFix } from "./time-edit-fix";

const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

const CELL_CLASS: Record<string, string> = {
  m: "bg-(--tone-ok)/12 text-(--tone-ok)",
  s: "bg-(--tone-warn)/15 text-(--tone-warn) font-bold",
  x: "bg-(--tone-danger)/12 text-(--tone-danger) font-bold",
  n: "bg-(--bg-soft) text-(--ink-soft)",
  o: "bg-slate-200 text-slate-700 font-bold dark:bg-slate-700 dark:text-slate-100",
  l: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
  r: "bg-(--bg-soft) text-(--ink-soft)",
  "": "text-(--ink-soft)",
};
const CELL_LABEL: Record<string, string> = { m: "", s: "สาย", x: "ขาด", n: "–", o: "หยุด", l: "ลา", r: "หยุดกะ", "": "" };

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y + 543}`;
}

function describe(c: DayCell | undefined): string {
  if (!c) return "ยังไม่มีข้อมูล";
  const parts: string[] = [];
  if (c.s === "m") parts.push(c.override ? `มา (แก้โดย ${c.override.byName} · ${c.override.reason})` : "มา");
  if (c.s === "s") parts.push(`สาย ${c.lateMin ?? 0} นาที`);
  if (c.s === "x") parts.push("ขาด (ไม่ลงออก)");
  if (c.s === "n") parts.push("ไม่มา");
  if (c.s === "o") parts.push("หยุด");
  if (c.s === "l") parts.push(c.leave?.name ?? "ลา");
  if (c.s === "r") parts.push("วันหยุดตามกะ");
  if (c.inAt) parts.push(`เข้า ${c.inAt}${c.outAt ? ` · ออก ${c.outAt}` : ""}`);
  if (c.early) parts.push(`กลับก่อน${c.earlyMin ? ` ${c.earlyMin} นาที` : ""}`);
  if (c.edit) parts.push(`แก้เวลาโดย ${c.edit.byName} · ${c.edit.reason} (สแกนจริง ${c.edit.scannedIn ?? "--:--"}–${c.edit.scannedOut ?? "--:--"})`);
  if (c.pay) parts.push(`ค่าแรง ${baht(c.pay.total)} บาท${c.pay.deduct ? ` (หัก ${baht(c.pay.deduct)})` : ""}${c.pay.ot ? ` (OT +${baht(c.pay.ot)})` : ""}`);
  if (c.leave && c.s !== "l") parts.push(`${c.leave.name}`);
  if (c.leave?.byName) parts.push(`ลงโดย ${c.leave.byName}`);
  if (c.ot) parts.push(`OT ${c.ot.start}–${c.ot.end} (${hoursLabel(c.ot.minutes)}) โดย ${c.ot.byName}`);
  return parts.join(" · ") || "ยังไม่มีข้อมูล";
}

export function WorkerRoster({ data, canManage, canOverride }: { data: MonthData; canManage: boolean; canOverride: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<null | boolean>(null);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [otForm, setOtForm] = useState<null | { day: number; employmentIds: string[]; start: string; end: string; note: string }>(null);
  const [focus, setFocus] = useState<null | { employmentId: string; day: number }>(null);
  const [shiftFor, setShiftFor] = useState<null | { employmentId: string; name: string; shiftId: string; from: string }>(null);

  const isCurrentMonth = data.today.startsWith(data.month);
  const todayDay = isCurrentMonth ? Number(data.today.slice(8, 10)) : 0;
  const firstWd = new Date(`${data.month}-01T12:00:00+07:00`).getUTCDay();
  const wdOf = (d: number) => (firstWd + d - 1) % 7;
  // สัปดาห์ จ.–อา. ที่วันนี้อยู่ (คอลัมน์ "สัปดาห์นี้" และปุ่มคัดลอก)
  const weekStart = todayDay ? todayDay - ((wdOf(todayDay) + 6) % 7) : 0;

  const depts = useMemo(
    () => [...new Map(data.workers.filter((w) => w.departmentId).map((w) => [w.departmentId!, w.departmentName ?? ""])).entries()],
    [data.workers],
  );
  const visible = data.workers.filter(
    (w) => (!q.trim() || w.name.toLowerCase().includes(q.trim().toLowerCase()) || (w.employeeCode ?? "").toLowerCase().includes(q.trim().toLowerCase())) && (!dept || w.departmentId === dept),
  );
  const noShift = data.workers.filter((w) => w.employmentId && !w.shiftId).length;
  const noEmployment = data.workers.filter((w) => !w.employmentId).length;
  const days = Array.from({ length: data.days }, (_, i) => i + 1);

  const key = (w: WorkerMonth, d: number) => `${w.employmentId}:${d}`;
  function setCell(next: Set<string>, k: string, on: boolean) {
    if (on) next.add(k);
    else next.delete(k);
  }
  function selectedCells() {
    return [...sel].map((k) => {
      const [employmentId, day] = k.split(":") as [string, string];
      return { employmentId, day: Number(day) };
    });
  }

  function run(task: () => Promise<{ ok?: true; done?: number; skipped?: number; error?: string }>, ok: (r: { done?: number; skipped?: number }) => string) {
    startTransition(async () => {
      const r = await task();
      if (r.error) setStatus(`⚠ ${r.error}`);
      else {
        setStatus(ok(r));
        setSel(new Set());
        router.refresh();
      }
    });
  }

  function daysOff(mode: "off" | "clear") {
    const cells = selectedCells();
    run(
      () => setDaysOffAction({ month: data.month, cells, mode }),
      (r) =>
        `${mode === "off" ? "ลงหยุด" : "ยกเลิกหยุด"} ${r.done ?? 0} ช่อง` +
        (r.skipped ? ` · ข้าม ${r.skipped} ช่อง (${mode === "off" ? "ลงเวลาแล้ว/มีใบลาอยู่แล้ว" : "ไม่ใช่วันหยุดที่ผู้ดูแลลง"})` : "") +
        " — บันทึกแล้ว",
    );
  }

  function openOt() {
    const cells = selectedCells();
    const dayset = new Set(cells.map((c) => c.day));
    if (dayset.size !== 1) {
      setStatus("⚠ ลง OT ได้ทีละวัน — เลือกช่องของวันเดียวกัน (หลายคนได้)");
      return;
    }
    setOtForm({ day: cells[0]!.day, employmentIds: [...new Set(cells.map((c) => c.employmentId))], start: "17:00", end: "19:00", note: "" });
  }

  function copyLastWeek() {
    if (!weekStart || weekStart - 7 < 1) {
      setStatus("⚠ สัปดาห์ก่อนอยู่คนละเดือน — เปลี่ยนไปดูเดือนก่อนแล้วลงเอง");
      return;
    }
    const cells: { employmentId: string; day: number }[] = [];
    for (const w of visible) {
      if (!w.employmentId) continue;
      for (let i = 0; i < 7; i++) {
        const src = weekStart - 7 + i;
        const dst = weekStart + i;
        if (dst > data.days) continue;
        if (w.cells[src]?.s === "o" && !w.cells[dst]?.leave && !w.cells[dst]?.inAt) cells.push({ employmentId: w.employmentId, day: dst });
      }
    }
    if (cells.length === 0) {
      setStatus("สัปดาห์ก่อนไม่มีวันหยุดที่ต้องคัดลอก");
      return;
    }
    run(() => setDaysOffAction({ month: data.month, cells, mode: "off" }), (r) => `คัดลอกวันหยุดจากสัปดาห์ก่อน ${r.done ?? 0} วัน — บันทึกแล้ว`);
  }

  const focusWorker = focus ? data.workers.find((w) => w.employmentId === focus.employmentId) : undefined;
  const focusCell = focus && focusWorker ? focusWorker.cells[focus.day] : undefined;
  const focusDate = focus ? `${data.month}-${String(focus.day).padStart(2, "0")}` : "";

  return (
    <div className="flex flex-col gap-4">
      {(noShift > 0 || noEmployment > 0) && (
        <div role="status" className="rounded-(--radius) border border-(--tone-warn)/40 bg-(--tone-warn)/10 px-3 py-2 text-sm text-(--ink)">
          {noShift > 0 && <b>มี {noShift} คนยังไม่ผูกกะ — ระบบตัดสินมา/ขาดไม่ได้ </b>}
          {noEmployment > 0 && (
            <span>
              · {noEmployment} คนหาทะเบียนพนักงานไม่เจอ — อีเมลของบัญชีผู้ใช้ต้องตรงกับอีเมลในทะเบียนพนักงาน (HR → พนักงาน) แล้วกดบันทึกผู้ใช้คนนั้นที่หลังบ้านอีกครั้ง
            </span>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-(--line) bg-(--bg) overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-(--line) px-4 py-3">
          <div className="flex items-center gap-1">
            <Link href={`?month=${shiftMonth(data.month, -1)}`} className="rounded-full p-1.5 hover:bg-(--bg-soft)" aria-label="เดือนก่อน">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <b className="min-w-32 text-center">{monthLabel(data.month)}</b>
            <Link href={`?month=${shiftMonth(data.month, 1)}`} className="rounded-full p-1.5 hover:bg-(--bg-soft)" aria-label="เดือนถัดไป">
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <span className="text-xs text-(--ink-soft)">{visible.length} คน</span>
          <span className="flex-1" />
          <input
            id="dw-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นชื่อ/รหัส"
            className="w-40 rounded-full border border-(--line) bg-(--bg) px-3 py-1.5 text-sm"
            aria-label="ค้นชื่อคนงาน"
          />
          {depts.length > 0 && (
            <select id="dw-dept" value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-full border border-(--line) bg-(--bg) px-3 py-1.5 text-sm" aria-label="กรองตามแผนก">
              <option value="">ทุกแผนก</option>
              {depts.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
          {canManage && isCurrentMonth && (
            <button type="button" disabled={pending} onClick={copyLastWeek} className="rounded-full border border-(--line) px-3 py-1.5 text-sm hover:bg-(--bg-soft) disabled:opacity-50">
              คัดลอกวันหยุดสัปดาห์ก่อน → สัปดาห์นี้
            </button>
          )}
          <a href={`/daily-workers/export?month=${data.month}`} className="inline-flex items-center gap-1 rounded-full border border-(--line) px-3 py-1.5 text-sm hover:bg-(--bg-soft)">
            <Download className="h-3.5 w-3.5" /> Excel
          </a>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2 border-b border-(--line) bg-sky-50 px-4 py-2 text-sm dark:bg-sky-950/30">
            <span className="text-(--ink-soft)">
              {sel.size === 0 ? "กด/ลากผ่านช่องเพื่อเลือก · กดหัววันที่ = ทั้งคอลัมน์ · กดชื่อ = ทั้งเดือน" : <b className="text-(--ink)">เลือก {sel.size} ช่อง</b>}
            </span>
            <span className="flex-1" />
            <button type="button" disabled={pending || sel.size === 0} onClick={() => daysOff("off")} className="rounded-full bg-slate-700 px-3 py-1.5 font-semibold text-white disabled:opacity-40">
              ลงหยุด
            </button>
            <button type="button" disabled={pending || sel.size === 0} onClick={() => daysOff("clear")} className="rounded-full border border-(--line) bg-(--bg) px-3 py-1.5 disabled:opacity-40">
              ยกเลิกหยุด
            </button>
            <button type="button" disabled={pending || sel.size === 0} onClick={openOt} className="rounded-full bg-violet-600 px-3 py-1.5 font-semibold text-white disabled:opacity-40">
              ลง OT…
            </button>
            <button type="button" disabled={pending || sel.size === 0} onClick={() => setSel(new Set())} className="rounded-full border border-(--line) bg-(--bg) px-3 py-1.5 disabled:opacity-40">
              ล้างที่เลือก
            </button>
          </div>
        )}

        <div className="overflow-x-auto" onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}>
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-xs select-none">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-40 border-b border-r border-(--line) bg-(--bg-soft) px-3 py-1.5 text-left font-semibold text-(--ink-soft)">ชื่อ · กะ</th>
                {days.map((d) => (
                  <th
                    key={d}
                    scope="col"
                    onClick={() => {
                      if (!canManage) return;
                      const ws = visible.filter((w) => w.employmentId);
                      const all = ws.every((w) => sel.has(key(w, d)));
                      const next = new Set(sel);
                      ws.forEach((w) => setCell(next, key(w, d), !all));
                      setSel(next);
                    }}
                    className={cn(
                      "border-b border-(--line) bg-(--bg-soft) px-0 py-1 font-semibold tabular-nums",
                      canManage && "cursor-pointer",
                      d === todayDay ? "bg-amber-600 text-white" : wdOf(d) === 0 || wdOf(d) === 6 ? "text-(--tone-danger)" : "text-(--ink-soft)",
                    )}
                  >
                    {WD[wdOf(d)]}
                    <br />
                    {d}
                  </th>
                ))}
                {isCurrentMonth && <th className="border-b border-l border-(--line) bg-(--bg-soft) px-2 font-semibold text-(--ink-soft)">สัปดาห์นี้</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((w) => {
                const offWeek = weekStart ? days.filter((d) => d >= weekStart && d < weekStart + 7 && w.cells[d]?.s === "o").length : 0;
                return (
                  <tr key={w.userId}>
                    <td className="sticky left-0 z-10 border-b border-r border-(--line) bg-(--bg) px-3 py-1.5">
                      <button
                        type="button"
                        disabled={!canManage || !w.employmentId}
                        onClick={() => {
                          const all = days.every((d) => sel.has(key(w, d)));
                          const next = new Set(sel);
                          days.forEach((d) => setCell(next, key(w, d), !all));
                          setSel(next);
                        }}
                        className="block text-left font-semibold text-(--ink) disabled:cursor-default"
                      >
                        {w.name}
                      </button>
                      <span className="block text-[11px] text-(--ink-soft)">
                        {w.employeeCode ?? "ไม่มีทะเบียน"} ·{" "}
                        {w.shiftId ? (
                          <>
                            {minutesToHm(w.shiftStart)}–{minutesToHm(w.shiftEnd)}
                            {w.shiftFrom && <span className="text-(--tone-warn)"> (เริ่ม {Number(w.shiftFrom.slice(8))}/{Number(w.shiftFrom.slice(5, 7))})</span>}
                          </>
                        ) : (
                          <span className="text-(--tone-warn)">ยังไม่ผูกกะ</span>
                        )}
                        {canManage && w.employmentId && (
                          <button
                            type="button"
                            onClick={() => setShiftFor({ employmentId: w.employmentId!, name: w.name, shiftId: w.shiftId ?? data.shifts[0]?.id ?? "", from: data.today })}
                            className="ml-1 underline"
                          >
                            {w.shiftId ? "เปลี่ยน" : "ผูกกะ"}
                          </button>
                        )}
                      </span>
                    </td>
                    {days.map((d) => {
                      const c = w.cells[d];
                      const k = key(w, d);
                      const on = sel.has(k);
                      return (
                        <td key={d} className="border-b border-(--line) p-0 text-center">
                          <button
                            type="button"
                            disabled={!w.employmentId}
                            title={describe(c)}
                            aria-label={`${w.name} ${d} · ${describe(c)}`}
                            aria-pressed={on}
                            onMouseDown={(e) => {
                              if (!canManage) return;
                              e.preventDefault();
                              const next = new Set(sel);
                              setCell(next, k, !on);
                              setSel(next);
                              setDrag(!on);
                            }}
                            onMouseEnter={() => {
                              if (drag === null) return;
                              const next = new Set(sel);
                              setCell(next, k, drag);
                              setSel(next);
                            }}
                            onClick={(e) => {
                              // คีย์บอร์ด (Enter/Space) — เมาส์จัดการใน onMouseDown แล้ว
                              if (e.detail === 0 && canManage) {
                                const next = new Set(sel);
                                setCell(next, k, !on);
                                setSel(next);
                              }
                              setFocus({ employmentId: w.employmentId!, day: d });
                            }}
                            className={cn(
                              "relative h-8 w-full min-w-6 text-[10.5px] hover:brightness-95 disabled:cursor-default",
                              CELL_CLASS[c?.s ?? ""],
                              c?.early && "shadow-[inset_0_-3px_0_var(--tone-warn)]",
                              c?.edit && "underline decoration-dotted",
                              on && "bg-sky-100 text-sky-700 shadow-[inset_0_0_0_2px_#2563eb] dark:bg-sky-900/50 dark:text-sky-100",
                            )}
                          >
                            {c?.s === "m" && c.override ? "แก้" : CELL_LABEL[c?.s ?? ""]}
                            {c?.ot && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-violet-600" />}
                          </button>
                        </td>
                      );
                    })}
                    {isCurrentMonth && (
                      <td className={cn("whitespace-nowrap border-b border-l border-(--line) px-2 tabular-nums", offWeek === 0 ? "text-(--tone-warn)" : "text-(--ink-soft)")}>
                        {offWeek === 0 ? "ยังไม่มีหยุด" : `หยุด ${offWeek}`}
                      </td>
                    )}
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={data.days + 2} className="px-4 py-8 text-center text-sm text-(--ink-soft)">
                    {data.workers.length === 0 ? "ยังไม่มีคนงาน — ผูกบทบาท \"คนงาน\" (WORKER) ให้ผู้ใช้ที่หลังบ้านก่อน" : "ไม่พบคนงานที่ค้นหา"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-3 border-t border-(--line) px-4 py-2 text-xs text-(--ink-soft)">
          <span>✓ สีเขียว = มา</span>
          <span className="text-(--tone-warn)">สาย = ลงเข้าหลังเวลาเข้ากะ (หักตามนาที)</span>
          <span className="text-(--tone-danger)">ขาด = ไม่ลงออกทั้งวัน</span>
          <span>ขีดส้มล่าง = กลับก่อน (หักตามนาที)</span>
          <span>ขีดเส้นประ = ผู้ดูแลแก้เวลา</span>
          <span>– = ไม่มา</span>
          <span>หยุด = ผู้ดูแลลง</span>
          <span>จุดม่วง = มี OT</span>
          <span>แก้ = แก้เป็นมาแบบเดิม</span>
        </div>
        {status && (
          <div role="status" className="mx-4 mb-3 rounded-lg border border-(--line) bg-(--bg-soft) px-3 py-2 text-sm">
            {status}
          </div>
        )}
      </div>

      {focus && focusWorker && (
        <div className="rounded-2xl border border-(--line) bg-(--bg) p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <b>
              {focusWorker.name} · {Number(focusDate.slice(8))} {monthLabel(data.month)}
            </b>
            <span className="text-(--ink-soft)">{describe(focusCell)}</span>
            <span className="flex-1" />
            <button type="button" onClick={() => setFocus(null)} className="text-xs underline">
              ปิด
            </button>
          </div>
          {canOverride && focusDate <= data.today && !["o", "l", "r"].includes(focusCell?.s ?? "") && (
            <div className="mt-3">
              <TimeEditFix
                key={`${focus.employmentId}:${focusDate}`}
                employmentId={focus.employmentId}
                date={focusDate}
                inAt={focusCell?.inAt ?? null}
                outAt={focusCell?.outAt ?? null}
                shiftStart={focusWorker.shiftId ? minutesToHm(focusWorker.shiftStart) : null}
                shiftEnd={focusWorker.shiftId ? minutesToHm(focusWorker.shiftEnd) : null}
                cell={focusCell ?? null}
              />
            </div>
          )}
          {canManage && focusCell?.ot && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteOtAction({ employmentId: focus.employmentId, date: focusDate }), () => "ลบ OT แล้ว")}
              className="ml-2 mt-3 rounded-full border border-(--line) px-3 py-1.5"
            >
              ลบ OT วันนี้
            </button>
          )}
        </div>
      )}

      {otForm && (
        <div className="rounded-2xl border border-violet-300 bg-(--bg) p-4 text-sm">
          <b>
            ลง OT · {otForm.day} {monthLabel(data.month)} · {otForm.employmentIds.length} คน
          </b>
          <p className="mt-1 text-xs text-(--ink-soft)">
            {otForm.employmentIds.map((id) => data.workers.find((w) => w.employmentId === id)?.name).filter(Boolean).join(", ")}
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              เริ่ม
              <input id="dw-ot-start" type="time" value={otForm.start} onChange={(e) => setOtForm({ ...otForm, start: e.target.value })} className="rounded-lg border border-(--line) bg-(--bg) px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1">
              จบ
              <input id="dw-ot-end" type="time" value={otForm.end} onChange={(e) => setOtForm({ ...otForm, end: e.target.value })} className="rounded-lg border border-(--line) bg-(--bg) px-2 py-1" />
            </label>
            <span className="pb-1.5 font-bold text-violet-700">รวม {otForm.start && otForm.end ? hoursLabel(otMinutes(otForm.start, otForm.end)) : "—"} ต่อคน</span>
            <label className="flex min-w-48 flex-1 flex-col gap-1">
              หมายเหตุ (ไม่บังคับ)
              <input id="dw-ot-note" value={otForm.note} onChange={(e) => setOtForm({ ...otForm, note: e.target.value })} className="rounded-lg border border-(--line) bg-(--bg) px-2 py-1" />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const f = otForm;
                run(
                  () => saveOtAction({ employmentIds: f.employmentIds, date: `${data.month}-${String(f.day).padStart(2, "0")}`, start: f.start, end: f.end, note: f.note }),
                  (r) => `ลง OT ${f.start}–${f.end} ให้ ${r.done ?? 0} คน — บันทึกแล้ว`,
                );
                setOtForm(null);
              }}
              className="rounded-full bg-violet-600 px-4 py-1.5 font-semibold text-white disabled:opacity-40"
            >
              บันทึก OT
            </button>
            <button type="button" onClick={() => setOtForm(null)} className="rounded-full border border-(--line) px-4 py-1.5">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {shiftFor && (
        <div className="rounded-2xl border border-(--line) bg-(--bg) p-4 text-sm">
          <b>ผูกกะ · {shiftFor.name}</b>
          {data.shifts.length === 0 ? (
            <p className="mt-2 text-(--ink-soft)">ยังไม่มีกะในระบบบุคคล — ให้ HR สร้างกะที่ HR → ตั้งค่า → กะทำงาน ก่อน</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                กะ
                <select id="dw-shift" value={shiftFor.shiftId} onChange={(e) => setShiftFor({ ...shiftFor, shiftId: e.target.value })} className="rounded-lg border border-(--line) bg-(--bg) px-2 py-1">
                  {data.shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {minutesToHm(s.start)}–{minutesToHm(s.end)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                เริ่มใช้ตั้งแต่
                <input id="dw-shift-from" type="date" value={shiftFor.from} onChange={(e) => setShiftFor({ ...shiftFor, from: e.target.value })} className="rounded-lg border border-(--line) bg-(--bg) px-2 py-1" />
              </label>
              <button
                type="button"
                disabled={pending || !shiftFor.shiftId}
                onClick={() => {
                  const f = shiftFor;
                  run(() => assignShiftAction({ employmentId: f.employmentId, shiftId: f.shiftId, from: f.from }), () => `ผูกกะให้ ${f.name} แล้ว`);
                  setShiftFor(null);
                }}
                className="rounded-full bg-(--ink) px-4 py-1.5 font-semibold text-(--bg) disabled:opacity-40"
              >
                บันทึกกะ
              </button>
              <button type="button" onClick={() => setShiftFor(null)} className="rounded-full border border-(--line) px-4 py-1.5">
                ยกเลิก
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
