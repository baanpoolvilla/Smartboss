"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Printer, SlidersHorizontal } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "@/components/module/dialog";
import { leaveTypeHint, usableLeaveTypes, type LeaveTypeChoice } from "@/modules/hr/lib/leave-type-choice";
import {
  cancelLeaveAction,
  cancelLeaveForAction,
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
  /** มีค่าในแถวของตัวเอง (กดยกเลิกเอง) และ — เฉพาะผู้อนุมัติ — แถวของคนอื่น (ปุ่ม "ยกเลิกให้")
   *  พนักงานทั่วไปไม่เห็น id ใบของคนอื่น */
  requestId?: string;
  /** มีค่าเฉพาะแถวของตัวเอง — ใช้ตอนสลับ (ต้องยื่นใบใหม่เป็นประเภทเดียวกับใบเดิม) */
  leaveTypeId?: string;
  /** true = สิทธิ์ (เช่น "วันหยุดประจำเดือน") ไม่ใช่การลาที่ต้องรออนุมัติ */
  autoApprove: boolean;
}

export interface PersonLegend {
  id: string;
  name: string;
}

export type { LeaveTypeChoice };

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

/**
 * สีประจำประเภท — รายการบนปฏิทินและชิปกรองใช้สีเดียวกัน (แบบปฏิทินของโมดูลรายงาน/งาน)
 * เดาจากชื่อประเภทที่ HR ตั้ง: ชื่อที่ไม่เข้าเค้าไหนเลยได้สีจากชื่อ (คงที่ ไม่สุ่ม)
 */
function typeHue(name: string | null, autoApprove: boolean): number {
  const n = (name ?? "").toLowerCase();
  if (/holiday|ฮอลิเดย์|นักขัตฤกษ์/.test(n)) return 215; // น้ำเงิน
  if (/day.?off|หยุดประจำ|^off$/.test(n)) return 150; // เขียว
  if (/ป่วย|sick/.test(n)) return 0; // แดง
  if (/กิจ|personal/.test(n)) return 175; // เขียวอมฟ้า
  if (/พักร้อน|vacation|annual/.test(n)) return 38; // เหลืองส้ม
  if (/home|wfh/.test(n)) return 18; // ส้ม
  if (/ค่าจ้าง|unpaid/.test(n)) return 280; // ม่วง
  return name ? hueOf(name) : autoApprove ? 150 : 215;
}

/** ชื่อประเภทที่ไม่รู้ (HR ตั้งให้ไม่แสดงประเภทบนปฏิทินรวม) — กลุ่มของมันในตัวกรอง */
const UNNAMED_TYPE = "__unnamed__";

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
  const standard = entry.leaveTypeName ? `${entry.name} - ${entry.leaveTypeName}` : entry.name;
  const custom = entry.displayLabel.trim();
  if (custom === "") return standard;
  // ชื่อที่ฟอร์มเติมให้เอง ("<ชื่อ>-<ประเภท>") ไม่ใช่ชื่อที่เจ้าตัวตั้งใจตั้ง — แต่ละหน้าที่ลงวันหยุดได้เติมชื่อคน
  // คนละแบบ ("Nok-Day-Off" / "Waratta-Nok-Day-Off") คนเดียวกันเลยขึ้นไม่เหมือนกันบนปฏิทิน
  // ⇒ ถ้าลงท้ายด้วยชื่อประเภทพอดี ใช้รูปแบบมาตรฐานเดียวกันหมด · ชื่อที่ตั้งเองจริง ๆ ("Bee-Off", "Aui-V3/6") คงไว้
  if (entry.leaveTypeName && endsWithTypeName(custom, entry.leaveTypeName)) return standard;
  return custom;
}

/** "Waratta-Nok-Day-Off" ลงท้ายด้วยประเภท "Day-Off" ไหม — ไม่สนตัวพิมพ์/ช่องว่าง/ขีด */
function endsWithTypeName(label: string, typeName: string): boolean {
  const norm = (v: string) => v.toLowerCase().replace(/[\s_–—-]+/g, "");
  const t = norm(typeName);
  return t.length > 0 && norm(label).endsWith(t);
}

/** รายการที่โชว์ต่อช่องวัน — ที่เหลือรวมเป็นป้าย "+N รายการ" (กดวันนั้นเพื่อดูทั้งหมด) */
const MAX_PER_DAY = 2;
/** จอกว้าง (xl): ช่องวันสูงพอสำหรับ 4 รายการ — เห็นครบเกือบทุกวันโดยไม่ต้องกด */
const MAX_PER_DAY_WIDE = 4;
/** มือถือ: จุดสูงสุดต่อวัน — ช่องกว้างราว 50px วางจุด 6px ได้ 5 จุดพอดี (เกินแล้วเหลือ 4 จุด + "+N") */
const MOBILE_DOT_CAP = 5;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);

/**
 * พิมพ์ปฏิทินทีมของเดือนที่ดูอยู่ (หรือบันทึกเป็น PDF จากหน้าต่างพิมพ์) — A4 แนวนอน หนึ่งหน้า
 *
 * สร้างเป็นเอกสารแยกในกรอบซ่อน แล้วสั่งพิมพ์กรอบนั้น ไม่ได้พิมพ์หน้าเว็บตรง ๆ: หน้าเว็บมีเมนูซ้าย แถบหัว
 * และช่องวันที่ตัดเหลือ 2 รายการ + "+N" ซึ่งบนกระดาษกดดูต่อไม่ได้ ⇒ ฉบับพิมพ์แสดง "ครบทุกรายการ" ของทุกวัน
 * ใช้ตัวกรองคน/ประเภทที่เลือกอยู่บนจอ (ซ่อนใครไว้ก็ไม่ออกในกระดาษ)
 */
function printMonth(
  title: string,
  grid: { iso: string; day: number; inMonth: boolean }[],
  entriesOf: (iso: string) => DayEntry[],
) {
  const cellHtml = (cell: { iso: string; day: number; inMonth: boolean }) => {
    const rows = entriesOf(cell.iso)
      .map((entry) => {
        const hue = typeHue(entry.leaveTypeName, entry.autoApprove);
        const waiting = !entry.autoApprove && entry.status === "PENDING";
        return `<div class="e${waiting ? " w" : ""}" style="border-left-color:hsl(${hue} 65% 45%);background:hsl(${hue} 80% 93%);color:hsl(${hue} 60% 22%)">${waiting ? "• " : ""}${escapeHtml(labelOf(entry))}</div>`;
      })
      .join("");
    return `<td class="${cell.inMonth ? "" : "out"}"><div class="d">${cell.day}</div>${rows}</td>`;
  };
  // ตารางบนจอมี 6 สัปดาห์เสมอ — สัปดาห์ที่ไม่มีวันของเดือนนี้เลยไม่ต้องพิมพ์ (ช่วยให้จบในหน้าเดียว)
  const weeks: (typeof grid)[] = [];
  for (let index = 0; index < grid.length; index += 7) weeks.push(grid.slice(index, index + 7));
  const cells = weeks
    .filter((week) => week.some((cell) => cell.inMonth))
    .map((week) => `<tr>${week.map(cellHtml).join("")}</tr>`)
    .join("");
  const printedAt = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page{size:A4 landscape;margin:7mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:"Noto Sans Thai","Sarabun","Leelawadee UI",Tahoma,sans-serif;color:#17332f}
h1{margin:0 0 1mm;font-size:13pt}
p{margin:0 0 2mm;font-size:8pt;color:#55627a}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th{font-size:9pt;font-weight:600;padding:1mm;border:1px solid #9aa5a2;background:#eef2f0}
td{vertical-align:top;height:24mm;padding:.8mm;border:1px solid #9aa5a2}
td.out{background:#f6f7f7;color:#9aa5a2}
.d{text-align:right;font-size:8.5pt;font-weight:600;line-height:1.1;margin-bottom:.4mm}
.e{font-size:7pt;line-height:1.22;padding:0 .8mm;margin-bottom:.25mm;border-left:2.5px solid;border-radius:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.e.w{opacity:.65}
tr{break-inside:avoid}
</style></head><body><h1>ปฏิทินทีม · ${escapeHtml(title)}</h1><p>แถบจางมีจุดนำหน้า = รออนุมัติ · พิมพ์เมื่อ ${escapeHtml(printedAt)}</p><table><thead><tr>${DOW_FULL.map((d) => `<th>${d}</th>`).join("")}</tr></thead><tbody>${cells}</tbody></table></body></html>`;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const target = frame.contentWindow;
  // รอให้กรอบจัดหน้าเสร็จก่อนสั่งพิมพ์ แล้วเก็บกรอบทิ้งเมื่อปิดหน้าต่างพิมพ์ (หรือครบเวลา ถ้าเบราว์เซอร์ไม่แจ้ง)
  const cleanup = () => frame.remove();
  target.addEventListener("afterprint", cleanup);
  setTimeout(() => {
    target.focus();
    target.print();
    setTimeout(cleanup, 60_000);
  }, 150);
}

/** ชิปกรองแบบเปิด/ปิด — เปิด = ขอบและตัวหนังสือสีของประเภท · ปิด = เทา ขีดฆ่า */
function FilterChip({
  label,
  hue,
  off,
  onClick,
  count,
  dot = false,
  className = "",
}: {
  label: string;
  hue: number;
  off: boolean;
  onClick: () => void;
  count?: number;
  dot?: boolean;
  className?: string;
}) {
  const color = `hsl(${hue} 65% 40%)`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!off}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-medium transition-colors ${className}`}
      style={
        off
          ? { borderColor: "var(--line)", color: "var(--ink-soft)", textDecoration: "line-through" }
          : { borderColor: color, color, backgroundColor: `hsl(${hue} 80% 97%)` }
      }
    >
      {dot && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: off ? "var(--line)" : color }} />}
      {label}
      {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
    </button>
  );
}

/**
 * แถวคนในแถบซ้าย — ช่องติ๊ก + ตัวย่อชื่อ + ชื่อ · ไม่ใช้สีประจำตัวแล้ว: รายการบนปฏิทินใช้สีตามประเภท
 * สีรายคนตรงนี้จึงไม่ได้โยงกับอะไร และพอคนเยอะสีจะซ้ำกันจนงง
 */
function PersonToggle({ id, name, off, onToggle }: { id: string; name: string; off: boolean; onToggle: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(id)}
      aria-pressed={!off}
      className="flex w-full items-center gap-2 rounded-(--radius) px-1.5 py-1 text-left text-xs transition-colors hover:bg-(--bg-soft)"
    >
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px] font-bold text-white"
        style={off ? { borderColor: "var(--line)" } : { borderColor: "var(--app)", backgroundColor: "var(--app)" }}
        aria-hidden
      >
        {off ? "" : "✓"}
      </span>
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--bg-soft) text-[10px] font-semibold text-(--ink-soft)"
        aria-hidden
      >
        {name.trim().slice(0, 2)}
      </span>
      <span className="truncate" style={{ color: off ? "var(--ink-soft)" : "var(--ink)" }}>
        {name}
      </span>
    </button>
  );
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
  /*
   * ตัวกรองแบบเดียวกับปฏิทินของโมดูลรายงาน/งาน: ชิปเปิด/ปิดได้ทีละอัน เปิดอยู่ทั้งหมดเป็นค่าเริ่มต้น
   *   "แสดง:"   = กลุ่ม — วันหยุดประจำ (ประเภทที่ไม่ต้องอนุมัติ เช่น Day-Off, Holiday) กับ ลา (ต้องอนุมัติ)
   *   "ประเภท:" = ประเภทจริงที่ HR ตั้งไว้ทีละตัว (เดิมมีแค่สองกลุ่ม แยก Day-Off กับ Holiday ไม่ได้)
   * เก็บเป็น "ชื่อประเภทที่ซ่อนอยู่" — ประเภทใหม่ที่ HR เพิ่มทีหลังจึงแสดงเองโดยไม่ต้องไปเปิด
   */
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [personQuery, setPersonQuery] = useState("");
  // ประเภทของบริษัท (จากฟอร์ม) + ประเภทที่มีอยู่จริงบนปฏิทินเดือนนี้ (เผื่อประเภทที่เราเองยื่นไม่ได้)
  const types = useMemo(() => {
    const byName = new Map<string, { name: string; autoApprove: boolean; count: number }>();
    // ชื่อในฟอร์มมี " (ไม่ได้ค่าจ้าง)" ต่อท้าย — ตัดออกให้ตรงกับชื่อประเภทบนรายการ
    for (const t of leaveTypes) {
      const name = t.label.replace(/\s*\(ไม่ได้ค่าจ้าง\)$/, "");
      byName.set(name, { name, autoApprove: t.autoApprove, count: 0 });
    }
    for (const [day, list] of Object.entries(entriesByDate)) {
      for (const e of list) {
        const name = e.leaveTypeName ?? UNNAMED_TYPE;
        const row = byName.get(name) ?? { name, autoApprove: e.autoApprove, count: 0 };
        if (day.startsWith(month)) row.count += 1;
        byName.set(name, row);
      }
    }
    // ประเภทที่ไม่รู้ชื่อ ขึ้นเป็นชิปก็ต่อเมื่อมีรายการจริง
    return [...byName.values()].filter((t) => t.name !== UNNAMED_TYPE || t.count > 0);
  }, [leaveTypes, entriesByDate, month]);
  const groupOff = (auto: boolean) => {
    const names = types.filter((t) => t.autoApprove === auto).map((t) => t.name);
    return names.length > 0 && names.every((n) => hiddenTypes.has(n));
  };
  function toggleType(name: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function toggleGroup(auto: boolean) {
    const names = types.filter((t) => t.autoApprove === auto).map((t) => t.name);
    const allOff = names.every((n) => hiddenTypes.has(n));
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      for (const n of names) {
        if (allOff) next.delete(n);
        else next.add(n);
      }
      return next;
    });
  }

  /** วันที่กดเปิดหน้าต่างอยู่ — null = ปิดอยู่ */
  const [picked, setPicked] = useState<string | null>(null);
  /*
   * มือถือ: แบบเดียวกับปฏิทินในมือถือที่คนคุ้น (Google Calendar / ปฏิทินของ iPhone) — ตารางเดือนมีแค่จุด
   * แตะวันแล้ว "รายชื่อของวันนั้น" ขึ้นใต้ตารางทันที ไม่เด้งหน้าต่าง เลื่อนดูวันอื่นได้ต่อเนื่องด้วยการแตะวันถัดไป
   * ค่าเริ่มต้น = วันนี้ (ถ้าอยู่ในเดือนที่ดู) ไม่งั้นวันที่ 1 · จอใหญ่ยังแตะแล้วเปิดหน้าต่างเหมือนเดิม
   */
  const [selectedDay, setSelectedDay] = useState(() => (today.startsWith(month) ? today : `${month}-01`));
  // มือถือ: รายชื่อคนในทีม (ตัวกรอง) พับเก็บไว้ — กดเปิดเมื่อจะซ่อน/แสดงบางคน
  const [peopleOpen, setPeopleOpen] = useState(false);

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

      {/*
        <640px: ชิปกรองทั้งหมดอยู่แถวเดียว เลื่อนซ้ายขวาได้ ไม่ตกเป็นสามบรรทัด และไม่แสดงประเภทที่เดือนนี้
        ไม่มีใครลงเลย (จำนวน 0 — ไม่มีอะไรให้กรอง) หัวปฏิทินบนมือถือเดิมกินที่เกือบเท่าตัวปฏิทิน ("ตรงหัวมันรก")
      */}
      {/*
        มือถือ: ชิปกรองทั้งหมดพับไว้หลังปุ่ม "ตัวกรอง" (เหมือนแอปทั่วไป) — กดแล้วชิปประเภท + รายชื่อคนในทีมกางออก
        ไม่กินแถวบนหัวปฏิทินตลอดเวลา · จอใหญ่เหมือนเดิม
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs sm:gap-x-4">
        <button
          type="button"
          onClick={() => setPeopleOpen((v) => !v)}
          aria-expanded={peopleOpen}
          className="flex h-8 items-center gap-1.5 rounded-full border border-(--line) px-3 text-xs font-medium text-(--ink)"
          style={peopleOpen || hidden.size + hiddenTypes.size > 0 ? { backgroundColor: "var(--app-soft)" } : undefined}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          ตัวกรอง
          {hidden.size + hiddenTypes.size > 0 && (
            <span className="rounded-full bg-(--app) px-1.5 text-[10px] font-bold text-white">{hidden.size + hiddenTypes.size}</span>
          )}
        </button>
        <div className={`${peopleOpen ? "hidden sm:flex" : "hidden"} order-last shrink-0 flex-wrap items-center gap-1.5`}>
          <span className="hidden text-(--ink-soft) sm:inline">แสดง:</span>
          {(
            [
              [true, "วันหยุดประจำ", 150],
              [false, "ลา", 215],
            ] as const
          )
            .filter(([auto]) => types.some((t) => t.autoApprove === auto))
            .map(([auto, label, hue]) => (
              <FilterChip key={label} label={label} hue={hue} off={groupOff(auto)} onClick={() => toggleGroup(auto)} dot />
            ))}
        </div>
        <div className={`${peopleOpen ? "order-last flex flex-wrap max-sm:w-full" : "hidden"} items-center gap-1.5`}>
          <span className="hidden text-(--ink-soft) sm:inline">ประเภท:</span>
          {types.map((t) => (
            <FilterChip
              key={t.name}
              className={t.count === 0 ? "hidden sm:flex" : ""}
              label={t.name === UNNAMED_TYPE ? "ไม่ระบุประเภท" : t.name}
              count={t.count}
              hue={typeHue(t.name === UNNAMED_TYPE ? null : t.name, t.autoApprove)}
              off={hiddenTypes.has(t.name)}
              onClick={() => toggleType(t.name)}
            />
          ))}
        </div>
        {/* พิมพ์/บันทึก PDF ของเดือนนี้ — ตามตัวกรองที่เลือกอยู่ และแสดงครบทุกรายการของแต่ละวัน */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="พิมพ์ / บันทึก PDF"
          title="พิมพ์ / บันทึก PDF"
          // มือถือ: ไอคอนเครื่องพิมพ์อย่างเดียว ขนาดเท่าชิป ไม่เป็นปุ่มใหญ่ตกบรรทัด
          className="ml-auto h-8 w-8 shrink-0 p-0"
          onClick={() =>
            printMonth(
              new Date(`${month}-01T00:00:00`).toLocaleDateString("th-TH", { month: "long", year: "numeric" }),
              grid,
              (iso) =>
                (entriesByDate[iso] ?? []).filter(
                  (e) => !hidden.has(e.employmentId) && !hiddenTypes.has(e.leaveTypeName ?? UNNAMED_TYPE),
                ),
            )
          }
        >
          <Printer className="h-4 w-4" />
        </Button>
      </div>

      {/* รายชื่อคน (ตัวกรอง) พับเก็บทุกขนาดจอแบบปฏิทิน Teams — ปิดอยู่ ปฏิทินได้ความกว้างเต็ม เปิดแล้วค่อยมีแถบซ้าย */}
      <div className={`grid grid-cols-1 gap-4 ${peopleOpen ? "lg:grid-cols-[230px_minmax(0,1fr)]" : ""}`}>
        {/* มือถือ: รายชื่อของวันที่เลือก ใต้ตารางเดือน */}
        {(() => {
          const dayEntries = (entriesByDate[selectedDay] ?? []).filter(
            (e) => !hidden.has(e.employmentId) && !hiddenTypes.has(e.leaveTypeName ?? UNNAMED_TYPE),
          );
          const d = new Date(`${selectedDay}T00:00:00Z`);
          const dayLabel = `${DOW_FULL[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()}`;
          return (
            <div className="order-2 flex flex-col gap-1.5 rounded-(--radius) border border-(--line) p-2.5 sm:hidden">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-(--ink)">
                  {dayLabel}
                  <span className="ml-1.5 text-xs font-normal text-(--ink-soft)">
                    {dayEntries.length === 0 ? "ไม่มีใครหยุด" : `หยุด ${dayEntries.length} คน`}
                  </span>
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto h-8 shrink-0"
                  onClick={() => {
                    setRowError(null);
                    setSwapResult(null);
                    setPicked(selectedDay);
                  }}
                >
                  {dayEntries.some((e) => e.mine) ? "จัดการวันหยุด" : canRequest ? "+ ลงวันหยุด" : "ดูรายละเอียด"}
                </Button>
              </div>
              {dayEntries.map((entry, index) => {
                const hue = typeHue(entry.leaveTypeName, entry.autoApprove);
                const waiting = !entry.autoApprove && entry.status === "PENDING";
                return (
                  <div
                    key={`${entry.employmentId}-${index}`}
                    className="flex items-center gap-2 rounded-sm px-2 py-1 text-sm"
                    style={{
                      borderLeft: `3px solid hsl(${hue} 65% 45%)`,
                      backgroundColor: `hsl(${hue} 80% 95%)`,
                      color: `hsl(${hue} 60% 24%)`,
                      fontWeight: entry.mine ? 700 : 500,
                      opacity: waiting ? 0.65 : 1,
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{labelOf(entry)}</span>
                    {waiting && <span className="shrink-0 text-[11px] font-normal">รออนุมัติ</span>}
                  </div>
                );
              })}
            </div>
          );
        })()}
        {/* ── แถบซ้าย: ใครหยุดบ้าง เปิด/ปิดดูรายคนได้ ── */}
        <aside className={peopleOpen ? "order-first lg:order-1" : "hidden"}>
          <div>
          {employmentId !== null && (
            <>
              <p className="mb-1.5 text-xs font-semibold text-(--ink)">ปฏิทินของฉัน</p>
              <PersonToggle id={employmentId} name={`${myName} (ฉัน)`} off={hidden.has(employmentId)} onToggle={toggle} />
              <div className="my-3 border-t border-(--line)" />
            </>
          )}
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-(--ink)">คนในทีม</p>
            {people.length > 0 && (
              <button
                type="button"
                className="text-[11px] font-medium text-(--app) hover:underline"
                onClick={() => setHidden(hidden.size > 0 ? new Set() : new Set(people.map((p) => p.id)))}
              >
                {hidden.size > 0 ? "แสดงทั้งหมด" : "ซ่อนทั้งหมด"}
              </button>
            )}
          </div>
          <p className="mb-2 text-[11px] leading-snug text-(--ink-soft)">ติ๊กเพื่อแสดง/ซ่อนวันหยุดและวันลาของแต่ละคนในปฏิทิน</p>
          {people.length > 6 && (
            <input
              value={personQuery}
              onChange={(e) => setPersonQuery(e.target.value)}
              placeholder="ค้นหาชื่อ"
              aria-label="ค้นหาชื่อ"
              className="mb-2 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-2.5 py-1.5 text-xs outline-none focus:border-(--app) [@media(pointer:coarse)]:text-base"
            />
          )}
          {/* <640px: รายชื่อสูงพอเห็นราว 5 คน ที่เหลือเลื่อนนิ้วในกล่อง — ไม่ดันทั้งหน้ายาวลงไปเป็นสิบแถว */}
          <div className="flex max-h-[11.5rem] flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-(--radius) border border-(--line) p-1 sm:max-h-none sm:overflow-visible sm:border-0 sm:p-0">
            {people.length === 0 && <p className="text-xs text-(--ink-soft)">ยังไม่มีใครลงวันหยุดเดือนนี้</p>}
            {people
              .filter((p) => p.id !== employmentId && p.name.toLowerCase().includes(personQuery.trim().toLowerCase()))
              .map((person) => (
                <PersonToggle key={person.id} id={person.id} name={person.name} off={hidden.has(person.id)} onToggle={toggle} />
              ))}
          </div>
          </div>
        </aside>

        {/* ── ตารางเดือน ── */}
        {/* <640px: เจ็ดวันพอดีจอ ไม่ต้องเลื่อนข้าง — เดิมตารางกว้างขั้นต่ำ 608px บนมือถือเลยเห็นแค่ จ–ศ
            เสาร์/อาทิตย์หลุดขอบขวา ดูเหมือนปฏิทินไม่มีวันหยุดสุดสัปดาห์ ("ใน mobile ไม่เป็นแบบนี้") */}
        <div className="order-1 min-w-0 lg:order-2">
          <div className="sm:min-w-[38rem]">
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
              {/* สัปดาห์ที่ไม่มีวันของเดือนนี้เลย (แถวท้ายที่เป็นเดือนหน้าทั้งแถว) ไม่ต้องแสดง — คืนพื้นที่ให้แถวที่ใช้จริง */}
              {grid.filter((_, index) => grid.slice(index - (index % 7), index - (index % 7) + 7).some((c) => c.inMonth)).map((cell) => {
                const all = entriesByDate[cell.iso] ?? [];
                const entries = all.filter(
                  (e) =>
                    !hidden.has(e.employmentId) && !hiddenTypes.has(e.leaveTypeName ?? UNNAMED_TYPE),
                );
                const iAmOff = all.some((e) => e.mine);
                const isToday = cell.iso === today;
                // เตือนวันที่คนหยุดพร้อมกันเยอะผิดปกติ — ปัญหาจริงของธุรกิจที่พึ่ง
                // กะเข้างานสลับกัน (เช่น pool villa) ถ้าหยุดพร้อมกันหลายคนอาจขาดคน
                const heavy = cell.inMonth && all.length >= 3;

                const body = (
                  <span
                    className="flex h-full min-h-[3.25rem] min-w-0 flex-col gap-0.5 border-b border-r border-(--line)/70 p-0.5 text-left sm:min-h-24 sm:p-1 lg:min-h-[7.5rem] xl:min-h-[8.75rem] xl:gap-1 xl:p-1.5"
                    style={{
                      opacity: cell.inMonth ? 1 : 0.4,
                      // วันที่คนหยุดเยอะ: พื้นส้มจาง ๆ แทนกรอบส้มหนา — ยังสังเกตได้แต่ไม่ตัดกันทั้งตาราง
                      backgroundColor: heavy ? "color-mix(in srgb, var(--tone-warn) 7%, transparent)" : undefined,
                    }}
                  >
                    <span className="flex items-center justify-between">
                      {heavy && (
                        <span
                          title={`${all.length} คนหยุดพร้อมกันวันนี้`}
                          className="text-[10px] font-semibold"
                          style={{ color: "var(--tone-warn)" }}
                        >
                          ⚠ {all.length}
                        </span>
                      )}
                      <span
                        className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px]"
                        style={
                          isToday
                            ? { backgroundColor: "var(--app)", color: "white", fontWeight: 700 }
                            : { color: "var(--ink-soft)" }
                        }
                      >
                        {cell.day}
                      </span>
                    </span>

                    {/*
                      <640px: จุดสีแถวเดียวใต้เลขวัน แบบเดียวกับปฏิทินของ Project Management บนมือถือ
                      (full-calendar-view.tsx) — จุดละหนึ่งคนที่หยุด สีตามประเภท เกินที่วางได้ขึ้น "+N"
                      แตะวันเพื่อดูว่าใครหยุด · ช่องวันกว้างราว 50px ใส่ชื่อแล้วอ่านยากและรก ("ลอกมาเลย")
                    */}
                    {entries.length > 0 && (
                      <span className="flex max-w-full flex-nowrap items-center justify-center gap-px overflow-hidden px-0.5 pb-0.5 sm:hidden">
                        {entries.slice(0, entries.length > MOBILE_DOT_CAP ? MOBILE_DOT_CAP - 1 : MOBILE_DOT_CAP).map((entry, index) => (
                          <span
                            key={`${entry.employmentId}-${index}`}
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: `hsl(${typeHue(entry.leaveTypeName, entry.autoApprove)} 65% 45%)`,
                              opacity: !entry.autoApprove && entry.status === "PENDING" ? 0.45 : 1,
                            }}
                          />
                        ))}
                        {entries.length > MOBILE_DOT_CAP && (
                          <span className="shrink-0 rounded-full bg-(--ink) px-[3px] text-[7px] font-extrabold leading-[1.35] text-(--bg)">
                            +{entries.length - (MOBILE_DOT_CAP - 1)}
                          </span>
                        )}
                      </span>
                    )}

                    <span className="hidden sm:contents">
                    {entries.slice(0, MAX_PER_DAY_WIDE).map((entry, index) => {
                      // สีตามประเภท (ชิปกรองด้านบนใช้สีเดียวกัน) — ใครหยุดดูจากชื่อบนรายการและรายชื่อทางซ้าย
                      const hue = typeHue(entry.leaveTypeName, entry.autoApprove);
                      const waiting = !entry.autoApprove && entry.status === "PENDING";
                      return (
                        <span
                          key={`${entry.employmentId}-${index}`}
                          title={`${labelOf(entry)} · ${entry.autoApprove ? "วันหยุดประจำ (สิทธิ์)" : entry.status === "APPROVED" ? "ลา · อนุมัติแล้ว" : "ลา · รออนุมัติ"}`}
                          className={`truncate rounded-sm px-1.5 text-[10.5px] leading-[18px] ${index >= MAX_PER_DAY ? "hidden xl:block" : ""}`}
                          style={{
                            borderLeft: `3px solid hsl(${hue} 65% 45%)`,
                            backgroundColor: `hsl(${hue} 80% 93%)`,
                            color: `hsl(${hue} 60% 28%)`,
                            fontWeight: entry.mine ? 700 : 500,
                            // รออนุมัติ = จาง + มีจุด ต่างจากอนุมัติแล้วให้เห็นชัด
                            opacity: waiting ? 0.6 : 1,
                          }}
                        >
                          {waiting ? "• " : ""}
                          {labelOf(entry)}
                        </span>
                      );
                    })}

                    {/* "+N เพิ่มเติม" เป็นตัวหนังสือธรรมดาแบบปฏิทิน Teams/Outlook ไม่ใช่ป้ายดำ — จอกว้างโชว์ได้ 4 รายการก่อนตัด */}
                    {entries.length > MAX_PER_DAY && (
                      <span className={`self-start px-1.5 text-[11px] font-semibold text-(--app-strong) ${entries.length > MAX_PER_DAY_WIDE ? "" : "xl:hidden"}`}>
                        <span className="xl:hidden">+{entries.length - MAX_PER_DAY}</span>
                        <span className="hidden xl:inline">+{entries.length - MAX_PER_DAY_WIDE}</span> เพิ่มเติม
                      </span>
                    )}
                    </span>
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
                      if (window.matchMedia("(max-width: 639px)").matches) setSelectedDay(cell.iso);
                      else setPicked(cell.iso);
                    }}
                    aria-pressed={cell.iso === selectedDay}
                    className={`block w-full text-left transition-colors enabled:hover:bg-(--bg-soft) ${
                      cell.iso === selectedDay ? "max-sm:bg-(--app-soft)" : ""
                    }`}
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
            ? "บัญชีนี้ยังไม่ถูกผูกกับทะเบียนพนักงาน — ดูปฏิทินได้แต่ลงวันหยุดเองไม่ได้ แจ้งฝ่ายบุคคลให้เพิ่มคุณเข้าทะเบียนก่อน"
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
  leaveTypes: allLeaveTypes,
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
  // Holiday ที่สิทธิ์หมดแล้วไม่ขึ้นให้เลือก
  const leaveTypes = usableLeaveTypes(allLeaveTypes);
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
            {mine.leaveTypeName ?? "วันหยุด"} ·{" "}
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
  if (!canRequest || leaveTypes.length === 0) {
    return (
      <Modal title={`วันที่ ${date}`} onClose={onClose}>
        <OthersOnDay entries={entries} />
        <p className="mt-3 text-sm text-(--ink-soft)">
          {employmentId === null
            ? "บัญชีนี้ยังไม่ถูกผูกกับทะเบียนพนักงาน จึงลงวันหยุดเองไม่ได้"
            : allLeaveTypes.length > 0
              ? "สิทธิ์วันหยุดของเดือนนี้ใช้หมดแล้ว"
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
      <form id="day-off-form" action={formAction} data-save-toast="off" className="flex flex-col gap-4">
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
                {leaveTypeHint(t)}
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
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (entries.length === 0) {
    return <p className="text-sm text-(--ink-soft)">วันนี้ยังไม่มีใครหยุด</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-(--ink-soft)">วันนี้หยุด {entries.length} คน</p>
      {entries.map((e, i) => (
        <div key={`${e.employmentId}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="min-w-0 flex-1">
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
              style={{ backgroundColor: `hsl(${typeHue(e.leaveTypeName, e.autoApprove)} 65% 45%)` }}
            />
            {labelOf(e)}
            {e.status === "PENDING" && <span className="text-(--ink-soft)"> · รออนุมัติ</span>}
          </span>
          {/* ผู้อนุมัติยกเลิกแทนเจ้าของใบได้ (ลงเกินโควตา/ลงผิดวัน) — ของตัวเองใช้ปุ่มยกเลิกของตัวเองด้านบน */}
          {!e.mine &&
            e.requestId &&
            (confirming === e.requestId ? (
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  className="h-7 px-2 text-xs"
                  disabled={busy}
                  onClick={() => {
                    const id = e.requestId!;
                    start(async () => {
                      const result = await cancelLeaveForAction(id, "");
                      if (result.error) setError(result.error);
                      else setConfirming(null);
                    });
                  }}
                >
                  {busy ? "กำลังยกเลิก…" : "ยืนยันยกเลิก"}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => setConfirming(null)}>
                  ไม่ยกเลิก
                </Button>
              </span>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs text-(--danger)"
                onClick={() => {
                  setError(null);
                  setConfirming(e.requestId!);
                }}
              >
                ยกเลิกให้
              </Button>
            ))}
        </div>
      ))}
      {error && <p className="text-xs text-(--danger)">{error}</p>}
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
