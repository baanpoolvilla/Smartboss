"use client";

import type { WorkOrderScoreChip } from "@/modules/maintenance/data/work-order-score-chips";
import Link from "next/link";
import { CalendarClock, CalendarDays, CalendarX2, Check, Clock, Lock, MapPin, MessageSquare, Paperclip } from "lucide-react";

import { expenseDaysLeft } from "@/modules/maintenance/lib/expense-deadline";
import { isCommentNotif, PendingBand, splitNotifTitle, usePendingFor } from "@/modules/notifications/pending-for-you";
import type { NotifCategory } from "@/modules/notifications/types";

/**
 * การ์ดใบแจ้งซ่อมแบบการ์ดงาน (ผู้ใช้ 3/11/2569 "การ์ดอยากให้เป็นแบบของ task ... เอาไปแสดงที่ task ก็เป็นแบบในแจ้งซ่อมเลย")
 * ใช้ตัวเดียวกันทั้งบอร์ดแจ้งซ่อม (work-order-board.tsx) และบอร์ดงาน (report_task maintenance-card.tsx)
 *
 * เหมือนการ์ดงาน: วงกลมหน้าหัวข้อ · จุดสีความสำคัญ · ความคิดเห็น / ขอเลื่อนรออนุมัติ ขวาเหนือเส้นคั่น ·
 * เส้นคั่นแล้ว สถานะ + วันครบกำหนด (ใกล้ = เหลือง · เลย = แดง "เลย N ว") + รูปแนบ ซ้าย · รูปคนขวา ·
 * แจ้งเตือนที่ยังไม่อ่าน = แถบแดงบนสุด + พื้นแดงอ่อน อ่านแล้วหาย
 * ต่างจากการ์ดงาน: แถบหัวสีเขียว "🔧 ใบงานซ่อม" + ป้าย PM/อัตโนมัติ/PO/ส่วนตัว + เลขที่ — บอกว่าเป็นใบของแจ้งซ่อม
 * วงกลมกดไม่ได้ (ปิดงานต้องแนบรูป/ค่าใช้จ่ายในหน้าใบงาน) — ใบที่ปิดแล้วเป็นติ๊กเขียว
 */

const WO_NOTIF: NotifCategory[] = ["work_order", "purchase_order"];

/** สีจุดความสำคัญ — ชุดเดียวกับ priorityMeta ของงาน */
const PRIORITY_DOT: Record<string, { color: string; label: string }> = {
  urgent: { color: "var(--chart-red)", label: "เร่งด่วน" },
  critical: { color: "var(--chart-red)", label: "ด่วนมาก" },
  high: { color: "var(--chart-amber)", label: "สูง" },
  medium: { color: "var(--chart-green)", label: "ปานกลาง" },
  low: { color: "var(--chart-gray)", label: "ต่ำ" },
};

export interface WoCardTag {
  label: string;
  bg: string;
}

export interface WoCardProps {
  id: string;
  href: string;
  code: string;
  title: string;
  place: string | null;
  tags: WoCardTag[];
  /** low | medium | high | urgent | critical — ใบอัตโนมัติไม่แสดง (ไม่มีใครประเมิน) */
  priority: string;
  autoCreated: boolean;
  /** open | in_progress | completed | cancelled */
  status: string;
  /** ป้ายสถานะของใบที่ปิดแล้ว เช่น "ยังไม่บันทึกค่าใช้จ่าย" (ไม่ส่ง = "เสร็จแล้ว") */
  doneLabel?: string;
  doneTone?: "green" | "orange" | "gray";
  dueDate: string | Date | null;
  commentCount: number;
  photoCount: number;
  /** คำขอเลื่อนที่รออนุมัติ */
  pendingDue: number;
  /** ป้ายคะแนนแบบการ์ดงาน: หักแล้ว / คืนแล้ว / ยกเว้น */
  score?: WorkOrderScoreChip;
  /** ขอเลื่อนเป็นวันไหน (YYYY-MM-DD) เมื่อมีคำขอเดียว — บอร์ดงานส่งมา */
  pendingDueTo?: string | null;
  /** คนที่ดูอยู่ต้องอนุมัติ: แถบแดงค้างจนกว่าจะตัดสิน เปิดอ่านแล้วไม่หาย (เหมือนการ์ดงาน) */
  pendingDueWaitsMe?: boolean;
  isPrivate?: boolean;
  /** รูปผู้รับผิดชอบ (แต่ละบอร์ดวาดเอง) */
  avatar?: React.ReactNode;
  /** ปุ่ม/ของเพิ่มขวาล่างก่อนรูปคน (สติกเกอร์บนบอร์ดงาน) — วางนอกลิงก์ได้โดยส่ง overlay */
  footerSlot?: React.ReactNode;
  /** แถวสติกเกอร์ที่ติดแล้ว */
  extraRow?: React.ReactNode;
  /** สติกเกอร์ที่ติดแล้ว — อยู่แถวเดียวกับป้ายความสำคัญ/คอมเมนต์ ไม่เปิดแถวใหม่ (แบบการ์ดงาน · ผู้ใช้ 8/11/2569) */
  stickers?: React.ReactNode;
  /** ข้อความเล็กใต้หัวข้อ เช่น "รอบ 1 พ.ย. 2569" */
  subline?: React.ReactNode;
  /** ใบปิดแล้วรอบันทึกค่าใช้จ่าย — แถบบอกเหลือกี่วัน + วันครบกำหนดใช้วันนี้แทน (lib/expense-deadline.ts) */
  expenseDeadline?: string | Date | null;
  /** บันทึกค่าใช้จ่ายแล้ว ยอดรวม (0 = ไม่มีค่าใช้จ่าย) — แถบบอกว่าเสร็จแล้ว */
  expenseRecorded?: number | null;
  /** ตรวจงาน (10/11/2569 แบบการ์ดงาน): ส่งงานแล้ว รอคนเปิดใบตรวจ */
  awaitingReview?: boolean;
  /** คนที่ดูอยู่คือคนเปิดใบ — แถบแดง "รอคุณตรวจ" ค้างจนกด ผ่าน/ไม่ผ่าน */
  reviewWaitsMe?: boolean;
  /** ตรวจแล้วไม่ผ่าน กลับมาแก้ (ยังไม่ส่งใหม่) */
  reviewFailed?: boolean;
}

function bkkDay(d: Date): number {
  return Date.parse(new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10));
}

function shortDate(d: Date): string {
  const s = new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
  const [y, m, day] = s.split("-");
  return `${day}/${m}/${y}`;
}

function DueBadge({ due, open, showLeft = false }: { due: Date; open: boolean; showLeft?: boolean }) {
  const days = Math.round((bkkDay(due) - bkkDay(new Date())) / 86_400_000);
  const date = shortDate(due);
  if (!open || days > 2) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-(--ink-soft)" title={`ครบกำหนด ${date}`}>
        <CalendarDays className="h-3 w-3" />
        {date}
        {/* กำหนดบันทึกค่าใช้จ่าย: บอกเหลือกี่วันเสมอ ที่นี่ที่เดียว (ไม่ซ้ำกับแถบบน) */}
        {showLeft && <span className="opacity-70">· อีก {days} ว</span>}
      </span>
    );
  }
  if (days >= 0) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
        <CalendarClock className="h-3 w-3" />
        {date}
        <span className="opacity-70">· {days === 0 ? "วันนี้" : `อีก ${days} ว`}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-red-50 py-0.5 pl-1.5 pr-1 text-[10px] font-medium text-red-600 ring-1 ring-inset ring-red-200">
      <CalendarX2 className="h-3 w-3" />
      {date}
      <span className="ml-0.5 rounded bg-red-600 px-1 py-px font-semibold tabular-nums text-white">เลย {-days} ว</span>
    </span>
  );
}

/** มีแถบค่าใช้จ่ายอยู่แถวเดียวกัน แถบบนต้องยอมหด */
function expenseBandClass(p: WoCardProps): string {
  return p.expenseDeadline || (p.expenseRecorded ?? null) !== null ? "min-w-0 flex-1" : "";
}

export function WoCard(p: WoCardProps) {
  const allPending = usePendingFor(p.id, WO_NOTIF);
  // คนอนุมัติเห็นแถบ "รอคุณอนุมัติ" แทน ไม่ต้องขึ้น "ยังไม่ได้อ่าน · ขอเลื่อน" ซ้ำ
  const pending = p.pendingDueWaitsMe ? allPending.filter((n) => !splitNotifTitle(n.title).kind.includes("ขอเลื่อน")) : allPending;
  const dueTo = p.pendingDueTo ? `${Number(p.pendingDueTo.slice(8, 10))}/${Number(p.pendingDueTo.slice(5, 7))}` : null;
  const dueWaitBand = p.pendingDueWaitsMe && pending.length === 0;
  // รอคุณตรวจ — แบบแถบ "รอคุณตรวจ · กด ผ่าน / ไม่ผ่าน" ของการ์ดงาน (ไม่ทับแถบยังไม่ได้อ่าน)
  const reviewBand = !!p.reviewWaitsMe && !!p.awaitingReview && pending.length === 0 && !dueWaitBand;
  const topBand = reviewBand ? (
    <div
      className={`flex items-center gap-1 bg-[#fde3e3] px-3 py-1 text-[11px] font-bold leading-4 text-[#b91c1c] ${expenseBandClass(p)}`}
      title="ส่งงานแล้ว · เปิดใบงานแล้วกด ผ่าน / ไม่ผ่าน"
      data-testid="wo-review-wait"
    >
      <span className="truncate">📋 รอคุณตรวจ · กด ผ่าน / ไม่ผ่าน</span>
    </div>
  ) : dueWaitBand ? (
    <div
      className={`flex items-center gap-1 bg-[#fde3e3] px-3 py-1 text-[11px] font-bold leading-4 text-[#b91c1c] ${expenseBandClass(p)}`}
      title="มีคนขอเลื่อนกำหนดส่ง · เปิดใบงานแล้วกด อนุมัติ / ไม่อนุมัติ"
      data-testid="wo-due-wait"
    >
      <span className="truncate">⏰ {p.pendingDue > 1 ? `ขอเลื่อนกำหนดส่ง ${p.pendingDue} คำขอ` : dueTo ? `ขอเลื่อนกำหนดส่งเป็น ${dueTo}` : "ขอเลื่อนกำหนดส่ง"} · รอคุณอนุมัติ</span>
    </div>
  ) : (
    <PendingBand notifs={pending} soft className={expenseBandClass(p)} />
  );
  // ความคิดเห็นใหม่ที่ยังไม่อ่าน = ป้ายแดง "N ใหม่" แทนจำนวน (แบบการ์ดงาน) — เปิดอ่านแล้วกลับเป็นตัวเลขเทา
  const unreadComments = pending.filter(isCommentNotif).length;
  const open = p.status === "open" || p.status === "in_progress";
  const expenseDue = p.expenseDeadline ? new Date(p.expenseDeadline) : null;
  const expenseLeft = expenseDue ? expenseDaysLeft(expenseDue) : 0;
  // แถบสถานะค่าใช้จ่าย อยู่ชิดขวา แถวเดียวกับแถบ "ยังไม่ได้อ่าน" ที่อยู่ซ้าย (ผู้ใช้ 3/11/2569 ไม่ให้ทับกัน) · จำนวนวันอยู่ที่ป้ายล่าง
  const recorded = p.expenseRecorded ?? null;
  const expenseBand = expenseDue ? (
    <span className={`flex shrink-0 items-center px-3 py-1 text-[11px] font-bold leading-4 ${expenseLeft < 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
      💰 รอบันทึกค่าใช้จ่าย
    </span>
  ) : recorded !== null ? (
    <span className="flex shrink-0 items-center gap-1 bg-emerald-100 px-3 py-1 text-[11px] font-bold leading-4 text-emerald-800 tabular-nums">
      ✅ บันทึกแล้ว {recorded > 0 ? `฿${recorded.toLocaleString()}` : "ไม่มีค่าใช้จ่าย"}
    </span>
  ) : null;
  // รอบันทึก = ยังเป็นงานที่ต้องทำ ไม่ขีดฆ่า/ไม่จาง
  const done = !expenseDue && (p.status === "completed" || p.status === "cancelled");
  const due = expenseDue ?? (p.dueDate ? new Date(p.dueDate) : null);
  const dot = PRIORITY_DOT[p.priority] ?? PRIORITY_DOT.medium!;
  const doneTone = p.doneTone ?? "green";
  const toneCls =
    doneTone === "orange"
      ? "bg-orange-50 text-orange-700 ring-orange-200"
      : doneTone === "gray"
        ? "bg-(--bg-soft) text-(--ink-soft) ring-(--line)"
        : "bg-[color-mix(in_srgb,var(--brand-green)_14%,white)] text-[var(--brand-green-dark)] ring-transparent";
  const showMetaRow = (open && !p.autoCreated) || p.pendingDue > 0 || p.commentCount > 0 || unreadComments > 0 || !!p.score || !!p.stickers;

  return (
    <Link
      href={p.href}
      prefetch={false}
      className={`group block overflow-hidden rounded-xl border shadow-[0_4px_14px_rgba(16,24,40,0.13),0_1px_3px_rgba(16,24,40,0.10)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgba(16,24,40,0.22)] sm:rounded-2xl ${
        pending.length > 0 || dueWaitBand || reviewBand ? "border-[#f3a4a4] bg-[#fdecec]" : "border-[#b7e3dd] bg-white"
      } ${done ? "opacity-90" : ""}`}
      aria-label={`ใบงานซ่อม ${p.code} ${p.title}`}
    >
      {expenseBand ? (
        <div className={`flex items-stretch justify-end ${expenseDue ? (expenseLeft < 0 ? "bg-red-100" : "bg-amber-100") : "bg-emerald-100"}`} data-testid="wo-top-band">
          {topBand}
          {expenseBand}
        </div>
      ) : (
        topBand
      )}
      {/* แถบหัวสีแจ้งซ่อม — มองไกลก็รู้ว่าเป็นใบของแจ้งซ่อม ไม่ใช่งาน */}
      <div className="flex items-center justify-between gap-2 bg-[#0d9488] px-3 py-0.5 text-[10.5px] font-semibold leading-4 text-white">
        <span className="inline-flex min-w-0 items-center gap-1">
          🔧 ใบงานซ่อม
          {p.tags.map((t) => (
            <span key={t.label} className="rounded px-1 text-[9px] font-bold leading-[13px] text-white ring-1 ring-white/40" style={{ backgroundColor: t.bg }}>
              {t.label === "ส่วนตัว" && <Lock className="mr-0.5 inline h-2 w-2 align-[-1px]" aria-hidden="true" />}
              {t.label}
            </span>
          ))}
        </span>
        <span className="truncate font-medium opacity-90">{p.code}</span>
      </div>

      <div className="p-3 sm:px-4 sm:py-3">
        {done && p.awaitingReview ? (
          // ส่งงานแล้ว รอตรวจ — ป้ายสองท่อน "✓ เสร็จ | ⏱ รอตรวจสอบ" แบบการ์ดงาน (คนตรวจเห็นแถบแดงข้างบนแทน)
          !reviewBand && (
            <div className="mb-1.5">
              <span className="inline-flex items-stretch overflow-hidden whitespace-nowrap rounded-full text-[10px] font-semibold ring-1 ring-inset ring-[#c6ead1]" data-testid="wo-review-pill">
                <span className="flex items-center gap-1 bg-[#effaf2] px-2.5 py-0.5 text-[#15803d]">
                  <Check className="h-2.5 w-2.5 shrink-0" strokeWidth={3} />
                  เสร็จ
                </span>
                <span className="flex items-center gap-1 bg-[#bfe8cb] px-2.5 py-0.5 text-[#2f5b3b]">⏱ รอตรวจสอบ</span>
              </span>
            </div>
          )
        ) : done ? (
          <div className="mb-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${toneCls}`}>
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
              {p.doneLabel ?? (p.status === "cancelled" ? "ยกเลิก" : "เสร็จแล้ว")}
            </span>
          </div>
        ) : p.reviewFailed && open ? (
          <div className="mb-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#fdecea] px-2.5 py-0.5 text-[10px] font-semibold text-[#b42318] ring-1 ring-inset ring-[#f5c2bd]" data-testid="wo-review-failed">
              ↩ ไม่ผ่าน · กลับมาแก้
            </span>
          </div>
        ) : null}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className={`line-clamp-2 text-[14px] font-semibold leading-snug text-(--ink)`}>{p.title}</p>
            {p.place && (
              <p className="mt-0.5 inline-flex max-w-full items-center gap-0.5 truncate text-[11px] font-medium text-[#0f766e]">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{p.place}</span>
              </p>
            )}
            {p.subline && <div className="mt-0.5 text-[11px] text-(--ink-soft)">{p.subline}</div>}
          </div>
        </div>

        {p.extraRow && <div className="mt-2">{p.extraRow}</div>}

        {/* แถวเหนือเส้นคั่น: จุดความสำคัญซ้าย · ขอเลื่อนรออนุมัติ + ความคิดเห็นขวา (แบบการ์ดงาน) */}
        {showMetaRow && (
          <div className="-mb-1 mt-1.5 flex items-center justify-end gap-2">
            {open && !p.autoCreated && (
              // ตัวหนังสือแทนจุด — แบบเดียวกับการ์ดงานบนบอร์ดเดียวกัน (ผู้ใช้ 8/11/2569)
              <span
                title={`ความสำคัญ: ${dot.label}`}
                className="mr-auto shrink-0 whitespace-nowrap text-[10px] font-semibold leading-none"
                style={{ color: `color-mix(in srgb, ${dot.color} 80%, black)` }}
              >
                {dot.label}
              </span>
            )}
            {/* ไม่มีป้ายความสำคัญ (ปิดแล้ว/ใบอัตโนมัติ) ก็ยังชิดขวาเหมือนเดิม */}
            {p.stickers && <span className={open && !p.autoCreated ? "" : "ml-auto"}>{p.stickers}</span>}
            {p.score && (
              <span
                data-testid="wo-score-chip"
                title={
                  p.score.kind === "docked"
                    ? `โดนหักคะแนน ${p.score.points} คะแนนแล้ว (เลยกำหนด)`
                    : p.score.kind === "refunded"
                      ? `คืนคะแนน ${p.score.points} คะแนนแล้ว · ไม่นับการหักครั้งนี้`
                      : "ยกเว้นคะแนนใบนี้ · เลยกำหนดก็ไม่หัก แต่ยังต้องทำและปิดงานตามปกติ"
                }
                className={`inline-flex h-4 shrink-0 items-center whitespace-nowrap rounded-md px-1.5 text-[10px] font-semibold ring-1 ring-inset ${
                  p.score.kind === "docked" ? "bg-red-50 text-red-700 ring-red-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                }`}
              >
                {p.score.kind === "docked" ? `−${p.score.points}` : p.score.kind === "refunded" ? `คืน +${p.score.points}` : "ยกเว้นคะแนน"}
              </span>
            )}
            {p.pendingDue > 0 && !p.pendingDueWaitsMe && (
              <span className="flex h-4 items-center gap-1 rounded-full bg-(--danger) px-1.5 text-[10px] font-bold text-white" title="มีคำขอเลื่อนกำหนดส่งรออนุมัติ">
                <Clock className="h-2.5 w-2.5" /> {p.pendingDue > 1 ? `ขอเลื่อน ${p.pendingDue}` : dueTo ? `ขอเลื่อน ${dueTo}` : "ขอเลื่อน"} · รออนุมัติ
              </span>
            )}
            {(p.commentCount > 0 || unreadComments > 0) && (
              <span
                className={
                  unreadComments > 0
                    ? "flex h-4 items-center gap-1 rounded-full bg-(--danger) px-1.5 text-[10px] font-bold text-white"
                    : "flex items-center gap-0.5 text-[10px] font-medium text-[var(--chart-gray)]"
                }
                title={unreadComments > 0 ? `มีความคิดเห็นใหม่ที่ยังไม่ได้อ่าน ${unreadComments} รายการ (ทั้งหมด ${p.commentCount})` : "ความคิดเห็น"}
              >
                <MessageSquare className="h-2.5 w-2.5" /> {unreadComments > 0 ? `${unreadComments} ใหม่` : p.commentCount}
              </span>
            )}
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[var(--line)]/60 pt-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-(--ink)">
            {/* สถานะไม่ขึ้นบนการ์ด — คอลัมน์บอกอยู่แล้ว แบบการ์ดงาน (ใบที่ปิดแล้วมีป้ายด้านบนแทน) */}
            {due && <DueBadge due={due} open={open || !!expenseDue} showLeft={!!expenseDue} />}
            {p.photoCount > 0 && (
              <span className="flex items-center gap-0.5 text-xs font-medium" title="รูปแนบ">
                <Paperclip className="h-3.5 w-3.5" /> {p.photoCount}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {p.footerSlot}
            {p.avatar}
          </div>
        </div>
      </div>
    </Link>
  );
}

/** รูปผู้รับผิดชอบแบบตัวย่อ (บอร์ดแจ้งซ่อมไม่มีรูปโปรไฟล์) */
export function InitialAvatar({ name }: { name: string }) {
  const initial = name.replace(/^[^A-Za-zก-๙]+/, "").slice(0, 2) || "?";
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--bg-soft) text-[9px] font-semibold text-(--ink-soft) ring-1 ring-(--line)"
      title={name}
    >
      {initial}
    </span>
  );
}
